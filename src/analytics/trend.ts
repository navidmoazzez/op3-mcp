/**
 * Time: series, growth, listening patterns, and the episode curve.
 *
 * The episode curve is the one worth explaining. Podcast episodes are not
 * comparable at a point in time, because a two-year-old episode has had two
 * years to accumulate downloads and last week's has had a week. The only fair
 * comparison is at equal age: downloads by day N after publication, against the
 * same show's median at day N. That converts "is this episode doing well" from
 * a question nobody can answer into arithmetic.
 */

import type { DownloadRow } from "../api/types.js";
import { dayKey, monthKey, WEEKDAYS, weekKey } from "../format/time.js";
import { distinctSet, percent, round2 } from "./rollup.js";

export type SeriesPoint = {
  period: string;
  downloads: number;
  uniqueListeners: number;
};

export type Series = {
  granularity: "day" | "week" | "month";
  points: SeriesPoint[];
  totalDownloads: number;
  totalUniqueListeners: number;
  /** Change from the first half of the window to the second, as a percentage. */
  growthRate: number;
  /** Mean downloads per period. */
  average: number;
  peak?: SeriesPoint;
};

const keyFor = (granularity: "day" | "week" | "month") =>
  granularity === "day" ? dayKey : granularity === "week" ? weekKey : monthKey;

/**
 * Bucket rows into a time series.
 *
 * Growth compares the two halves of the window rather than first period against
 * last. A single quiet Sunday at the end of a window would otherwise report a
 * collapse, and podcast downloads are weekly-seasonal enough that endpoint
 * comparisons are close to noise.
 */
export function series(
  rows: DownloadRow[],
  granularity: "day" | "week" | "month",
): Series {
  const key = keyFor(granularity);
  const buckets = new Map<string, DownloadRow[]>();

  for (const row of rows) {
    if (!row.time) continue;
    const k = key(row.time);
    const bucket = buckets.get(k);
    if (bucket) bucket.push(row);
    else buckets.set(k, [row]);
  }

  const points: SeriesPoint[] = [...buckets.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([period, periodRows]) => ({
      period,
      downloads: periodRows.length,
      uniqueListeners: distinctSet(periodRows, (r) => r.audienceId).size,
    }));

  const half = Math.floor(points.length / 2);
  const firstHalf = points.slice(0, half).reduce((s, p) => s + p.downloads, 0);
  const secondHalf = points.slice(points.length - half).reduce((s, p) => s + p.downloads, 0);

  const peak = points.reduce<SeriesPoint | undefined>(
    (best, p) => (!best || p.downloads > best.downloads ? p : best),
    undefined,
  );

  return {
    granularity,
    points,
    totalDownloads: rows.length,
    totalUniqueListeners: distinctSet(rows, (r) => r.audienceId).size,
    // Undefined growth is reported as 0 rather than Infinity: a window with no
    // first half has no growth to report, and Infinity does not serialise.
    growthRate: firstHalf > 0 ? round2(((secondHalf - firstHalf) / firstHalf) * 100) : 0,
    average: points.length > 0 ? round2(rows.length / points.length) : 0,
    ...(peak ? { peak } : {}),
  };
}

export type ListeningPatterns = {
  byHourUtc: { hour: number; downloads: number; share: number }[];
  byWeekday: { weekday: string; downloads: number; share: number }[];
  busiestHourUtc?: number;
  busiestWeekday?: string;
  note: string;
};

/**
 * When downloads happen.
 *
 * Reported in UTC and labelled as such. The row carries the listener's
 * `timezone`, but a podcast app's scheduled refresh fires on the app's
 * schedule, not when a person chose to listen, so calling this "when your
 * audience listens" would be a stronger claim than the data supports.
 */
export function listeningPatterns(rows: DownloadRow[]): ListeningPatterns {
  const hours = new Array<number>(24).fill(0);
  const days = new Array<number>(7).fill(0);
  let counted = 0;

  for (const row of rows) {
    if (!row.time) continue;
    const d = new Date(row.time);
    if (Number.isNaN(d.getTime())) continue;
    hours[d.getUTCHours()]! += 1;
    days[d.getUTCDay()]! += 1;
    counted++;
  }

  const byHourUtc = hours.map((downloads, hour) => ({
    hour,
    downloads,
    share: percent(downloads, counted),
  }));
  const byWeekday = days.map((downloads, i) => ({
    weekday: WEEKDAYS[i]!,
    downloads,
    share: percent(downloads, counted),
  }));

  const busiestHour = byHourUtc.reduce((a, b) => (b.downloads > a.downloads ? b : a), byHourUtc[0]!);
  const busiestDay = byWeekday.reduce((a, b) => (b.downloads > a.downloads ? b : a), byWeekday[0]!);

  return {
    byHourUtc,
    byWeekday,
    ...(counted > 0 ? { busiestHourUtc: busiestHour.hour, busiestWeekday: busiestDay.weekday } : {}),
    note: "Times are UTC. A download is when an app fetched the file, which for a scheduled background refresh is not when a person pressed play. Read this as request timing, not listening behaviour.",
  };
}

export type CurvePoint = {
  dayAfterPublish: number;
  downloads: number;
  cumulative: number;
  /** The show's median cumulative at this age, across the compared episodes. */
  medianCumulative?: number;
  /** This episode against that median, as a percentage. 100 means on par. */
  vsMedian?: number;
};

export type EpisodeCurve = {
  episodeId: string;
  title?: string;
  pubdate?: string;
  ageDays: number;
  points: CurvePoint[];
  comparedEpisodes: number;
  verdict?: string;
};

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/** Cumulative downloads by day-after-publish for one set of rows. */
function cumulativeByAge(rows: DownloadRow[], pubMs: number, horizonDays: number): number[] {
  const perDay = new Array<number>(horizonDays + 1).fill(0);
  for (const row of rows) {
    if (!row.time) continue;
    const t = Date.parse(row.time);
    if (Number.isNaN(t) || t < pubMs) continue;
    const age = Math.floor((t - pubMs) / 86_400_000);
    if (age >= 0 && age <= horizonDays) perDay[age]! += 1;
  }
  const cumulative = new Array<number>(horizonDays + 1).fill(0);
  let running = 0;
  for (let i = 0; i <= horizonDays; i++) {
    running += perDay[i]!;
    cumulative[i] = running;
  }
  return cumulative;
}

/**
 * One episode's curve against the show's median at the same age.
 *
 * Only episodes at least as old as the horizon go into the median. Including a
 * three-day-old episode in a thirty-day median drags it toward zero and makes
 * everything look like it is over-performing.
 */
export function episodeCurve(
  target: { episodeId: string; title?: string; pubdate?: string; rows: DownloadRow[] },
  others: { episodeId: string; pubdate?: string; rows: DownloadRow[] }[],
  horizonDays: number,
  now = Date.now(),
): EpisodeCurve {
  const pubMs = target.pubdate ? Date.parse(target.pubdate) : NaN;
  if (Number.isNaN(pubMs)) {
    return {
      episodeId: target.episodeId,
      title: target.title,
      ageDays: 0,
      points: [],
      comparedEpisodes: 0,
      verdict: "No publication date for this episode, so there is no age to compare against.",
    };
  }

  const ageDays = Math.floor((now - pubMs) / 86_400_000);
  const horizon = Math.min(horizonDays, Math.max(ageDays, 0));
  const targetCurve = cumulativeByAge(target.rows, pubMs, horizon);

  const comparable = others.filter((o) => {
    if (!o.pubdate) return false;
    const t = Date.parse(o.pubdate);
    if (Number.isNaN(t)) return false;
    return (now - t) / 86_400_000 >= horizon;
  });

  const otherCurves = comparable.map((o) =>
    cumulativeByAge(o.rows, Date.parse(o.pubdate!), horizon),
  );

  const points: CurvePoint[] = [];
  for (let day = 0; day <= horizon; day++) {
    const cumulative = targetCurve[day]!;
    const previous = day > 0 ? targetCurve[day - 1]! : 0;
    const med = otherCurves.length > 0 ? median(otherCurves.map((c) => c[day]!)) : undefined;
    points.push({
      dayAfterPublish: day,
      downloads: cumulative - previous,
      cumulative,
      ...(med !== undefined ? { medianCumulative: round2(med) } : {}),
      ...(med !== undefined && med > 0
        ? { vsMedian: round2((cumulative / med) * 100) }
        : {}),
    });
  }

  const last = points[points.length - 1];
  let verdict: string | undefined;
  if (last?.vsMedian !== undefined) {
    const pct = last.vsMedian;
    verdict =
      pct >= 120
        ? `Ahead of pace. At day ${last.dayAfterPublish} this episode is at ${pct}% of the show's median.`
        : pct <= 80
          ? `Behind pace. At day ${last.dayAfterPublish} this episode is at ${pct}% of the show's median.`
          : `On pace. At day ${last.dayAfterPublish} this episode is at ${pct}% of the show's median.`;
  } else if (otherCurves.length === 0) {
    verdict = `No other episode is at least ${horizon} days old, so there is nothing to compare this against yet.`;
  }

  return {
    episodeId: target.episodeId,
    title: target.title,
    pubdate: target.pubdate,
    ageDays,
    points,
    comparedEpisodes: otherCurves.length,
    ...(verdict ? { verdict } : {}),
  };
}

export type BenchmarkRow = {
  app: string;
  showShare: number;
  globalShare: number;
  /** showShare / globalShare as a percentage. 100 is exactly average. */
  index: number;
  reading: string;
};

/**
 * This show's app mix against OP3's global mix.
 *
 * The index is the useful column. A show can be 40% Apple Podcasts and be
 * under-indexed, because Apple is 38% globally. Raw share says "Apple is your
 * biggest app", which is true of nearly every show and therefore tells you
 * nothing. The index says where this audience is actually unusual.
 */
export function benchmarkApps(
  showShares: Map<string, number>,
  globalShares: Record<string, number>,
  minShowShare = 0.5,
): BenchmarkRow[] {
  const out: BenchmarkRow[] = [];

  for (const [app, showShare] of showShares) {
    if (showShare < minShowShare) continue;
    const globalShare = globalShares[app];
    if (globalShare === undefined || globalShare <= 0) {
      out.push({
        app,
        showShare: round2(showShare),
        globalShare: 0,
        index: 0,
        reading: "Not in OP3's global top apps, so there is no benchmark for it.",
      });
      continue;
    }
    const index = round2((showShare / globalShare) * 100);
    out.push({
      app,
      showShare: round2(showShare),
      globalShare: round2(globalShare),
      index,
      reading:
        index >= 150
          ? `Over-indexed. This audience uses ${app} ${round2(index / 100)}x as much as podcast listeners generally.`
          : index <= 66
            ? `Under-indexed. This audience uses ${app} well below the global rate.`
            : "About average.",
    });
  }

  return out.sort((a, b) => b.index - a.index);
}
