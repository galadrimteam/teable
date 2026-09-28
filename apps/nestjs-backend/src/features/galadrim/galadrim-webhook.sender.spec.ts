import { GaladrimWebhookSender } from './galadrim-webhook.sender';
import type { IGaladrimWebhookBody } from './galadrim-webhook.sender';

vi.mock('timers/promises', () => ({ setTimeout: vi.fn().mockResolvedValue(undefined) }));

const body: IGaladrimWebhookBody = {
  tableId: 'tblA',
  events: [{ kind: 'record.delete', recordIds: ['rec1'] }],
  actor: null,
  origin: null,
};

const reply = (status: number) => new Response(null, { status });

describe('GaladrimWebhookSender', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const sender = new GaladrimWebhookSender();

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('GALADRIM_WEBHOOK_URL', 'http://outline/api/teableHooks.receive');
    vi.stubEnv('GALADRIM_SECRET', 's3cret');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('POSTs the body with the secret as bearer', async () => {
    fetchMock.mockResolvedValue(reply(200));
    await sender.send(body);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://outline/api/teableHooks.receive');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer s3cret');
    expect(JSON.parse(init.body)).toEqual(body);
  });

  it('retries server errors and network failures, then succeeds', async () => {
    fetchMock
      .mockResolvedValueOnce(reply(502))
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce(reply(204));
    await sender.send(body);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('gives up after three retries without throwing', async () => {
    fetchMock.mockResolvedValue(reply(503));
    await expect(sender.send(body)).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('does not retry a request Outline refused', async () => {
    fetchMock.mockResolvedValue(reply(401));
    await sender.send(body);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sends nothing without a URL or a secret', async () => {
    vi.stubEnv('GALADRIM_SECRET', '');
    await sender.send(body);
    vi.stubEnv('GALADRIM_SECRET', 's3cret');
    vi.stubEnv('GALADRIM_WEBHOOK_URL', '');
    await sender.send(body);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
