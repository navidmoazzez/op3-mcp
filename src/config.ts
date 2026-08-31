/**
 * Settings, read once from the environment.
 *
 * OP3 has one credential and one account, so there is none of the
 * multi-account machinery the write-capable servers need. What does need care
 * is the cost ceiling: the raw download endpoint is a scan, not an index, and
 * an unbounded query will hang a client rather than fail it. The caps below are
 * the guard, and they are settings rather than constants because someone
 * running this against a large show will legitimately want to raise them.
 */

/** OP3 documents this sample token in its API info block for previewing access. */
export const PREVIEW_TOKEN = "preview07ce";

export const DEFAULT_BASE_URL = "https://op3.dev/api/1";

export type Config = {
  token: string;
  /** True when the token is OP3's shared preview token rather than the user's own. */
  usingPreviewToken: boolean;
  baseUrl: string;
  requestTimeoutMs: number;
  /** Spacing between requests. The firehose is expensive; do not hammer it. */
  minRequestIntervalMs: number;
  maxRetries: number;
  /** Hard ceiling on rows any single analysis tool will pull from the firehose. */
  maxRows: number;
  /** Ceiling on continuation pages, so a stuck cursor cannot loop forever. */
  maxPages: number;
  /** How long a response stays cached, in ms. Zero disables the cache. */
  cacheTtlMs: number;
  userAgent: string;
};

function envInt(name: string, fallback: number, min = 1): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min) {
    process.stderr.write(
      `[op3-mcp] ${name}="${raw}" is not a number >= ${min}. Using ${fallback}.\n`,
    );
    return fallback;
  }
  return n;
}

function normalizeBaseUrl(raw: string | undefined): string {
  const t = (raw ?? "").trim();
  if (!t) return DEFAULT_BASE_URL;
  const withScheme = /^https?:\/\//i.test(t) ? t : `https://${t}`;
  return withScheme.replace(/\/+$/, "");
}

export function loadConfig(): Config {
  // OP3_TOKEN is the documented name. OP3_API_KEY is accepted because the OP3
  // site calls the page "API Keys", and a user who reads that page reaches for
  // the word they just saw.
  const token = (process.env.OP3_TOKEN || process.env.OP3_API_KEY || "").trim() || PREVIEW_TOKEN;

  return {
    token,
    usingPreviewToken: token === PREVIEW_TOKEN,
    baseUrl: normalizeBaseUrl(process.env.OP3_BASE_URL),
    requestTimeoutMs: envInt("OP3_REQUEST_TIMEOUT_MS", 45_000, 1000),
    minRequestIntervalMs: envInt("OP3_MIN_REQUEST_INTERVAL_MS", 150, 0),
    maxRetries: envInt("OP3_MAX_RETRIES", 3, 0),
    maxRows: envInt("OP3_MAX_ROWS", 50_000, 100),
    maxPages: envInt("OP3_MAX_PAGES", 40, 1),
    cacheTtlMs: envInt("OP3_CACHE_TTL_MS", 300_000, 0),
    userAgent: process.env.OP3_USER_AGENT || "op3-mcp",
  };
}
