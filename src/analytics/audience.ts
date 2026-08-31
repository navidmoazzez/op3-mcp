/**
 * The audience layer, which is the reason this server exists.
 *
 * OP3's rolled-up endpoints report downloads. Downloads are not people. One
 * listener whose app re-requests a file across three days is three downloads,
 * and a show whose audience is small and loyal looks identical to one whose
 * audience is large and never returns.
 *
 * The raw download row carries `audienceId`, a privacy-preserving stable
 * listener hash. Counting distinct values of it over a window answers the
 * question the download count cannot: how many people, not how many requests.
 *
 * Every function here takes rows and returns counts and rates. No identifier
 * ever appears in a return value. See `format/redact.ts` for why that line is
 * drawn where it is.
 */

import type { DownloadRow } from "../api/types.js";
import { distinctSet, intersectionSize, jaccard, percent, round2 } from "./rollup.js";

const audienceOf = (row: DownloadRow): string | undefined => row.audienceId;

export type AudienceSummary = {
  downloads: number;
  uniqueListeners: number;
  /** Downloads per listener. Above ~1.5 means repeat requests dominate. */
  downloadsPerListener: number;
  /** Rows with no audienceId, which cannot be attributed to a listener. */
  unattributed: number;
  episodesCovered: number;
};

/**
 * Downloads against people, for one window.
 *
 * `downloadsPerListener` is the number worth reading. Close to 1 means each
 * download is a distinct person. Well above 1 means apps re-requesting, which
 * inflates every download figure the industry quotes.
 */
export function audienceSummary(rows: DownloadRow[]): AudienceSummary {
  const listeners = distinctSet(rows, audienceOf);
  const unattributed = rows.filter((r) => !r.audienceId).length;
  const episodes = distinctSet(rows, (r) => r.episodeId);

  return {
    downloads: rows.length,
    uniqueListeners: listeners.size,
    downloadsPerListener: listeners.size > 0 ? round2(rows.length / listeners.size) : 0,
    unattributed,
    episodesCovered: episodes.size,
  };
}

export type NewVsReturning = {
  windowListeners: number;
  newListeners: number;
  returningListeners: number;
  newShare: number;
  returningShare: number;
  priorWindowListeners: number;
};

/**
 * Split a window's listeners into first-timers and repeats.
 *
 * "New" means not seen in the baseline rows, so the answer is only as good as
 * the baseline is long. A one-week baseline will call a monthly listener new.
 * Callers pass a baseline several times the window for this reason, and the
 * tool reports both sizes so the caller can judge it.
 */
export function newVsReturning(
  windowRows: DownloadRow[],
  baselineRows: DownloadRow[],
): NewVsReturning {
  const current = distinctSet(windowRows, audienceOf);
  const prior = distinctSet(baselineRows, audienceOf);

  const returning = intersectionSize(current, prior);
  const fresh = current.size - returning;

  return {
    windowListeners: current.size,
    newListeners: fresh,
    returningListeners: returning,
    newShare: percent(fresh, current.size),
    returningShare: percent(returning, current.size),
    priorWindowListeners: prior.size,
  };
}

export type Retention = {
  cohortListeners: number;
  laterListeners: number;
  retainedListeners: number;
  /** Share of the earlier cohort that showed up again later. */
  retentionRate: number;
  /** Share of the later period that is carried over rather than new. */
  carryOverShare: number;
  churnedListeners: number;
};

/**
 * Cohort carry-over between two periods.
 *
 * Two numbers, and they answer different questions. `retentionRate` is how much
 * of the old audience came back, which measures whether the show holds people.
 * `carryOverShare` is how much of the new period is old faces, which measures
 * whether the show is growing or recycling. A show can score well on one and
 * badly on the other, and reporting only one hides that.
 */
export function retention(cohortRows: DownloadRow[], laterRows: DownloadRow[]): Retention {
  const cohort = distinctSet(cohortRows, audienceOf);
  const later = distinctSet(laterRows, audienceOf);
  const retained = intersectionSize(cohort, later);

  return {
    cohortListeners: cohort.size,
    laterListeners: later.size,
    retainedListeners: retained,
    retentionRate: percent(retained, cohort.size),
    carryOverShare: percent(retained, later.size),
    churnedListeners: cohort.size - retained,
  };
}

export type EpisodeAudience = {
  episodeId: string;
  title?: string;
  downloads: number;
  uniqueListeners: number;
  downloadsPerListener: number;
};

export type OverlapPair = {
  a: string;
  b: string;
  aTitle?: string;
  bTitle?: string;
  sharedListeners: number;
  /** Shared over combined, as a percentage. */
  similarity: number;
  /** Share of the smaller episode's audience that also heard the other. */
  smallerSideShare: number;
};

/**
 * Which episodes share an audience.
 *
 * Reports both a symmetric similarity and the smaller side's share, because for
 * a big episode and a small one the symmetric number is always near zero while
 * the smaller side's share can be near total. The second is usually the
 * interesting one: it says whether a spike brought new people or just gave the
 * existing audience another thing to download.
 */
export function episodeOverlap(
  rows: DownloadRow[],
  titles: Map<string, string | undefined>,
  options: { topEpisodes?: number } = {},
): { episodes: EpisodeAudience[]; pairs: OverlapPair[] } {
  const byEpisode = new Map<string, DownloadRow[]>();
  for (const row of rows) {
    if (!row.episodeId) continue;
    const bucket = byEpisode.get(row.episodeId);
    if (bucket) bucket.push(row);
    else byEpisode.set(row.episodeId, [row]);
  }

  const ranked = [...byEpisode.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, options.topEpisodes ?? 10);

  const sets = new Map<string, Set<string>>();
  const episodes: EpisodeAudience[] = ranked.map(([episodeId, episodeRows]) => {
    const listeners = distinctSet(episodeRows, audienceOf);
    sets.set(episodeId, listeners);
    return {
      episodeId,
      title: titles.get(episodeId),
      downloads: episodeRows.length,
      uniqueListeners: listeners.size,
      downloadsPerListener:
        listeners.size > 0 ? round2(episodeRows.length / listeners.size) : 0,
    };
  });

  const pairs: OverlapPair[] = [];
  for (let i = 0; i < episodes.length; i++) {
    for (let j = i + 1; j < episodes.length; j++) {
      const a = episodes[i]!;
      const b = episodes[j]!;
      const setA = sets.get(a.episodeId)!;
      const setB = sets.get(b.episodeId)!;
      const shared = intersectionSize(setA, setB);
      const smaller = Math.min(setA.size, setB.size);
      pairs.push({
        a: a.episodeId,
        b: b.episodeId,
        aTitle: a.title,
        bTitle: b.title,
        sharedListeners: shared,
        similarity: jaccard(setA, setB),
        smallerSideShare: percent(shared, smaller),
      });
    }
  }

  pairs.sort((x, y) => y.sharedListeners - x.sharedListeners);
  return { episodes, pairs };
}
