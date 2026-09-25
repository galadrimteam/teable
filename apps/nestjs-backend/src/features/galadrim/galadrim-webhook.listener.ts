import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { Request } from 'express';
import { isEqual, isObject, union, uniq } from 'lodash';
import { CLS_REQ, ClsService } from 'nestjs-cls';
import type {
  CoreEvent,
  FieldCreateEvent,
  FieldDeleteEvent,
  FieldUpdateEvent,
  ViewCreateEvent,
  ViewDeleteEvent,
  ViewUpdateEvent,
} from '../../event-emitter/events';
import {
  Events,
  RecordCreateEvent,
  RecordDeleteEvent,
  RecordUpdateEvent,
} from '../../event-emitter/events';
import type { IClsStore } from '../../types/cls';
import type {
  IGaladrimCellChange,
  IGaladrimWebhookBody,
  IGaladrimWebhookEvent,
  IGaladrimWebhookKind,
} from './galadrim-webhook.sender';
import { GaladrimWebhookSender } from './galadrim-webhook.sender';
import { GALADRIM_ORIGIN_HEADER, getGaladrimWebhookUrl } from './galadrim.config';

export const GALADRIM_BATCH_WINDOW_MS = 300;

interface IPendingBatch {
  body: Omit<IGaladrimWebhookBody, 'events'>;
  events: Map<IGaladrimWebhookKind, IGaladrimWebhookEvent>;
  timer: NodeJS.Timeout;
}

type ITableEvent = CoreEvent<{ tableId: string }>;

const ids = (items: { id: string } | { id: string }[]) => [items].flat().map(({ id }) => id);

const cellChanges = (event: RecordUpdateEvent): IGaladrimCellChange[] =>
  [event.payload.record].flat().flatMap(({ id: recordId, fields }) =>
    Object.entries(fields)
      .filter(([, change]) => isObject(change) && 'newValue' in change)
      .filter(([, { oldValue, newValue }]) => !isEqual(oldValue, newValue))
      .map(([fieldId, { oldValue, newValue }]) => ({
        recordId,
        fieldId,
        before: oldValue ?? null,
        after: newValue ?? null,
      }))
  );

const mergeEvent = (
  events: Map<IGaladrimWebhookKind, IGaladrimWebhookEvent>,
  event: IGaladrimWebhookEvent
) => {
  const current = events.get(event.kind);
  if (!current) {
    events.set(event.kind, event);
    return;
  }
  for (const key of ['recordIds', 'fieldIds', 'viewIds'] as const) {
    if (event[key]) {
      current[key] = union(current[key] ?? [], event[key]);
    }
  }
  if (event.changes) {
    current.changes = [...(current.changes ?? []), ...event.changes];
  }
};

/**
 * Tells Outline what changed in a table: Teable's v1 write path emits these events after each committed
 * transaction; they are batched per (table, actor, origin) for GALADRIM_BATCH_WINDOW_MS, then POSTed.
 */
@Injectable()
export class GaladrimWebhookListener implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GaladrimWebhookListener.name);
  private readonly pending = new Map<string, IPendingBatch>();

  constructor(
    private readonly cls: ClsService<IClsStore>,
    private readonly sender: GaladrimWebhookSender
  ) {}

  onModuleInit() {
    // Teable's v2 write path (features/canary) emits no record events: its writes would never reach Outline.
    if (process.env.FORCE_V2_ALL === 'true') {
      this.logger.warn('FORCE_V2_ALL=true: record changes will not reach GALADRIM_WEBHOOK_URL');
    }
  }

  async onModuleDestroy() {
    await Promise.all([...this.pending.keys()].map((key) => this.flush(key)));
  }

  @OnEvent(Events.TABLE_RECORD_CREATE, { async: true })
  onRecordCreate(event: RecordCreateEvent) {
    this.enqueue(event, { kind: 'record.create', recordIds: ids(event.payload.record) });
  }

  @OnEvent(Events.TABLE_RECORD_UPDATE, { async: true })
  onRecordUpdate(event: RecordUpdateEvent) {
    const changes = cellChanges(event);
    if (!changes.length) {
      return;
    }
    this.enqueue(event, {
      kind: 'record.update',
      recordIds: uniq(changes.map(({ recordId }) => recordId)),
      fieldIds: uniq(changes.map(({ fieldId }) => fieldId)),
      changes,
    });
  }

  @OnEvent(Events.TABLE_RECORD_DELETE, { async: true })
  onRecordDelete(event: RecordDeleteEvent) {
    this.enqueue(event, { kind: 'record.delete', recordIds: [event.payload.recordId].flat() });
  }

  @OnEvent(Events.TABLE_FIELD_CREATE, { async: true })
  @OnEvent(Events.TABLE_FIELD_UPDATE, { async: true })
  @OnEvent(Events.TABLE_FIELD_DELETE, { async: true })
  onFieldChange(event: FieldCreateEvent | FieldUpdateEvent | FieldDeleteEvent) {
    const { payload } = event;
    const fieldIds = 'fieldId' in payload ? [payload.fieldId].flat() : ids(payload.field);
    this.enqueue(event, { kind: 'field', fieldIds });
  }

  @OnEvent(Events.TABLE_VIEW_CREATE, { async: true })
  @OnEvent(Events.TABLE_VIEW_UPDATE, { async: true })
  @OnEvent(Events.TABLE_VIEW_DELETE, { async: true })
  onViewChange(event: ViewCreateEvent | ViewUpdateEvent | ViewDeleteEvent) {
    const { payload } = event;
    const viewIds = 'viewId' in payload ? [payload.viewId].flat() : ids(payload.view);
    this.enqueue(event, { kind: 'view', viewIds });
  }

  private enqueue(event: ITableEvent, webhookEvent: IGaladrimWebhookEvent) {
    if (!getGaladrimWebhookUrl()) {
      return;
    }
    const { tableId } = event.payload;
    const user = event.context.user;
    const actor = user ? { id: user.id, email: user.email } : null;
    const origin = this.originOf(event);
    const key = JSON.stringify([tableId, actor?.id ?? null, origin]);
    let batch = this.pending.get(key);
    if (!batch) {
      const timer = setTimeout(() => this.flush(key), GALADRIM_BATCH_WINDOW_MS).unref();
      batch = { body: { tableId, actor, origin }, events: new Map(), timer };
      this.pending.set(key, batch);
    }
    mergeEvent(batch.events, webhookEvent);
  }

  // Events built from ShareDB ops carry no headers; the request is still reachable through CLS, which async listeners inherit.
  private originOf(event: ITableEvent): string | null {
    const headers =
      event.context.headers ?? (this.cls.get(CLS_REQ) as Request | undefined)?.headers;
    const origin = headers?.[GALADRIM_ORIGIN_HEADER];
    return typeof origin === 'string' ? origin : null;
  }

  private async flush(key: string) {
    const batch = this.pending.get(key);
    if (!batch) {
      return;
    }
    clearTimeout(batch.timer);
    this.pending.delete(key);
    await this.sender.send({ ...batch.body, events: [...batch.events.values()] });
  }
}
