import { formatInTimeZone } from 'date-fns-tz';
import dayjs from 'dayjs';
// Locales of the UI languages (month names of the long date presets). English is built into dayjs.
import 'dayjs/locale/de';
import 'dayjs/locale/es';
import 'dayjs/locale/fr';
import 'dayjs/locale/it';
import 'dayjs/locale/ja';
import 'dayjs/locale/ru';
import 'dayjs/locale/tr';
import 'dayjs/locale/uk';
import 'dayjs/locale/zh-cn';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import { z } from '../../../zod';
import { timeZoneStringSchema } from './time-zone';

export enum DateFormattingPreset {
  US = 'M/D/YYYY',
  European = 'D/M/YYYY',
  Asian = 'YYYY/MM/DD',
  ISO = 'YYYY-MM-DD',
  YM = 'YYYY-MM',
  MD = 'MM-DD',
  Y = 'YYYY',
  M = 'MM',
  D = 'DD',
  // Long dates as Notion shows them: "1 juillet 2025" / "July 1, 2025". The month name follows the locale.
  LongDMY = 'D MMMM YYYY',
  LongMDY = 'MMMM D, YYYY',
}

dayjs.extend(customParseFormat);

const defaultDateLocale = 'en';
const dateLocaleAliases: Record<string, string> = { zh: 'zh-cn' };

export const LONG_DATE_FORMATTING_PRESETS: readonly string[] = [
  DateFormattingPreset.LongDMY,
  DateFormattingPreset.LongMDY,
];

/** true when the date preset contains a month name, i.e. its rendering depends on a locale */
export const isLongDateFormatting = (dateFormatting?: string): boolean =>
  dateFormatting != null && LONG_DATE_FORMATTING_PRESETS.includes(dateFormatting);

/** Maps a UI language ("fr", "fr-FR", "zh") to a dayjs locale loaded here, or "en" when there is none. */
export const resolveDateLocale = (lang?: string | null): string => {
  if (!lang) return defaultDateLocale;
  const full = lang.toLowerCase().replace('_', '-');
  const base = full.split('-')[0];
  const candidates = [full, dateLocaleAliases[full], base, dateLocaleAliases[base]];
  return candidates.find((name) => name != null && dayjs.Ls[name] != null) ?? defaultDateLocale;
};

// Server side (API cellFormat=text, CSV export, computed text) there is no per-request user language at this level:
// one instance-wide default, from the environment. Bundlers leave it undefined in the browser.
const envDateLocale =
  typeof process !== 'undefined' ? process.env?.DATE_FORMATTING_LOCALE : undefined;

let currentDateLocale = resolveDateLocale(envDateLocale);

/**
 * Locale of the month names in date formats ("D MMMM YYYY"). The web app sets it to the UI language
 * (sdk AppProvider); a server keeps the DATE_FORMATTING_LOCALE default (English when unset).
 * It never touches the global dayjs locale: only formats with a month name are affected.
 */
export const setDateFormattingLocale = (lang?: string | null) => {
  currentDateLocale = resolveDateLocale(lang);
  return currentDateLocale;
};

export const getDateFormattingLocale = () => currentDateLocale;

/** Locales tried, in order, when parsing a typed / pasted / imported long date. */
export const getDateParsingLocales = (locale?: string): string[] => [
  ...new Set([locale ? resolveDateLocale(locale) : currentDateLocale, 'fr', defaultDateLocale]),
];

/**
 * Parses "1 juillet 2025" / "July 1, 2025 14:30" against long-preset formats. Returns the wall-clock time as
 * "YYYY-MM-DD HH:mm" (no time zone applied yet) or null.
 */
export const parseLongDateString = (
  value: string,
  formats: string[],
  options?: { locale?: string; strict?: boolean }
): string | null => {
  const input = value.trim();
  for (const locale of getDateParsingLocales(options?.locale)) {
    for (const format of formats) {
      const parsed = dayjs(input, format, locale, options?.strict ?? true);
      if (parsed.isValid()) return parsed.format('YYYY-MM-DD HH:mm');
    }
  }
  return null;
};

export enum TimeFormatting {
  Hour24 = 'HH:mm',
  Hour12 = 'hh:mm A',
  None = 'None',
}

export const datetimeFormattingSchema = z
  .object({
    date: z.string().meta({
      description:
        'the display formatting of the date. you can use the following presets: ' +
        Object.values(DateFormattingPreset).join(', '),
    }),
    time: z.enum(TimeFormatting).meta({
      description:
        'the display formatting of the time. you can use the following presets: ' +
        Object.values(TimeFormatting).join(', '),
    }),
    timeZone: timeZoneStringSchema,
  })
  .describe(
    'Only be used in date field (date field or formula / rollup field with cellValueType equals dateTime)'
  )
  .meta({
    description:
      'caveat: the formatting is just a formatter, it dose not effect the storing value of the record',
  });

export type ITimeZoneString = string;

export type IDatetimeFormatting = z.infer<typeof datetimeFormattingSchema>;

export const defaultDatetimeFormatting: IDatetimeFormatting = {
  date: DateFormattingPreset.ISO,
  time: TimeFormatting.None,
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
};

export const formatDateToString = (
  cellValue: string | undefined,
  formatting?: IDatetimeFormatting,
  locale?: string
) => {
  if (cellValue == null) {
    return '';
  }

  const { date, time, timeZone } = formatting ?? defaultDatetimeFormatting;
  const format = time === TimeFormatting.None ? date : `${date} ${time}`;

  try {
    // any month name (long presets, but also the older free-form "friendly" formats such as "D MMM YYYY")
    if (/MMM/.test(date)) {
      // locale first: .locale() on a zoned instance clones it and drops the time zone offset
      return dayjs(cellValue)
        .locale(locale ? resolveDateLocale(locale) : currentDateLocale)
        .tz(timeZone)
        .format(format);
    }
    return dayjs(cellValue).tz(timeZone).format(format);
  } catch {
    // in export service case, crash in dayjs, so use date-fns-tz
    return formatInTimeZone(cellValue, timeZone, format.replace(/D/g, 'd').replace(/Y/g, 'y'));
  }
};

export const normalizeDateFormatting = (dateFormatting: string): string => {
  const validFormats = Object.values(DateFormattingPreset);
  if (validFormats.includes(dateFormatting as DateFormattingPreset)) {
    return dateFormatting;
  }
  return DateFormattingPreset.ISO;
};
