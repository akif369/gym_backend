import { describe, expect, it } from 'vitest';
import { addCalendarDays, dateInTimeZone, localMidnightToUtc } from './membership-time';

describe('membership calendar boundaries', () => {
  it('stores India local midnight as the correct UTC instant', () => {
    expect(localMidnightToUtc('2026-10-01', 'Asia/Kolkata').toISOString())
      .toBe('2026-09-30T18:30:00.000Z');
  });

  it('preserves a calendar-day duration across a DST change', () => {
    const start = localMidnightToUtc('2026-03-08', 'America/New_York');
    const expiry = localMidnightToUtc(addCalendarDays('2026-03-08', 30), 'America/New_York');

    expect(dateInTimeZone(start, 'America/New_York')).toBe('2026-03-08');
    expect(dateInTimeZone(expiry, 'America/New_York')).toBe('2026-04-07');
    expect(expiry.getTime() - start.getTime()).toBe(29 * 24 * 60 * 60 * 1000 + 23 * 60 * 60 * 1000);
  });
});
