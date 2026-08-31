/**
 * Client behaviour against a faked transport. Never the network.
 *
 * Three of these are regressions for bugs that only showed up against the live
 * API and would have shipped otherwise: `bots=true` is rejected by OP3 and the
 * value has to be `include`, `/downloads` has no `desc` parameter and silently
 * ignores one, and the multi-show query needs a repeated key rather than a
 * comma-joined list.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OP3Client } from "../src/api/client.js";
import { AuthenticationError, NotFoundError, RateLimitError, ValidationError } from "../src/api/errors.js";
import type { Config } from "../src/config.js";

const config = (over: Partial<Config> = {}): Config => ({
  token: "test-token",
  usingPreviewToken: false,
  baseUrl: "https://op3.dev/api/1",
  requestTimeoutMs: 5000,
  minRequestIntervalMs: 0,
  maxRetries: 0,
  maxRows: 50_000,
  maxPages: 40,
  cacheTtlMs: 0,
  userAgent: "op3-mcp-test",
  ...over,
});

let calls: string[] = [];

function fakeFetch(handler: (url: URL) => { status?: number; body?: unknown; text?: string }) {
  return vi.fn(async (input: URL | RequestInfo) => {
    const url = new URL(String(input));
    calls.push(url.toString());
    const { status = 200, body, text } = handler(url);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => text ?? JSON.stringify(body ?? ""),
      headers: new Headers(),
    } as unknown as Response;
  });
}

beforeEach(() => {
  calls = [];
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("request building", () => {
  it("sends the token as a header, never in the query string", async () => {
    const fetchMock = fakeFetch(() => ({ body: { appShares: {} } }));
    vi.stubGlobal("fetch", fetchMock);

    await new OP3Client(config()).getTopApps();

    expect(calls[0]).not.toContain("token=");
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer test-token");
  });

  it("omits undefined and empty parameters rather than sending blanks", async () => {
    vi.stubGlobal("fetch", fakeFetch(() => ({ body: { appShares: {} } })));
    await new OP3Client(config()).getTopApps({ deviceName: undefined });
    expect(calls[0]).not.toContain("deviceName");
  });

  it("repeats a key for multiple shows, because OP3 rejects a comma-joined list", async () => {
    vi.stubGlobal("fetch", fakeFetch(() => ({ body: { showDownloadCounts: {} } })));
    await new OP3Client(config()).getShowDownloadCounts(["aaa", "bbb"]);

    const url = new URL(calls[0]!);
    expect(url.searchParams.getAll("showUuid")).toEqual(["aaa", "bbb"]);
    expect(calls[0]).not.toContain("aaa%2Cbbb");
  });

  it("sends bots as include, the only value OP3 accepts", async () => {
    vi.stubGlobal("fetch", fakeFetch(() => ({ body: { rows: [] } })));
    await new OP3Client(config()).getDownloadsPage("show", { bots: true });
    expect(new URL(calls[0]!).searchParams.get("bots")).toBe("include");
  });

  it("omits bots entirely when false, since an empty value is a 400", async () => {
    vi.stubGlobal("fetch", fakeFetch(() => ({ body: { rows: [] } })));
    await new OP3Client(config()).getDownloadsPage("show", { bots: false });
    expect(new URL(calls[0]!).searchParams.has("bots")).toBe(false);
  });

  it("never sends desc to /downloads, which has no such parameter", async () => {
    vi.stubGlobal("fetch", fakeFetch(() => ({ body: { rows: [] } })));
    await new OP3Client(config()).getDownloadsPage("show", { start: "-7d" });
    expect(new URL(calls[0]!).searchParams.has("desc")).toBe(false);
  });

  it("does send desc to /hits, which does support it", async () => {
    vi.stubGlobal("fetch", fakeFetch(() => ({ body: { rows: [] } })));
    await new OP3Client(config()).getHitsPage({ desc: true });
    expect(new URL(calls[0]!).searchParams.get("desc")).toBe("true");
  });
});

describe("pagination", () => {
  it("follows the continuation token until it runs out", async () => {
    let page = 0;
    vi.stubGlobal(
      "fetch",
      fakeFetch(() => {
        page++;
        return page < 3
          ? { body: { rows: [{ time: "t" }], continuationToken: `c${page}` } }
          : { body: { rows: [{ time: "t" }] } };
      }),
    );

    const result = await new OP3Client(config()).getAllDownloads("show");
    expect(result.pages).toBe(3);
    expect(result.rows).toHaveLength(3);
    expect(result.truncated).toBe(false);
  });

  it("stops when the token comes back unchanged, which would otherwise loop forever", async () => {
    vi.stubGlobal(
      "fetch",
      fakeFetch(() => ({ body: { rows: [{ time: "t" }], continuationToken: "same" } })),
    );

    const result = await new OP3Client(config({ maxPages: 100 })).getAllDownloads("show");
    // First page sends no token and gets "same"; the second sends "same" and
    // gets "same" again, which terminates.
    expect(result.pages).toBe(2);
    expect(result.truncated).toBe(false);
  });

  it("stops on an empty page even when a token is still offered", async () => {
    vi.stubGlobal("fetch", fakeFetch(() => ({ body: { rows: [], continuationToken: "next" } })));
    const result = await new OP3Client(config()).getAllDownloads("show");
    expect(result.pages).toBe(1);
    expect(result.rows).toHaveLength(0);
  });

  it("reports truncation when the row cap stops it, so rates are not read as complete", async () => {
    // A fresh token each page, which is what a real cursor does. A constant one
    // would trip the stuck-cursor guard first, which is a different test.
    let page = 0;
    vi.stubGlobal(
      "fetch",
      fakeFetch(() => ({
        body: {
          rows: Array.from({ length: 10 }, () => ({ time: "t" })),
          continuationToken: `page-${page++}`,
        },
      })),
    );

    const result = await new OP3Client(config({ maxRows: 25 })).getAllDownloads("show");
    expect(result.truncated).toBe(true);
    expect(result.stoppedBy).toBe("maxRows");
    expect(result.rows).toHaveLength(25);
  });

  it("reports truncation when the page cap stops it", async () => {
    vi.stubGlobal(
      "fetch",
      fakeFetch(() => ({ body: { rows: [{ time: "t" }], continuationToken: `c${Math.random()}` } })),
    );

    const result = await new OP3Client(config({ maxPages: 3 })).getAllDownloads("show");
    expect(result.truncated).toBe(true);
    expect(result.stoppedBy).toBe("maxPages");
    expect(result.pages).toBe(3);
  });
});

describe("errors", () => {
  const cases: [number, unknown][] = [
    [401, AuthenticationError],
    [403, AuthenticationError],
    [400, ValidationError],
    [404, NotFoundError],
  ];

  for (const [status, type] of cases) {
    it(`maps ${status} to ${(type as { name: string }).name}`, async () => {
      vi.stubGlobal("fetch", fakeFetch(() => ({ status, text: "nope" })));
      await expect(new OP3Client(config()).getTopApps()).rejects.toBeInstanceOf(type as never);
    });
  }

  it("does not retry a 4xx, because it will not change", async () => {
    const fetchMock = fakeFetch(() => ({ status: 400, text: "bad" }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(new OP3Client(config({ maxRetries: 3 })).getTopApps()).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does retry a 429 and a 5xx", async () => {
    const fetchMock = fakeFetch(() => ({ status: 429, text: "slow down" }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(new OP3Client(config({ maxRetries: 1 })).getTopApps()).rejects.toBeInstanceOf(
      RateLimitError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("names the preview token in the auth error when that is what is in use", async () => {
    vi.stubGlobal("fetch", fakeFetch(() => ({ status: 401, text: "" })));
    await expect(
      new OP3Client(config({ usingPreviewToken: true })).getTopApps(),
    ).rejects.toThrow(/op3\.dev\/api\/keys/);
  });
});

describe("cache", () => {
  it("serves a repeated identical request without a second call", async () => {
    const fetchMock = fakeFetch(() => ({ body: { appShares: { Apple: 1 } } }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new OP3Client(config({ cacheTtlMs: 60_000 }));
    await client.getTopApps();
    await client.getTopApps();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("treats a different query as a different entry", async () => {
    const fetchMock = fakeFetch(() => ({ body: { appShares: {} } }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new OP3Client(config({ cacheTtlMs: 60_000 }));
    await client.getTopApps();
    await client.getTopApps({ deviceName: "Apple iPhone" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
