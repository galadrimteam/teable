export const GALADRIM_SECRET_HEADER = 'x-galadrim-secret';
export const GALADRIM_ORIGIN_HEADER = 'x-galadrim-origin';

export const GALADRIM_TOKEN_TTL = '15m';

/** The account Outline acts as when no person is behind a call; it owns the space of Outline's bases. */
export const outlineServiceUser = { email: 'outline@galadrim.local', name: 'Outline' };

// Read on each call, not at boot: the e2e tests set them after the app has started.
export const getGaladrimSecret = () => process.env.GALADRIM_SECRET || undefined;
export const getGaladrimWebhookUrl = () => process.env.GALADRIM_WEBHOOK_URL || undefined;
/** Where people who are not Teable admins are sent when they open Teable's own pages; unset keeps them in Teable. */
export const getGaladrimOutlineUrl = () => process.env.GALADRIM_OUTLINE_URL || undefined;
/** E-mails allowed into Teable's UI besides its instance admins, comma separated. */
export const getGaladrimTeableAdmins = () =>
  (process.env.GALADRIM_TEABLE_ADMINS || '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
