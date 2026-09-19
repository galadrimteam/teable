/* eslint-disable @typescript-eslint/no-explicit-any, sonarjs/no-duplicate-string */
import type { IDatetimeFormatting } from './datetime';
import {
  datetimeFormattingSchema,
  DateFormattingPreset,
  formatDateToString,
  getDateFormattingLocale,
  getDateParsingLocales,
  isLongDateFormatting,
  normalizeDateFormatting,
  parseLongDateString,
  resolveDateLocale,
  setDateFormattingLocale,
  TimeFormatting,
} from './datetime';

const timeZone = 'utc';
const sampleDateStr = '2023-07-12T14:30:00Z';

describe('formatDateToString', () => {
  it('should correctly format date string', () => {
    const formatting: IDatetimeFormatting = {
      time: TimeFormatting.None,
      date: DateFormattingPreset.European,
      timeZone: timeZone,
    };
    expect(formatDateToString(sampleDateStr, formatting)).toBe('12/7/2023');
  });

  it('should return empty string for null', () => {
    const dateStr = null;
    expect(
      formatDateToString(dateStr as any, {
        time: TimeFormatting.None,
        date: DateFormattingPreset.European,
        timeZone: timeZone,
      })
    ).toBe('');
  });

  it('should correctly format date and time string', () => {
    const formatting: IDatetimeFormatting = {
      date: DateFormattingPreset.ISO,
      time: TimeFormatting.Hour24,
      timeZone: timeZone,
    };
    expect(formatDateToString(sampleDateStr, formatting)).toBe('2023-07-12 14:30');
  });

  it('should fallback to default formatting when formatting is undefined', () => {
    const formatted = formatDateToString(sampleDateStr);
    expect(formatted).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('should validate time zone', () => {
    expect(
      datetimeFormattingSchema.safeParse({
        date: DateFormattingPreset.ISO,
        time: TimeFormatting.Hour24,
        timeZone: timeZone,
      }).success
    ).toBeTruthy();

    expect(
      datetimeFormattingSchema.safeParse({
        date: DateFormattingPreset.ISO,
        time: TimeFormatting.Hour24,
        timeZone: 'xxx/xxx',
      }).success
    ).toBeFalsy();
  });
});

describe('long date presets', () => {
  const longDMY: IDatetimeFormatting = {
    date: DateFormattingPreset.LongDMY,
    time: TimeFormatting.None,
    timeZone,
  };
  const longMDY: IDatetimeFormatting = { ...longDMY, date: DateFormattingPreset.LongMDY };

  afterEach(() => {
    setDateFormattingLocale('en');
  });

  it('should be part of the presets and accepted by the schema', () => {
    expect(DateFormattingPreset.LongDMY).toBe('D MMMM YYYY');
    expect(DateFormattingPreset.LongMDY).toBe('MMMM D, YYYY');
    expect(datetimeFormattingSchema.safeParse(longDMY).success).toBeTruthy();
    expect(datetimeFormattingSchema.safeParse(longMDY).success).toBeTruthy();
    expect(normalizeDateFormatting(DateFormattingPreset.LongDMY)).toBe('D MMMM YYYY');
    expect(normalizeDateFormatting(DateFormattingPreset.LongMDY)).toBe('MMMM D, YYYY');
    expect(isLongDateFormatting('D MMMM YYYY')).toBe(true);
    expect(isLongDateFormatting('D/M/YYYY')).toBe(false);
    expect(isLongDateFormatting(undefined)).toBe(false);
  });

  it('should render English month names by default', () => {
    expect(getDateFormattingLocale()).toBe('en');
    expect(formatDateToString('2025-07-01T10:00:00Z', longDMY)).toBe('1 July 2025');
    expect(formatDateToString('2025-07-01T10:00:00Z', longMDY)).toBe('July 1, 2025');
  });

  it('should render month names in the configured locale', () => {
    expect(setDateFormattingLocale('fr')).toBe('fr');
    expect(formatDateToString('2025-07-01T10:00:00Z', longDMY)).toBe('1 juillet 2025');
    expect(formatDateToString('2025-08-15T10:00:00Z', longDMY)).toBe('15 août 2025');
    expect(
      formatDateToString('2025-07-01T14:30:00Z', { ...longDMY, time: TimeFormatting.Hour24 })
    ).toBe('1 juillet 2025 14:30');
    setDateFormattingLocale('de');
    expect(formatDateToString('2025-03-01T10:00:00Z', longDMY)).toBe('1 März 2025');
  });

  it('should let an explicit locale win over the configured one', () => {
    setDateFormattingLocale('fr');
    expect(formatDateToString('2025-07-01T10:00:00Z', longMDY, 'en')).toBe('July 1, 2025');
    expect(formatDateToString('2025-07-01T10:00:00Z', longDMY, 'es')).toBe('1 julio 2025');
  });

  it('should localise older free-form formats with a month name and leave numeric ones alone', () => {
    setDateFormattingLocale('fr');
    expect(formatDateToString('2025-07-01T10:00:00Z', { ...longDMY, date: 'D MMM YYYY' })).toBe(
      '1 juil. 2025'
    );
    expect(
      formatDateToString('2025-07-01T10:00:00Z', {
        ...longDMY,
        date: DateFormattingPreset.European,
      })
    ).toBe('1/7/2025');
  });

  it('should apply the time zone before formatting', () => {
    setDateFormattingLocale('fr');
    expect(
      formatDateToString('2025-06-30T23:30:00Z', { ...longDMY, timeZone: 'Europe/Paris' })
    ).toBe('1 juillet 2025');
  });

  it('should resolve UI languages to loaded dayjs locales', () => {
    expect(resolveDateLocale('fr')).toBe('fr');
    expect(resolveDateLocale('fr-FR')).toBe('fr');
    expect(resolveDateLocale('fr_CA')).toBe('fr');
    expect(resolveDateLocale('zh')).toBe('zh-cn');
    expect(resolveDateLocale('zh-CN')).toBe('zh-cn');
    expect(resolveDateLocale('en-GB')).toBe('en');
    expect(resolveDateLocale('xx')).toBe('en');
    expect(resolveDateLocale(undefined)).toBe('en');
    expect(resolveDateLocale(null)).toBe('en');
    expect(setDateFormattingLocale('unknown')).toBe('en');
  });

  it('should not change the global dayjs locale', async () => {
    const dayjs = (await import('dayjs')).default;
    setDateFormattingLocale('fr');
    formatDateToString('2025-07-01T10:00:00Z', longDMY);
    expect(dayjs.locale()).toBe('en');
    expect(dayjs('2025-07-01').format('MMMM')).toBe('July');
  });

  it('should parse long dates in the current locale, then French, then English', () => {
    expect(getDateParsingLocales()).toEqual(['en', 'fr']);
    expect(getDateParsingLocales('de')).toEqual(['de', 'fr', 'en']);
    expect(parseLongDateString('1 juillet 2025', ['D MMMM YYYY'])).toBe('2025-07-01 00:00');
    expect(parseLongDateString('1 July 2025', ['D MMMM YYYY'])).toBe('2025-07-01 00:00');
    expect(parseLongDateString(' 15 août 2025 ', ['D MMMM YYYY'])).toBe('2025-08-15 00:00');
    expect(parseLongDateString('July 1, 2025 14:30', ['MMMM D, YYYY HH:mm', 'MMMM D, YYYY'])).toBe(
      '2025-07-01 14:30'
    );
    setDateFormattingLocale('de');
    expect(parseLongDateString('1 März 2025', ['D MMMM YYYY'])).toBe('2025-03-01 00:00');
    expect(parseLongDateString('1 Smarch 2025', ['D MMMM YYYY'])).toBeNull();
    expect(parseLongDateString('01/07/2025', ['D MMMM YYYY'])).toBeNull();
  });
});
