/**
 * The OP3 HTTP client.
 *
 * Three things here are load-bearing and none of them are obvious from the API
 * docs, so they are worth stating up front.
 *
 * **The firehose is a scan.** `/downloads/show/{uuid}` took 2790ms to return
 * two rows when probed. Cost scales with the window, not the row count. So
 * every caller passes a bounded window, requests are spaced, and paging stops
 * at a cap rather than running until the data does.
 *
 * **Paging is by opaque continuation token, not offset.** A page that returns a
 * token identical to the one sent, or no rows, terminates the loop. Without
 * both guards a stuck cursor spins forever, which presents to the user as a
 * hung client rather than an error.
 *
 * **Responses are cached in memory.** An agent answering "how is my show doing"
 * will ask three questions over the same window, and without a cache each one
 * pays the full scan again.
 */

import type { Config } from "../config.js";
import { errorFor, NetworkError, OP3Error, TimeoutError } from "./errors.js";
import type {
  DownloadRow,
  DownloadsResponse,
  EpisodeDownloadCountsResponse,
  HitRow,
  HitsResponse,
  RecentTranscriptsResponse,
  ShowDownloadCountsResponse,
  ShowInfoResponse,
  TopAppsForShowResponse,
  TopAppsResponse,
} from "./types.js";

export const VERSION = "1.0.0";

type QueryParams = Record<string, string | number | boolean | string[] | undefined>;

type CacheEntry = { at: number; value: unknown };

/** What a paged pull actually managed to fetch, and why it stopped. */
export type PagedResult<T> = {
  rows: T[];
  /** True when a cap stopped the pull before the window was exhausted. */
  truncated: boolean;
  /** Which cap stopped it, when one did. */
  stoppedBy?: "maxRows" | "maxPages";
  pages: number;
};

export class OP3Client {
  private readonly config: Config;
  private readonly cache = new Map<string, CacheEntry>();
  private nextSlot = 0;

  constructor(config: Config) {
    this.config = config;
  }

  /**
   * Space requests apart.
   *
   * A shared "next allowed slot" rather than a sleep after each call, so
   * concurrent callers queue behind each other instead of all firing at once
   * after the same delay.
   */
  private async throttle(): Promise<void> {
    const gap = this.config.minRequestIntervalMs;
    if (gap <= 0) return;
    const now = Date.now();
    const slot = Math.max(now, this.nextSlot);
    this.nextSlot = slot + gap;
    if (slot > now) await new Promise((r) => setTimeout(r, slot - now));
  }

  private buildUrl(path: string, params: QueryParams): URL {
    const url = new URL(`${this.config.baseUrl}${path}`);
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === "") continue;
      if (Array.isArray(value)) {
        // Repeated key, not a comma-joined list. OP3's multi-show query rejects
        // `showUuid=a,b` with a 400 and accepts `showUuid=a&showUuid=b`.
        for (const item of value) {
          if (item !== undefined && item !== "") url.searchParams.append(key, String(item));
        }
        continue;
      }
      url.searchParams.set(key, String(value));
    }
    return url;
  }

  /**
   * One request, with a deadline and bounded retries.
   *
   * The token goes in the Authorization header only. OP3 also accepts it as a
   * `?token=` query parameter, but a token in a URL ends up in logs and in
   * error messages, and this client puts URLs in error messages.
   */
  async request<T>(path: string, params: QueryParams = {}): Promise<T> {
    const url = this.buildUrl(path, params);
    const cacheKey = url.toString();

    if (this.config.cacheTtlMs > 0) {
      const hit = this.cache.get(cacheKey);
      if (hit && Date.now() - hit.at < this.config.cacheTtlMs) return hit.value as T;
    }

    let lastError: OP3Error | undefined;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      await this.throttle();

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);

      try {
        const response = await fetch(url, {
          headers: {
            accept: "application/json",
            authorization: `Bearer ${this.config.token}`,
            "user-agent": `${this.config.userAgent}/${VERSION}`,
          },
          signal: controller.signal,
        });

        if (!response.ok) {
          const body = await response.text().catch(() => "");
          const error = errorFor(response.status, path, body, this.config.usingPreviewToken);
          // 4xx other than 429 will not change on a retry, so fail fast.
          if (response.status < 500 && response.status !== 429) throw error;
          lastError = error;
        } else {
          const value = (await response.json()) as T;
          if (this.config.cacheTtlMs > 0) this.cache.set(cacheKey, { at: Date.now(), value });
          return value;
        }
      } catch (err) {
        if (err instanceof OP3Error) {
          if (err.status < 500 && err.status !== 429) throw err;
          lastError = err;
        } else if ((err as Error)?.name === "AbortError") {
          lastError = new TimeoutError(
            `OP3 did not respond to ${path} within ${this.config.requestTimeoutMs}ms. The raw download and hit endpoints are scans, so a wide window can exceed any deadline. Narrow the window, or raise OP3_REQUEST_TIMEOUT_MS.`,
            408,
            path,
          );
        } else {
          lastError = new NetworkError(
            `Could not reach OP3 at ${this.config.baseUrl}: ${(err as Error)?.message ?? String(err)}`,
            0,
            path,
          );
        }
      } finally {
        clearTimeout(timer);
      }

      if (attempt < this.config.maxRetries) {
        // Exponential backoff with jitter. Jitter matters because the paging
        // loop retries in lockstep otherwise, and re-collides every time.
        const backoff = 400 * 2 ** attempt + Math.random() * 250;
        await new Promise((r) => setTimeout(r, backoff));
      }
    }

    throw lastError ?? new OP3Error(`OP3 request to ${path} failed.`, 0, path);
  }

  // --- Shows -------------------------------------------------------------

  /** GET /shows/{showUuidOrPodcastGuidOrFeedUrlBase64} */
  async getShow(identifier: string, includeEpisodes = false): Promise<ShowInfoResponse> {
    return this.request<ShowInfoResponse>(`/shows/${encodeURIComponent(identifier)}`, {
      episodes: includeEpisodes ? "include" : undefined,
    });
  }

  // --- Rolled-up queries, fast -------------------------------------------

  /** GET /queries/show-download-counts. Accepts several uuids in one call. */
  async getShowDownloadCounts(showUuids: string[]): Promise<ShowDownloadCountsResponse> {
    return this.request<ShowDownloadCountsResponse>("/queries/show-download-counts", {
      showUuid: showUuids,
    });
  }

  /** GET /queries/episode-download-counts */
  async getEpisodeDownloadCounts(showUuid: string): Promise<EpisodeDownloadCountsResponse> {
    return this.request<EpisodeDownloadCountsResponse>("/queries/episode-download-counts", {
      showUuid,
    });
  }

  /** GET /queries/top-apps-for-show. Last three calendar months, fixed by OP3. */
  async getTopAppsForShow(showUuid: string): Promise<TopAppsForShowResponse> {
    return this.request<TopAppsForShowResponse>("/queries/top-apps-for-show", { showUuid });
  }

  /** GET /queries/top-apps. Global share over the last thirty days. */
  async getTopApps(params: { deviceName?: string; userAgent?: string } = {}): Promise<TopAppsResponse> {
    return this.request<TopAppsResponse>("/queries/top-apps", params);
  }

  /** GET /queries/recent-episodes-with-transcripts */
  async getRecentTranscripts(limit: number): Promise<RecentTranscriptsResponse> {
    return this.request<RecentTranscriptsResponse>(
      "/queries/recent-episodes-with-transcripts",
      { limit },
    );
  }

  // --- The firehose ------------------------------------------------------

  /** GET /downloads/show/{showUuid}, one page. */
  async getDownloadsPage(
    showUuid: string,
    params: {
      start?: string;
      startAfter?: string;
      end?: string;
      episodeId?: string;
      limit?: number;
      bots?: boolean;
      continuationToken?: string;
    } = {},
  ): Promise<DownloadsResponse> {
    return this.request<DownloadsResponse>(`/downloads/show/${encodeURIComponent(showUuid)}`, {
      format: "json",
      limit: params.limit,
      start: params.start,
      startAfter: params.startAfter,
      end: params.end,
      episodeId: params.episodeId,
      // "include" is the only value OP3 accepts here, matching `episodes=include`
      // on the shows route. `bots=true` is rejected outright with "Bad bots".
      //
      // It does more than add bot rows. Without it OP3 applies its published
      // download calculation, which deduplicates repeat requests; with it you
      // get raw request rows. On a probe that was 213 against 345 for the same
      // window, and only 79 of the difference were bots.
      bots: params.bots ? "include" : undefined,
      continuationToken: params.continuationToken,
    });
  }

  // Note: `/downloads` has no `desc` parameter. OP3 documents one on `/hits`
  // only, and silently ignores it here, so this endpoint always returns a
  // window in ascending time order. Anything wanting recent rows narrows the
  // window rather than reversing the sort.

  /**
   * Every download row in a window, paged, with caps.
   *
   * Returns what it managed to get plus whether a cap cut it short. A partial
   * answer labelled partial is useful. A partial answer labelled complete is
   * worse than no answer, because every rate and percentage computed from it
   * is quietly wrong.
   */
  async getAllDownloads(
    showUuid: string,
    params: {
      start?: string;
      end?: string;
      episodeId?: string;
      bots?: boolean;
      pageSize?: number;
      maxRows?: number;
    } = {},
  ): Promise<PagedResult<DownloadRow>> {
    const maxRows = Math.min(params.maxRows ?? this.config.maxRows, this.config.maxRows);
    const pageSize = params.pageSize ?? 5000;
    const rows: DownloadRow[] = [];
    let continuationToken: string | undefined;
    let pages = 0;

    while (pages < this.config.maxPages) {
      const page: DownloadsResponse = await this.getDownloadsPage(showUuid, {
        start: params.start,
        end: params.end,
        episodeId: params.episodeId,
        bots: params.bots,
        limit: Math.min(pageSize, maxRows - rows.length),
        continuationToken,
      });
      pages++;

      const batch = page.rows ?? [];
      rows.push(...batch);

      if (rows.length >= maxRows) {
        return { rows: rows.slice(0, maxRows), truncated: true, stoppedBy: "maxRows", pages };
      }

      const next = page.continuationToken;
      // No token, no rows, or a token identical to the one just sent all mean
      // there is nothing further. The last case is the one that would otherwise
      // loop forever.
      if (!next || batch.length === 0 || next === continuationToken) {
        return { rows, truncated: false, pages };
      }
      continuationToken = next;
    }

    return { rows, truncated: true, stoppedBy: "maxPages", pages };
  }

  /** GET /hits, one page. Global across OP3 unless filtered by url. */
  async getHitsPage(
    params: {
      start?: string;
      startAfter?: string;
      end?: string;
      url?: string;
      hashedIpAddress?: string;
      limit?: number;
      desc?: boolean;
    } = {},
  ): Promise<HitsResponse> {
    return this.request<HitsResponse>("/hits", {
      format: "json",
      limit: params.limit,
      start: params.start,
      startAfter: params.startAfter,
      end: params.end,
      url: params.url,
      hashedIpAddress: params.hashedIpAddress,
      desc: params.desc ? "true" : undefined,
    });
  }

  /** Rows currently cached. Reported by `doctor`, never by a tool. */
  cacheSize(): number {
    return this.cache.size;
  }
}

export type { DownloadRow, HitRow };
