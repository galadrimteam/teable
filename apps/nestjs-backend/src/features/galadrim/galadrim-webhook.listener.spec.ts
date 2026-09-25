import type { IRecord } from '@teable/core';
import type { ClsService } from 'nestjs-cls';
import { CLS_REQ } from 'nestjs-cls';
import type { IEventContext } from '../../event-emitter/events';
import {
  FieldDeleteEvent,
  RecordCreateEvent,
  RecordDeleteEvent,
  RecordUpdateEvent,
  ViewUpdateEvent,
} from '../../event-emitter/events';
import type { IChangeView } from '../../event-emitter/events/table/view.event';
import type { IClsStore } from '../../types/cls';
import { GALADRIM_BATCH_WINDOW_MS, GaladrimWebhookListener } from './galadrim-webhook.listener';
import type { GaladrimWebhookSender, IGaladrimWebhookBody } from './galadrim-webhook.sender';
import { GALADRIM_ORIGIN_HEADER } from './galadrim.config';

const alice: IEventContext = { user: { id: 'usrAlice', name: 'Alice', email: 'alice@x.fr' } };
const bob: IEventContext = { user: { id: 'usrBob', name: 'Bob', email: 'bob@x.fr' } };
const record = (id: string) => ({ id, fields: {} }) as IRecord;

describe('GaladrimWebhookListener', () => {
  let requestHeaders: Record<string, string> | undefined;
  let send: ReturnType<typeof vi.fn>;
  let listener: GaladrimWebhookListener;

  const sent = () => send.mock.calls.map(([body]) => body as IGaladrimWebhookBody);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv('GALADRIM_WEBHOOK_URL', 'http://outline/api/teableHooks.receive');
    requestHeaders = undefined;
    send = vi.fn().mockResolvedValue(undefined);
    const cls = {
      get: (key: unknown) =>
        key === CLS_REQ && requestHeaders ? { headers: requestHeaders } : undefined,
    } as unknown as ClsService<IClsStore>;
    listener = new GaladrimWebhookListener(cls, { send } as unknown as GaladrimWebhookSender);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('batches the events of one table, actor and origin into one call', async () => {
    requestHeaders = { [GALADRIM_ORIGIN_HEADER]: 'outline:req-1' };
    listener.onRecordCreate(new RecordCreateEvent('tblA', [record('rec1'), record('rec2')], alice));
    listener.onRecordCreate(new RecordCreateEvent('tblA', record('rec3'), alice));
    listener.onRecordDelete(new RecordDeleteEvent('tblA', 'rec2', alice));
    expect(send).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(GALADRIM_BATCH_WINDOW_MS);

    expect(sent()).toEqual([
      {
        tableId: 'tblA',
        actor: { id: 'usrAlice', email: 'alice@x.fr' },
        origin: 'outline:req-1',
        events: [
          { kind: 'record.create', recordIds: ['rec1', 'rec2', 'rec3'] },
          { kind: 'record.delete', recordIds: ['rec2'] },
        ],
      },
    ]);
  });

  it('sends one call per table, per actor and per origin', async () => {
    listener.onRecordDelete(new RecordDeleteEvent('tblA', 'rec1', alice));
    listener.onRecordDelete(new RecordDeleteEvent('tblB', 'rec2', alice));
    listener.onRecordDelete(new RecordDeleteEvent('tblA', 'rec3', bob));
    requestHeaders = { [GALADRIM_ORIGIN_HEADER]: 'outline:req-2' };
    listener.onRecordDelete(new RecordDeleteEvent('tblA', 'rec4', alice));

    await vi.advanceTimersByTimeAsync(GALADRIM_BATCH_WINDOW_MS);

    expect(sent().map(({ tableId, actor, origin }) => [tableId, actor?.id, origin])).toEqual([
      ['tblA', 'usrAlice', null],
      ['tblB', 'usrAlice', null],
      ['tblA', 'usrBob', null],
      ['tblA', 'usrAlice', 'outline:req-2'],
    ]);
  });

  it('prefers the headers the event carries', async () => {
    requestHeaders = { [GALADRIM_ORIGIN_HEADER]: 'from-cls' };
    listener.onRecordDelete(
      new RecordDeleteEvent('tblA', 'rec1', {
        ...alice,
        headers: { [GALADRIM_ORIGIN_HEADER]: 'own' },
      })
    );
    await vi.advanceTimersByTimeAsync(GALADRIM_BATCH_WINDOW_MS);
    expect(sent()[0].origin).toBe('own');
  });

  it('reports cell changes before and after, and skips updates that change nothing', async () => {
    listener.onRecordUpdate(
      new RecordUpdateEvent(
        'tblA',
        [
          {
            id: 'rec1',
            fields: {
              fldName: { oldValue: 'Old', newValue: 'New' },
              fldSame: { oldValue: ['a'], newValue: ['a'] },
            },
          },
          { id: 'rec2', fields: { fldStatus: { oldValue: undefined, newValue: 'Done' } } },
        ],
        undefined,
        alice
      )
    );
    listener.onRecordUpdate(
      new RecordUpdateEvent(
        'tblA',
        { id: 'rec3', fields: { fldName: { oldValue: 'x', newValue: 'x' } } },
        undefined,
        alice
      )
    );
    await vi.advanceTimersByTimeAsync(GALADRIM_BATCH_WINDOW_MS);

    expect(sent()[0].events).toEqual([
      {
        kind: 'record.update',
        recordIds: ['rec1', 'rec2'],
        fieldIds: ['fldName', 'fldStatus'],
        changes: [
          { recordId: 'rec1', fieldId: 'fldName', before: 'Old', after: 'New' },
          { recordId: 'rec2', fieldId: 'fldStatus', before: null, after: 'Done' },
        ],
      },
    ]);
  });

  it('reports field and view ids', async () => {
    listener.onFieldChange(new FieldDeleteEvent('tblA', ['fld1', 'fld2'], alice));
    listener.onViewChange(new ViewUpdateEvent('tblA', { id: 'viw1' } as IChangeView, alice));
    await vi.advanceTimersByTimeAsync(GALADRIM_BATCH_WINDOW_MS);

    expect(sent()[0].events).toEqual([
      { kind: 'field', fieldIds: ['fld1', 'fld2'] },
      { kind: 'view', viewIds: ['viw1'] },
    ]);
  });

  it('sends a system change with a null actor', async () => {
    listener.onRecordDelete(new RecordDeleteEvent('tblA', 'rec1', {}));
    await vi.advanceTimersByTimeAsync(GALADRIM_BATCH_WINDOW_MS);
    expect(sent()[0].actor).toBeNull();
  });

  it('does nothing while GALADRIM_WEBHOOK_URL is unset', async () => {
    vi.stubEnv('GALADRIM_WEBHOOK_URL', '');
    listener.onRecordDelete(new RecordDeleteEvent('tblA', 'rec1', alice));
    await vi.advanceTimersByTimeAsync(GALADRIM_BATCH_WINDOW_MS);
    expect(send).not.toHaveBeenCalled();
  });

  it('flushes what is pending when the app stops', async () => {
    listener.onRecordDelete(new RecordDeleteEvent('tblA', 'rec1', alice));
    await listener.onModuleDestroy();
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(GALADRIM_BATCH_WINDOW_MS);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
