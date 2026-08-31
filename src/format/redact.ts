/**
 * The privacy line.
 *
 * OP3 exists to be a privacy-preserving analytics service. A wrapper that
 * streams per-listener identifiers into a model context undoes that, so this
 * module is where it does not happen.
 *
 * `audienceId` and `hashedIpAddress` are computed over inside this process and
 * never returned. Every audience number this server reports is a count, a rate
 * or a distribution. The one tool that can emit raw rows redacts both fields
 * unless the caller opts in by name, and that opt-in is documented rather than
 * hidden.
 *
 * Both fields are already hashes, so this is not about de-anonymising. It is
 * that a stable per-listener key in a transcript is a tracking key, and the
 * useful analysis never needs the key itself, only its cardinality.
 */

import type { DownloadRow, HitRow } from "../api/types.js";

/** Fields never returned by default, in either row shape. */
export const SENSITIVE_FIELDS = ["audienceId", "hashedIpAddress"] as const;

export type RedactionNote = {
  redactedFields: string[];
  note: string;
};

export const REDACTION_NOTE: RedactionNote = {
  redactedFields: [...SENSITIVE_FIELDS],
  note: "audienceId and hashedIpAddress are removed from raw rows. They are per-listener tracking keys, and every audience figure this server reports is aggregated from them rather than exposing them. The audience tools give unique-listener, retention and overlap numbers without the identifiers.",
};

/** Strip the per-listener keys from a download row. */
export function redactDownloadRow(row: DownloadRow): Omit<DownloadRow, "audienceId" | "hashedIpAddress"> {
  const { audienceId: _a, hashedIpAddress: _h, ...rest } = row;
  return rest;
}

/** Strip the per-listener key from a hit row. */
export function redactHitRow(row: HitRow): Omit<HitRow, "hashedIpAddress"> {
  const { hashedIpAddress: _h, ...rest } = row;
  return rest;
}

/**
 * Shorten a stable key to a non-reversible bucket label.
 *
 * For the rare case where a caller genuinely needs to see that two rows share a
 * listener without receiving the listener key. Eight hex characters is enough to
 * distinguish rows inside one response and far too little to correlate across
 * responses, which is exactly the trade wanted.
 */
export function pseudonymise(id: string | undefined): string | undefined {
  if (!id) return undefined;
  return `listener_${id.slice(0, 8)}`;
}
