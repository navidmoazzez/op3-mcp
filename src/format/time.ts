/**
 * Time windows.
 *
 * OP3 accepts an ISO timestamp, a plain date, or a relative value like `-24h`.
 * The relative form is what a model will reach for and it is the one worth
 * getting right, because a window that is wider than the caller meant is not an
 * error, it is a slow query and a wrong denominator.
 *
 * Everything here is UTC. Podcast download data crosses every timezone, so
 * picking the server's local zone would make the same query return different
 * numbers on two machines.
 */

const RELATIVE = /^-(\d+)([hdwm])$/i;

const UNIT_MS: Record<string, number> = {
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
  // "m" is months here, not minutes: OP3's own examples use -30d for a month,
  // and a model asking for "-3m" means three months every time.
  m: 2_592_000_000,
};

export type Window = {
  /** What to send to OP3 as `start`. */
  start: string;
  /** What to send as `end`, when the caller bounded it. */
  end?: string;
  /** Resolved absolute bounds, for computing rates and labelling output. */
  startMs: number;
  endMs: number;
  days: number;
};

/** Turn `-30d`, `2026-08-01` or a full ISO timestamp into epoch ms. */
export function parseInstant(value: string, now = Date.now()): number {
  const t = value.trim();

  const rel = RELATIVE.exec(t);
  if (rel) {
    const n = Number(rel[1]);
    const unit = (rel[2] ?? "d").toLowerCase();
    const ms = UNIT_MS[unit];
    if (ms === undefined) {
      throw new Error(`Unknown time unit "${rel[2]}". Use h, d, w or m, as in -24h, -30d, -8w, -3m.`);
    }
    return now - n * ms;
  }

  // A bare date is the start of that day in UTC. Date.parse already does this
  // for "YYYY-MM-DD", but not for "YYYY-M-D", so normalise first.
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(t)) {
    const [y, m, d] = t.split("-").map(Number) as [number, number, number];
    return Date.UTC(y, m - 1, d);
  }

  const parsed = Date.parse(t);
  if (Number.isNaN(parsed)) {
    throw new Error(
      `"${value}" is not a time OP3 understands. Use a relative value like -30d, a date like 2026-08-01, or an ISO timestamp.`,
    );
  }
  return parsed;
}

/**
 * Build a window from optional start and end.
 *
 * The default is thirty days, matching what OP3's own rolled-up endpoints
 * report, so a number from a firehose tool lines up with a number from a
 * rolled-up one instead of quietly disagreeing.
 */
export function buildWindow(
  start: string | undefined,
  end: string | undefined,
  now = Date.now(),
): Window {
  const startRaw = start?.trim() || "-30d";
  const startMs = parseInstant(startRaw, now);
  const endMs = end?.trim() ? parseInstant(end, now) : now;

  if (endMs <= startMs) {
    throw new Error(
      `The window ends before it starts: start=${new Date(startMs).toISOString()}, end=${new Date(endMs).toISOString()}.`,
    );
  }

  return {
    start: startRaw,
    end: end?.trim() || undefined,
    startMs,
    endMs,
    days: (endMs - startMs) / 86_400_000,
  };
}

/** A window as a label a person can read back, e.g. "-30d to now (30.0 days)". */
export function describeWindow(w: Window): string {
  return `${w.start} to ${w.end ?? "now"} (${w.days.toFixed(1)} days)`;
}

/** UTC date key, `YYYY-MM-DD`. The bucket key for daily series. */
export function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

/** ISO week key, `YYYY-Www`. Weeks start Monday, per ISO 8601. */
export function weekKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "invalid";
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  // Shift to the Thursday of this week, which is always in the ISO year.
  const dayNum = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  const week = 1 + Math.round((target.getTime() - firstThursday.getTime()) / 604_800_000);
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** Month key, `YYYY-MM`. */
export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

export const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;
