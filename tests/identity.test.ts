import { describe, expect, it } from "vitest";
import {
  describeKind,
  fromBase64FeedUrl,
  isEpisodeId,
  isShowUuid,
  resolveIdentifier,
  toBase64FeedUrl,
} from "../src/api/identity.js";

describe("identifier resolution", () => {
  it("recognises an OP3 show uuid and lowercases it", () => {
    const r = resolveIdentifier("0B0BFD8EE26D4C75AA05985E04CDB27E");
    expect(r.kind).toBe("showUuid");
    expect(r.value).toBe("0b0bfd8ee26d4c75aa05985e04cdb27e");
  });

  it("recognises a dashed podcast:guid", () => {
    const r = resolveIdentifier("019e5155-b62b-7f95-9675-d871020ed69d");
    expect(r.kind).toBe("podcastGuid");
  });

  it("encodes a raw feed URL, which is the trap OP3's route sets", () => {
    const r = resolveIdentifier("https://example.com/feed.xml");
    expect(r.kind).toBe("feedUrl");
    expect(fromBase64FeedUrl(r.value)).toBe("https://example.com/feed.xml");
  });

  it("passes an already-encoded feed URL through untouched", () => {
    const encoded = toBase64FeedUrl("https://example.com/feed.xml");
    const r = resolveIdentifier(encoded);
    expect(r.kind).toBe("base64FeedUrl");
    expect(r.value).toBe(encoded);
  });

  it("produces urlsafe unpadded base64", () => {
    // A URL long enough to force padding and to hit the + and / alphabet.
    const encoded = toBase64FeedUrl("https://example.com/feed?a=1&b=2>>>???");
    expect(encoded).not.toMatch(/[+/=]/);
  });

  it("rejects something that is not an identifier at all, with a usable message", () => {
    expect(() => resolveIdentifier("my podcast")).toThrow(/show uuid/i);
  });

  it("rejects an empty identifier", () => {
    expect(() => resolveIdentifier("   ")).toThrow(/No show identifier/i);
  });

  it("does not mistake an episode id for a show uuid", () => {
    const episodeId = "e16a97c342069aba18dc6a4092acc471936e82e517b895ee221d7fd64f859992";
    expect(isEpisodeId(episodeId)).toBe(true);
    expect(isShowUuid(episodeId)).toBe(false);
  });

  it("names every kind it can return", () => {
    for (const kind of ["showUuid", "podcastGuid", "feedUrl", "base64FeedUrl"] as const) {
      expect(describeKind(kind)).toBeTruthy();
    }
  });
});
