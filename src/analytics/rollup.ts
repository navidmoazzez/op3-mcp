/**
 * Counting things, and the share arithmetic that goes with it.
 *
 * Every distribution this server reports goes through here so that "share"
 * means the same thing everywhere: a percentage of the rows that had a value
 * for that dimension, not of all rows. Those differ whenever a field is
 * sometimes absent, which for OP3 is often, and mixing the two denominators in
 * one response is how a table stops adding up to 100.
 */

/** One line of a distribution. */
export type Bucket = {
  key: string;
  count: number;
  /** Percentage of rows that had a value for this dimension, to 2dp. */
  share: number;
};

export type Distribution = {
  buckets: Bucket[];
  /** Rows that had a value for this dimension. The denominator for `share`. */
  counted: number;
  /** Rows with no value, excluded from `share`. */
  missing: number;
  /** Distinct values seen, before any `top` cut. */
  distinct: number;
  /** Buckets omitted by a `top` cut, folded into one number. */
  otherCount?: number;
};

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Roll rows up by a key function.
 *
 * `top` keeps the largest N and reports the rest as `otherCount` rather than
 * dropping them, because a long tail that silently vanishes makes the visible
 * shares look larger than they are.
 */
export function distribution<T>(
  rows: T[],
  keyOf: (row: T) => string | undefined,
  options: { top?: number } = {},
): Distribution {
  const counts = new Map<string, number>();
  let missing = 0;

  for (const row of rows) {
    const key = keyOf(row);
    if (key === undefined || key === "") {
      missing++;
      continue;
    }
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const counted = rows.length - missing;
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const distinct = sorted.length;

  const top = options.top;
  const kept = top && top > 0 ? sorted.slice(0, top) : sorted;
  const otherCount = top && top > 0 ? sorted.slice(top).reduce((s, [, n]) => s + n, 0) : 0;

  return {
    buckets: kept.map(([key, count]) => ({
      key,
      count,
      share: counted > 0 ? round2((count / counted) * 100) : 0,
    })),
    counted,
    missing,
    distinct,
    ...(otherCount > 0 ? { otherCount } : {}),
  };
}

/**
 * Distinct values of a key across rows.
 *
 * The building block for every unique-listener figure. Kept separate from
 * `distribution` because the cardinality is the answer here, not the shape.
 */
export function distinctCount<T>(rows: T[], keyOf: (row: T) => string | undefined): number {
  return distinctSet(rows, keyOf).size;
}

/** The set itself, when a later step needs to intersect it. */
export function distinctSet<T>(rows: T[], keyOf: (row: T) => string | undefined): Set<string> {
  const seen = new Set<string>();
  for (const row of rows) {
    const key = keyOf(row);
    if (key) seen.add(key);
  }
  return seen;
}

/** Rows grouped by key, when the group contents are needed rather than a count. */
export function groupBy<T>(rows: T[], keyOf: (row: T) => string | undefined): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const row of rows) {
    const key = keyOf(row);
    if (key === undefined || key === "") continue;
    const bucket = out.get(key);
    if (bucket) bucket.push(row);
    else out.set(key, [row]);
  }
  return out;
}

/** Count of members of `a` that also appear in `b`. */
export function intersectionSize(a: Set<string>, b: Set<string>): number {
  let shared = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const v of small) if (large.has(v)) shared++;
  return shared;
}

/**
 * Jaccard similarity as a percentage: shared members over combined members.
 *
 * Used for episode audience overlap. Chosen over a plain shared count because
 * two episodes with very different audience sizes always share few listeners in
 * absolute terms, which makes raw counts unreadable as a similarity.
 */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  const shared = intersectionSize(a, b);
  const union = a.size + b.size - shared;
  return union === 0 ? 0 : round2((shared / union) * 100);
}

export const percent = (part: number, whole: number): number =>
  whole > 0 ? round2((part / whole) * 100) : 0;

export { round2 };
