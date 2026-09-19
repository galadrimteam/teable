/* eslint-disable sonarjs/no-duplicate-string */
import type { IDatetimeFormatting } from '@teable/core';
import { DateFormattingPreset, setDateFormattingLocale, TimeFormatting } from '@teable/core';
import { afterEach, describe, expect, it } from 'vitest';
import { convertZonedInputToUtc, formatDisplayValue } from './utils';

describe('date editor utils with the long date presets', () => {
  const formatting: IDatetimeFormatting = {
    date: DateFormattingPreset.LongDMY,
    time: TimeFormatting.Hour24,
    timeZone: 'Europe/Paris',
  };

  afterEach(() => {
    setDateFormattingLocale('en');
  });

  it('shows the month name in the UI language', () => {
    expect(formatDisplayValue('2025-07-01T12:30:00.000Z', formatting)).toBe('1 July 2025 14:30');
    setDateFormattingLocale('fr');
    expect(formatDisplayValue('2025-07-01T12:30:00.000Z', formatting)).toBe('1 juillet 2025 14:30');
  });

  it('reads back what it shows, in French and in English', () => {
    setDateFormattingLocale('fr');
    expect(convertZonedInputToUtc('1 juillet 2025 14:30', formatting)).toBe(
      '2025-07-01T12:30:00.000Z'
    );
    expect(convertZonedInputToUtc('15 août 2025 09:05', formatting)).toBe(
      '2025-08-15T07:05:00.000Z'
    );
    expect(convertZonedInputToUtc('1 July 2025 14:30', formatting)).toBe(
      '2025-07-01T12:30:00.000Z'
    );
    expect(
      convertZonedInputToUtc('July 1, 2025 14:30', {
        ...formatting,
        date: DateFormattingPreset.LongMDY,
      })
    ).toBe('2025-07-01T12:30:00.000Z');
  });

  it('rejects text that is not a date', () => {
    expect(convertZonedInputToUtc('1 Smarch 2025 14:30', formatting)).toBeNull();
    expect(convertZonedInputToUtc('', formatting)).toBeNull();
  });

  it('keeps the numeric presets working', () => {
    expect(
      convertZonedInputToUtc('1/7/2025 14:30', {
        ...formatting,
        date: DateFormattingPreset.European,
      })
    ).toBe('2025-07-01T12:30:00.000Z');
  });
});
