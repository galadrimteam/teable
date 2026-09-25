import { setTimeout as sleep } from 'timers/promises';
import { Injectable, Logger } from '@nestjs/common';
import { getGaladrimSecret, getGaladrimWebhookUrl } from './galadrim.config';

export type IGaladrimWebhookKind =
  | 'record.create'
  | 'record.update'
  | 'record.delete'
  | 'field'
  | 'view';

export interface IGaladrimCellChange {
  recordId: string;
  fieldId: string;
  before: unknown;
  after: unknown;
}

export interface IGaladrimWebhookEvent {
  kind: IGaladrimWebhookKind;
  recordIds?: string[];
  fieldIds?: string[];
  viewIds?: string[];
  changes?: IGaladrimCellChange[];
}

export interface IGaladrimWebhookBody {
  tableId: string;
  events: IGaladrimWebhookEvent[];
  actor: { id: string; email: string } | null;
  origin: string | null;
}

const maxAttempts = 4;
const firstRetryDelayMs = 500;
const requestTimeoutMs = 10_000;

/** POSTs a batch to GALADRIM_WEBHOOK_URL; retries with backoff, logs and gives up, never throws. */
@Injectable()
export class GaladrimWebhookSender {
  private readonly logger = new Logger(GaladrimWebhookSender.name);

  async send(body: IGaladrimWebhookBody): Promise<void> {
    const url = getGaladrimWebhookUrl();
    const secret = getGaladrimSecret();
    if (!url || !secret) {
      return;
    }
    for (let attempt = 1; ; attempt++) {
      const failure = await this.post(url, secret, body);
      if (!failure) {
        return;
      }
      if (!failure.retryable || attempt === maxAttempts) {
        this.logger.warn(
          `Webhook for table ${body.tableId} dropped after ${attempt} attempt(s): ${failure.reason}`
        );
        return;
      }
      await sleep(firstRetryDelayMs * 2 ** (attempt - 1));
    }
  }

  private async post(url: string, secret: string, body: IGaladrimWebhookBody) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        // eslint-disable-next-line @typescript-eslint/naming-convention
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
      await response.body?.cancel();
      if (response.ok) {
        return undefined;
      }
      return {
        reason: `HTTP ${response.status}`,
        retryable: response.status >= 500 || response.status === 429,
      };
    } catch (error) {
      return { reason: error instanceof Error ? error.message : String(error), retryable: true };
    }
  }
}
