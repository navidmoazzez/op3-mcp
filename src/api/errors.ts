/**
 * Typed errors, one per way an OP3 call can fail.
 *
 * A model handed the bare string "request failed" gives up. A model told the
 * token was rejected goes and checks the token. So every failure here keeps the
 * status and the endpoint, and carries a message naming the actual fix rather
 * than restating the status code in English.
 *
 * OP3 has no machine-readable error envelope, so the mapping is driven by the
 * status plus whatever text came back, capped so an HTML error page from a
 * proxy cannot become the whole message.
 */

export class OP3Error extends Error {
  readonly status: number;
  readonly endpoint: string;
  readonly detail: string;

  constructor(message: string, status: number, endpoint: string, detail = "") {
    super(message);
    this.name = new.target.name;
    this.status = status;
    this.endpoint = endpoint;
    this.detail = detail;
  }

  toJSON(): Record<string, unknown> {
    return {
      error: this.message,
      type: this.name,
      ...(this.status ? { status: this.status } : {}),
      endpoint: this.endpoint,
      ...(this.detail ? { detail: this.detail } : {}),
    };
  }
}

/** 401 or 403. The bearer token is missing, wrong, or revoked. */
export class AuthenticationError extends OP3Error {}

/** 400. The arguments were rejected. */
export class ValidationError extends OP3Error {}

/** 404. No such show, episode or route. */
export class NotFoundError extends OP3Error {}

/** 429. Too many requests. */
export class RateLimitError extends OP3Error {}

/** 5xx. Upstream, usually transient. */
export class ServerError extends OP3Error {}

/** Nothing arrived before our own deadline, or the socket died. */
export class TimeoutError extends OP3Error {}

/** The network never reached OP3 at all. */
export class NetworkError extends OP3Error {}

/**
 * Pull something readable out of an error body.
 *
 * OP3 returns plain text or a small JSON object depending on the route, so try
 * JSON first and fall back to collapsed text.
 */
export function extractDetail(body: string): string {
  const text = body.trim();
  if (!text) return "";
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === "object") {
      const obj = parsed as Record<string, unknown>;
      for (const key of ["error", "message", "detail"]) {
        const v = obj[key];
        if (typeof v === "string" && v.trim()) return v.trim().slice(0, 500);
      }
    }
    if (typeof parsed === "string") return parsed.slice(0, 500);
  } catch {
    // Not JSON. Fall through to raw text.
  }
  return text.replace(/\s+/g, " ").slice(0, 500);
}

/** Map an HTTP status onto the right class, with a message that names the fix. */
export function errorFor(
  status: number,
  endpoint: string,
  body: string,
  usingPreviewToken = false,
): OP3Error {
  const detail = extractDetail(body);

  if (status === 401 || status === 403) {
    return new AuthenticationError(
      usingPreviewToken
        ? `OP3 rejected the shared preview token on ${endpoint}. It is rate limited and can be withdrawn at any time. Create your own at https://op3.dev/api/keys and set OP3_TOKEN.`
        : `OP3 rejected the bearer token on ${endpoint}. Check that OP3_TOKEN matches a live key at https://op3.dev/api/keys.`,
      status,
      endpoint,
      detail,
    );
  }
  if (status === 404) {
    return new NotFoundError(
      `OP3 has nothing at ${endpoint}. If this was a show lookup, the show may not have the OP3 prefix on its feed yet, in which case OP3 has never seen a download for it. A show that was never prefixed and a show with no downloads look identical here.`,
      status,
      endpoint,
      detail,
    );
  }
  if (status === 429) {
    return new RateLimitError(
      `OP3 rate limited ${endpoint}. The client already spaces and retries requests, so this failed after the last attempt. Raise OP3_MIN_REQUEST_INTERVAL_MS, or narrow the time window so fewer pages are needed.`,
      status,
      endpoint,
      detail,
    );
  }
  if (status === 400) {
    return new ValidationError(
      `OP3 rejected the arguments sent to ${endpoint}. Times accept an ISO timestamp, a date, or a relative value like -30d. A show uuid is 32 hex characters.`,
      status,
      endpoint,
      detail,
    );
  }
  if (status >= 500) {
    return new ServerError(
      `OP3 returned ${status} for ${endpoint}. This is upstream and usually transient. The firehose endpoints are scans and can time out on a wide window; narrowing the window is the usual fix.`,
      status,
      endpoint,
      detail,
    );
  }
  return new OP3Error(`OP3 returned ${status} for ${endpoint}.`, status, endpoint, detail);
}
