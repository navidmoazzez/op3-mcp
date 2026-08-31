/**
 * Turning whatever the user has into something OP3 accepts.
 *
 * The show lookup route takes three different kinds of identifier in one path
 * segment: an OP3 show uuid, a `podcast:guid`, or the feed URL encoded as
 * urlsafe base64. That last one is the trap. A user has a feed URL in hand and
 * OP3 wants it base64url-encoded, and nothing in the error message when they
 * paste the raw URL says so.
 *
 * So this module accepts all four forms, including the raw feed URL, and
 * encodes on the caller's behalf.
 */

/** OP3 show uuid: 32 hex characters, no dashes. */
const SHOW_UUID = /^[0-9a-f]{32}$/i;

/** A `podcast:guid` is a standard UUID, dashed. */
const PODCAST_GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** OP3 episode id: a 64-character hash. */
const EPISODE_ID = /^[0-9a-f]{64}$/i;

export type IdentifierKind = "showUuid" | "podcastGuid" | "feedUrl" | "base64FeedUrl";

export type ResolvedIdentifier = {
  /** What to put in the OP3 path. */
  value: string;
  kind: IdentifierKind;
  /** The original input, for reporting back what was understood. */
  input: string;
};

/** Encode a feed URL the way OP3's route expects: base64, urlsafe, unpadded. */
export function toBase64FeedUrl(feedUrl: string): string {
  return Buffer.from(feedUrl.trim(), "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Reverse of `toBase64FeedUrl`, for explaining back what an identifier was. */
export function fromBase64FeedUrl(encoded: string): string | undefined {
  try {
    const padded = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const text = Buffer.from(padded, "base64").toString("utf8");
    return /^https?:\/\//i.test(text) ? text : undefined;
  } catch {
    return undefined;
  }
}

export function isShowUuid(value: string): boolean {
  return SHOW_UUID.test(value.trim());
}

export function isEpisodeId(value: string): boolean {
  return EPISODE_ID.test(value.trim());
}

/**
 * Work out what kind of identifier this is, and produce the path segment.
 *
 * Order matters. A dashed UUID is checked before the URL test because a
 * `podcast:guid` is never a URL, and the base64 test comes last because it is
 * the loosest: plenty of strings decode to something, so it only claims a value
 * that decodes to an actual http URL.
 */
export function resolveIdentifier(raw: string): ResolvedIdentifier {
  const input = raw.trim();

  if (!input) {
    throw new Error(
      "No show identifier given. Pass an OP3 show uuid (32 hex characters), a podcast:guid, or the podcast's RSS feed URL.",
    );
  }

  // A uuid stripped of dashes is also 32 hex, so normalise dashed input that is
  // not a valid podcast guid shape before testing.
  if (SHOW_UUID.test(input)) return { value: input.toLowerCase(), kind: "showUuid", input };
  if (PODCAST_GUID.test(input)) return { value: input.toLowerCase(), kind: "podcastGuid", input };

  if (/^https?:\/\//i.test(input)) {
    return { value: toBase64FeedUrl(input), kind: "feedUrl", input };
  }

  const decoded = fromBase64FeedUrl(input);
  if (decoded) return { value: input, kind: "base64FeedUrl", input };

  throw new Error(
    `"${input}" is not a show identifier OP3 recognises. Use an OP3 show uuid (32 hex characters), a podcast:guid (a dashed UUID from the feed's <podcast:guid> tag), or the RSS feed URL itself.`,
  );
}

/** A human-readable name for a kind, for saying what was understood. */
export function describeKind(kind: IdentifierKind): string {
  switch (kind) {
    case "showUuid":
      return "OP3 show uuid";
    case "podcastGuid":
      return "podcast:guid";
    case "feedUrl":
      return "RSS feed URL, base64-encoded for OP3";
    case "base64FeedUrl":
      return "base64-encoded feed URL";
  }
}
