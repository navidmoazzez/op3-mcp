/**
 * What every tool needs: the client, the settings, and two lookups that would
 * otherwise be repeated in a dozen handlers.
 *
 * Both lookups are cached for the life of the process. Resolving a feed URL to
 * a show uuid costs a request, and every firehose tool needs it before it can
 * do anything, so an agent asking five questions about one show would otherwise
 * pay that five times. Episode titles are the same story, and the raw download
 * row carries only an episode id, so without the title map every episode-level
 * answer comes back as a wall of 64-character hashes.
 */

import type { OP3Client } from "../api/client.js";
import { resolveIdentifier } from "../api/identity.js";
import type { Config } from "../config.js";
import { safeTitle } from "../format/frame.js";
import type { EpisodeSummary } from "../api/types.js";

export type ShowRef = {
  showUuid: string;
  title?: string;
  podcastGuid?: string;
  statsPageUrl?: string;
  episodes?: EpisodeSummary[];
};

export class ToolContext {
  readonly client: OP3Client;
  readonly config: Config;
  private readonly showCache = new Map<string, ShowRef>();
  private readonly episodeCache = new Map<string, EpisodeSummary[]>();

  constructor(client: OP3Client, config: Config) {
    this.client = client;
    this.config = config;
  }

  /**
   * Any identifier to a show, resolving a feed URL or podcast guid if needed.
   *
   * A bare uuid still round-trips to OP3 when the title is wanted, because an
   * answer that names the show reads very differently from one that repeats a
   * hash back at the user.
   */
  async resolveShow(identifier: string, withEpisodes = false): Promise<ShowRef> {
    const resolved = resolveIdentifier(identifier);
    const cacheKey = `${resolved.value}:${withEpisodes ? "ep" : "no"}`;
    const cached = this.showCache.get(cacheKey);
    if (cached) return cached;

    const show = await this.client.getShow(resolved.value, withEpisodes);
    const ref: ShowRef = {
      showUuid: show.showUuid,
      title: safeTitle(show.title),
      podcastGuid: show.podcastGuid,
      statsPageUrl: show.statsPageUrl,
      episodes: show.episodes,
    };

    this.showCache.set(cacheKey, ref);
    if (withEpisodes && show.episodes) this.episodeCache.set(show.showUuid, show.episodes);
    return ref;
  }

  /** Just the uuid, for tools that do not need the show's name. */
  async resolveShowUuid(identifier: string): Promise<string> {
    const resolved = resolveIdentifier(identifier);
    if (resolved.kind === "showUuid") return resolved.value;
    return (await this.resolveShow(identifier)).showUuid;
  }

  /** Episode list for a show, cached. */
  async episodes(showUuid: string): Promise<EpisodeSummary[]> {
    const cached = this.episodeCache.get(showUuid);
    if (cached) return cached;
    const show = await this.client.getShow(showUuid, true);
    const list = show.episodes ?? [];
    this.episodeCache.set(showUuid, list);
    return list;
  }

  /**
   * Episode id to title.
   *
   * Titles come from the publisher's RSS feed, so they are third-party text and
   * pass through `safeTitle` on the way in rather than at each use site.
   */
  async episodeTitles(showUuid: string): Promise<Map<string, string | undefined>> {
    const list = await this.episodes(showUuid);
    const map = new Map<string, string | undefined>();
    for (const ep of list) map.set(ep.id, safeTitle(ep.title));
    return map;
  }
}
