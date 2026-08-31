/**
 * What a reader is trusting when they install this: that it builds, that every
 * tool is actually registered with a description and a schema, and that the
 * annotations tell a client the truth about what it does.
 */

import { describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";
import { loadConfig, PREVIEW_TOKEN } from "../src/config.js";
import { TOOL_COUNT } from "../src/tools/index.js";
import { fail, ok, stripEmpty, truncationNote } from "../src/tools/kit.js";
import { OP3Error } from "../src/api/errors.js";

describe("server", () => {
  it("builds and reports its tool count", () => {
    const built = buildServer(loadConfig());
    expect(built.toolCount).toBe(TOOL_COUNT);
  });

  it("carries instructions that set the download and listener distinction", () => {
    // This is the one misreading that would make every answer wrong, so it has
    // to be in context before the first tool result rather than corrected after.
    const built = buildServer(loadConfig());
    const instructions = (built.server.server as unknown as { _instructions?: string })._instructions;
    expect(instructions).toBeTruthy();
    expect(instructions).toMatch(/not a person/i);
    expect(instructions).toMatch(/third-party RSS feeds/i);
  });
});

describe("config", () => {
  it("falls back to OP3's preview token so the server works unconfigured", () => {
    const previous = process.env.OP3_TOKEN;
    delete process.env.OP3_TOKEN;
    delete process.env.OP3_API_KEY;
    try {
      const config = loadConfig();
      expect(config.token).toBe(PREVIEW_TOKEN);
      expect(config.usingPreviewToken).toBe(true);
    } finally {
      if (previous !== undefined) process.env.OP3_TOKEN = previous;
    }
  });

  it("prefers a real token and stops flagging the preview", () => {
    const previous = process.env.OP3_TOKEN;
    process.env.OP3_TOKEN = "real-token";
    try {
      const config = loadConfig();
      expect(config.token).toBe("real-token");
      expect(config.usingPreviewToken).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.OP3_TOKEN;
      else process.env.OP3_TOKEN = previous;
    }
  });

  it("ignores a non-numeric setting rather than producing NaN", () => {
    const previous = process.env.OP3_MAX_ROWS;
    process.env.OP3_MAX_ROWS = "lots";
    try {
      expect(loadConfig().maxRows).toBe(50_000);
    } finally {
      if (previous === undefined) delete process.env.OP3_MAX_ROWS;
      else process.env.OP3_MAX_ROWS = previous;
    }
  });
});

describe("output shaping", () => {
  it("drops null and undefined so a model is not handed empty fields", () => {
    expect(stripEmpty({ a: 1, b: null, c: undefined, d: { e: null, f: 2 } })).toEqual({
      a: 1,
      d: { f: 2 },
    });
  });

  it("keeps falsy values that carry meaning", () => {
    expect(stripEmpty({ downloads: 0, truncated: false, title: "" })).toEqual({
      downloads: 0,
      truncated: false,
      title: "",
    });
  });

  it("returns an error as a readable result rather than a transport failure", () => {
    const result = fail(new OP3Error("boom", 500, "/x", "detail"));
    expect(result.isError).toBe(true);
    const payload = JSON.parse((result.content[0] as { text: string }).text);
    expect(payload.error).toBe("boom");
    expect(payload.endpoint).toBe("/x");
  });

  it("handles a plain Error too", () => {
    const payload = JSON.parse((fail(new Error("plain")).content[0] as { text: string }).text);
    expect(payload.error).toBe("plain");
  });

  it("serialises a normal result as JSON text", () => {
    const payload = JSON.parse((ok({ a: 1 }).content[0] as { text: string }).text);
    expect(payload).toEqual({ a: 1 });
  });
});

describe("truncation notes", () => {
  it("says nothing when the pull was complete", () => {
    expect(truncationNote(false, undefined, 10)).toBeUndefined();
  });

  it("names the cap that stopped it and how to raise it", () => {
    expect(truncationNote(true, "maxRows", 100)).toMatch(/OP3_MAX_ROWS/);
    expect(truncationNote(true, "maxPages", 100)).toMatch(/OP3_MAX_PAGES/);
  });

  it("says the figures describe a sample, which is the part that matters", () => {
    expect(truncationNote(true, "maxRows", 100)).toMatch(/sample/i);
  });
});
