export const GALADRIM_SECRET_HEADER = 'x-galadrim-secret';
export const GALADRIM_ORIGIN_HEADER = 'x-galadrim-origin';

export const GALADRIM_TOKEN_TTL = '15m';

/** The account Outline acts as when no person is behind a call; it owns the space of Outline's bases. */
export const outlineServiceUser = { email: 'outline@galadrim.local', name: 'Outline' };

// Read on each call, not at boot: the e2e tests set them after the app has started.
export const getGaladrimSecret = () => process.env.GALADRIM_SECRET || undefined;
export const getGaladrimWebhookUrl = () => process.env.GALADRIM_WEBHOOK_URL || undefined;
