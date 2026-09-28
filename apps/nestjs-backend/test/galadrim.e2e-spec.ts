/* eslint-disable sonarjs/no-duplicate-string */
import http from 'http';
import type { AddressInfo } from 'net';
import type { INestApplication } from '@nestjs/common';
import { FieldKeyType, FieldType } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { ITableFullVo } from '@teable/openapi';
import type { IBaseConfig } from '../src/configs/base.config';
import { baseConfig } from '../src/configs/base.config';
import { EventEmitterService } from '../src/event-emitter/event-emitter.service';
import { Events } from '../src/event-emitter/events';
import type { IGaladrimWebhookBody } from '../src/features/galadrim/galadrim-webhook.sender';
import { createAwaitWithEvent } from './utils/event-promise';
import {
  createBase,
  createField,
  createTable,
  initApp,
  permanentDeleteBase,
  updateRecord,
} from './utils/init-app';

const secret = 'e2e-galadrim-secret';
const suffix = Date.now().toString(36);

interface ICallOptions {
  method?: string;
  body?: unknown;
  token?: string;
  secret?: string | null;
  origin?: string;
}

describe('galadrim-proxy (e2e)', () => {
  let app: INestApplication;
  let appUrl: string;
  let prismaService: PrismaService;
  let awaitRecordHistory: <T>(fn: () => Promise<T>) => Promise<T>;
  let hookServer: http.Server;
  const hooks: { authorization?: string; body: IGaladrimWebhookBody }[] = [];

  let baseA: string;
  let baseB: string;
  let tableA: ITableFullVo;
  let tableB: ITableFullVo;

  const call = async (path: string, options: ICallOptions = {}) => {
    const headers = new Headers();
    headers.set('content-type', 'application/json');
    if (options.token) headers.set('authorization', `Bearer ${options.token}`);
    if (options.secret !== null) headers.set('x-galadrim-secret', options.secret ?? secret);
    if (options.origin) headers.set('x-galadrim-origin', options.origin);
    const response = await fetch(`${appUrl}/api${path}`, {
      method: options.method ?? 'POST',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const text = await response.text();
    return {
      status: response.status,
      headers: response.headers,
      data: text ? JSON.parse(text) : undefined,
    };
  };

  const tokenFor = async (email: string, name: string, baseId?: string) => {
    const res = await call('/galadrim/token', { body: { email, name, baseId } });
    expect(res.status).toBe(200);
    return res.data as { userId: string; token: string; expiresAt: string };
  };

  const waitForHook = async (predicate: (body: IGaladrimWebhookBody) => boolean) => {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const hook = hooks.find(({ body }) => predicate(body));
      if (hook) return hook;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`no webhook matched; received ${JSON.stringify(hooks.map((h) => h.body))}`);
  };

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    appUrl = appCtx.appUrl;
    prismaService = app.get(PrismaService);
    (app.get(baseConfig.KEY) as IBaseConfig).recordHistoryDisabled = false;
    awaitRecordHistory = createAwaitWithEvent(
      app.get(EventEmitterService),
      Events.RECORD_HISTORY_CREATE
    );

    hookServer = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk) => (raw += chunk));
      req.on('end', () => {
        hooks.push({ authorization: req.headers.authorization, body: JSON.parse(raw) });
        res.writeHead(200).end();
      });
    });
    await new Promise<void>((resolve) => hookServer.listen(0, '127.0.0.1', resolve));
    const { port } = hookServer.address() as AddressInfo;

    vi.stubEnv('GALADRIM_SECRET', secret);
    vi.stubEnv('GALADRIM_WEBHOOK_URL', `http://127.0.0.1:${port}/hooks`);

    const spaceId = globalThis.testConfig.spaceId;
    baseA = (await createBase({ spaceId, name: 'galadrim A' })).id;
    baseB = (await createBase({ spaceId, name: 'galadrim B' })).id;
    tableA = await createTable(baseA, { name: 'Cartes' });
    tableB = await createTable(baseB, { name: 'Autre' });
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await permanentDeleteBase(baseA);
    await permanentDeleteBase(baseB);
    await new Promise((resolve) => hookServer.close(resolve));
    await app.close();
  });

  it('stays on the v1 write path, the only one that feeds the webhook', () => {
    expect(process.env.FORCE_V2_ALL).not.toBe('true');
  });

  it('refuses a call without the secret or with a wrong one', async () => {
    const body = { email: 'x@galadrim.fr', name: 'X' };
    expect((await call('/galadrim/token', { body, secret: null })).status).toBe(401);
    expect((await call('/galadrim/token', { body, secret: 'wrong' })).status).toBe(401);
    expect((await call('/galadrim/users/ensure', { body, secret: null })).status).toBe(401);
    expect((await call('/galadrim/space', { body, secret: null })).status).toBe(401);
  });

  it('creates an unknown person lower-cased, with no account, no space and no admin right', async () => {
    const { userId, token, expiresAt } = await tokenFor(
      `Nouvelle.Personne.${suffix}@Galadrim.FR`,
      'Nouvelle Personne'
    );
    expect(token).toBeTruthy();
    expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now() + 14 * 60 * 1000);

    const user = await prismaService.user.findUniqueOrThrow({
      where: { id: userId },
      include: { accounts: true },
    });
    expect(user.email).toBe(`nouvelle.personne.${suffix}@galadrim.fr`);
    expect(user.name).toBe('Nouvelle Personne');
    expect(user.accounts).toEqual([]);
    expect(user.isAdmin).toBeNull();
    expect(await prismaService.collaborator.count({ where: { principalId: userId } })).toBe(0);

    const again = await tokenFor(`nouvelle.personne.${suffix}@galadrim.fr`, 'Autre nom');
    expect(again.userId).toBe(userId);
  });

  it('acts as the person on its base, and nowhere else', async () => {
    const email = `ecrivain.${suffix}@galadrim.fr`;
    const createdByField = await createField(tableA.id, { type: FieldType.CreatedBy });
    const { userId, token } = await tokenFor(email, 'Écrivain', baseA);
    const primaryA = tableA.fields[0].id;

    const created = await call(`/table/${tableA.id}/record`, {
      token,
      body: { fieldKeyType: FieldKeyType.Id, records: [{ fields: { [primaryA]: 'Carte' } }] },
    });
    expect(created.status).toBe(201);
    expect(created.headers.get('x-teable-v2')).not.toBe('true');
    const recordId = created.data.records[0].id;

    const read = await call(`/table/${tableA.id}/record/${recordId}?fieldKeyType=id`, {
      method: 'GET',
      token,
    });
    expect(read.status).toBe(200);
    expect(read.data.fields[createdByField.id]).toMatchObject({ id: userId, email });

    await awaitRecordHistory(async () => {
      const updated = await call(`/table/${tableA.id}/record/${recordId}`, {
        method: 'PATCH',
        token,
        body: { fieldKeyType: FieldKeyType.Id, record: { fields: { [primaryA]: 'Carte 2' } } },
      });
      expect(updated.status).toBe(200);
    });
    const history = await prismaService.recordHistory.findMany({
      where: { tableId: tableA.id, recordId },
    });
    expect(history.map(({ createdBy }) => createdBy)).toEqual([userId]);

    const elsewhere = await call(`/table/${tableB.id}/record`, {
      token,
      body: { fieldKeyType: FieldKeyType.Id, records: [{ fields: {} }] },
    });
    expect(elsewhere.status).toBe(403);
    expect((await call(`/base/${baseB}/table`, { method: 'GET', token })).status).toBe(403);

    for (const path of [
      `/base/${baseA}/table`,
      `/table/${tableA.id}/field`,
      `/table/${tableA.id}/view`,
    ]) {
      expect((await call(path, { method: 'GET', token })).status).toBe(200);
    }
    const table = await call(`/base/${baseA}/table`, { token, body: { name: 'Par Outline' } });
    expect(table.status).toBe(201);
    // Base info is the exception: BaseService wants a collaborator role, which a base token does not give.
    expect((await call(`/base/${baseA}`, { method: 'GET', token })).status).toBe(403);
  });

  it("lets Outline put any person in a user cell, while Teable's rule holds for others", async () => {
    const userField = await createField(tableA.id, {
      type: FieldType.User,
      options: { isMultiple: true },
    });
    const [{ id: outsiderId }] = (
      await call('/galadrim/users/ensure', {
        body: { users: [{ email: `dehors.${suffix}@galadrim.fr`, name: 'Dehors' }] },
      })
    ).data.users;
    const { token } = await tokenFor(`assigne.${suffix}@galadrim.fr`, 'Assigneur', baseA);
    const recordId = tableA.records[0].id;

    const assigned = await call(`/table/${tableA.id}/record/${recordId}`, {
      method: 'PATCH',
      token,
      body: {
        fieldKeyType: FieldKeyType.Id,
        typecast: true,
        record: { fields: { [userField.id]: [{ id: outsiderId }] } },
      },
    });
    expect(assigned.status).toBe(200);
    expect(assigned.data.fields[userField.id]).toMatchObject([{ id: outsiderId, title: 'Dehors' }]);

    const byEmail = await call(`/table/${tableA.id}/record/${recordId}`, {
      method: 'PATCH',
      token,
      body: {
        fieldKeyType: FieldKeyType.Id,
        typecast: true,
        record: { fields: { [userField.id]: `dehors.${suffix}@galadrim.fr` } },
      },
    });
    expect(byEmail.data.fields[userField.id]).toMatchObject([{ id: outsiderId }]);

    // Teable's own rule still holds for everyone else, the base owner's session included.
    await updateRecord(
      tableA.id,
      recordId,
      {
        fieldKeyType: FieldKeyType.Id,
        record: { fields: { [userField.id]: [{ id: outsiderId, title: 'Dehors' }] } },
      },
      400
    );
  });

  it('finds or creates people in a batch', async () => {
    const res = await call('/galadrim/users/ensure', {
      body: {
        users: [
          { email: 'TEST@e2e.com', name: 'test' },
          { email: `lot.${suffix}@galadrim.fr`, name: 'Lot' },
        ],
      },
    });
    expect(res.status).toBe(200);
    expect(res.data.users[0]).toEqual({ email: 'test@e2e.com', id: globalThis.testConfig.userId });
    expect(res.data.users[1]).toMatchObject({ email: `lot.${suffix}@galadrim.fr` });
  });

  it("keeps one space for Outline's service user, who can create bases in it", async () => {
    const name = `Outline ${suffix}`;
    const first = await call('/galadrim/space', { body: { name } });
    const second = await call('/galadrim/space', { body: { name } });
    expect(first.status).toBe(200);
    expect(second.data.spaceId).toBe(first.data.spaceId);
    const { spaceId } = first.data;

    const service = await tokenFor('outline@galadrim.local', 'Outline');
    const owner = await prismaService.collaborator.findFirstOrThrow({
      where: { resourceId: spaceId },
    });
    expect(owner).toMatchObject({ principalId: service.userId, roleName: 'owner' });

    const base = await call('/base', {
      token: service.token,
      body: { spaceId, name: 'Créée par Outline' },
    });
    expect(base.status).toBe(201);

    const tables = `/base/${base.data.id}/table`;
    const person = await tokenFor(`curieux.${suffix}@galadrim.fr`, 'Curieux');
    expect((await call(tables, { method: 'GET', token: person.token })).status).toBe(403);
    const scoped = await tokenFor(`curieux.${suffix}@galadrim.fr`, 'Curieux', base.data.id);
    expect((await call(tables, { method: 'GET', token: scoped.token })).status).toBe(200);

    await call(`/base/${base.data.id}/permanent`, { method: 'DELETE', token: service.token });
    await call(`/space/${spaceId}/permanent`, { method: 'DELETE', token: service.token });
  });

  it('tells Outline about created, updated and deleted rows, with the actor and the origin', async () => {
    const email = `webhook.${suffix}@galadrim.fr`;
    const { userId, token } = await tokenFor(email, 'Webhook', baseA);
    const primaryA = tableA.fields[0].id;
    const actor = { id: userId, email };

    const created = await call(`/table/${tableA.id}/record`, {
      token,
      origin: 'e2e-create',
      body: { fieldKeyType: FieldKeyType.Id, records: [{ fields: { [primaryA]: 'Avant' } }] },
    });
    const recordId = created.data.records[0].id;
    const createHook = await waitForHook(
      (body) =>
        body.origin === 'e2e-create' &&
        body.events.some((e) => e.kind === 'record.create' && e.recordIds?.includes(recordId))
    );
    expect(createHook.authorization).toBe(`Bearer ${secret}`);
    expect(createHook.body).toMatchObject({ tableId: tableA.id, actor });

    await call(`/table/${tableA.id}/record/${recordId}`, {
      method: 'PATCH',
      token,
      origin: 'e2e-update',
      body: { fieldKeyType: FieldKeyType.Id, record: { fields: { [primaryA]: 'Après' } } },
    });
    const updateHook = await waitForHook((body) => body.origin === 'e2e-update');
    expect(updateHook.body.actor).toEqual(actor);
    expect(updateHook.body.events).toContainEqual(
      expect.objectContaining({
        kind: 'record.update',
        recordIds: [recordId],
        changes: expect.arrayContaining([
          { recordId, fieldId: primaryA, before: 'Avant', after: 'Après' },
        ]),
      })
    );

    const viewId = tableA.views[0].id;
    const moved = await call(`/table/${tableA.id}/view/${viewId}/record-order`, {
      method: 'PUT',
      token,
      origin: 'e2e-move',
      body: { anchorId: tableA.records[0].id, position: 'before', recordIds: [recordId] },
    });
    expect(moved.status).toBe(200);
    const moveHook = await waitForHook((body) => body.origin === 'e2e-move');
    expect(moveHook.body.events).toEqual([{ kind: 'view', viewIds: [viewId] }]);

    await call(`/table/${tableA.id}/record/${recordId}`, {
      method: 'DELETE',
      token,
      origin: 'e2e-delete',
    });
    const deleteHook = await waitForHook((body) => body.origin === 'e2e-delete');
    expect(deleteHook.body.events).toContainEqual({ kind: 'record.delete', recordIds: [recordId] });
  });
});
