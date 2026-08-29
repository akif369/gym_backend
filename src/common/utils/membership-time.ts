/**
 * Membership time helpers.
 *
 * Memberships are calendar-day products.  We calculate their local-midnight
 * boundaries in the gym's IANA timezone and persist the resulting UTC instant.
 * `startAt` is inclusive; `expiresAt` is exclusive.
 */

const dateFormatterCache = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string) {
  let value = dateFormatterCache.get(timeZone);
  if (!value) {
    // Constructing this validates the configured IANA timezone as well.
    value = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    dateFormatterCache.set(timeZone, value);
  }
  return value;
}

function partsAt(date: Date, timeZone: string) {
  const parts = formatter(timeZone).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute'), second: get('second') };
}

/** Converts YYYY-MM-DD at 00:00 in an IANA timezone into its UTC instant. */
export function localMidnightToUtc(date: string, timeZone: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Invalid calendar date: ${date}`);
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const localAsUtc = Date.UTC(year, month - 1, day, 0, 0, 0);
  let candidate = new Date(localAsUtc);

  // Resolve timezone offset using Intl. Repeating once handles offset changes
  // close to a DST boundary without relying on the server timezone.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const observed = partsAt(candidate, timeZone);
    const observedAsUtc = Date.UTC(observed.year, observed.month - 1, observed.day, observed.hour, observed.minute, observed.second);
    candidate = new Date(candidate.getTime() + (localAsUtc - observedAsUtc));
  }
  return candidate;
}

export function dateInTimeZone(value: Date, timeZone: string): string {
  const { year, month, day } = partsAt(value, timeZone);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Adds calendar days without accidentally applying the Node process timezone. */
export function addCalendarDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const result = new Date(Date.UTC(year, month - 1, day + days));
  return result.toISOString().slice(0, 10);
}

/** Normalizes an ISO timestamp or YYYY-MM-DD input to the intended local date. */
export function localDateFromInput(value: string, timeZone: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) throw new Error(`Invalid membership start time: ${value}`);
  return dateInTimeZone(instant, timeZone);
}

export function formatMembershipDate(value: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-IN', { timeZone, day: '2-digit', month: 'short', year: 'numeric' }).format(value);
}
