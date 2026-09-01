import { describe, expect, it } from "vitest";
import { distinctCount, distribution, intersectionSize, jaccard, percent } from "../src/analytics/rollup.js";
import { audienceSummary, episodeOverlap, newVsReturning, retention } from "../src/analytics/audience.js";
import { benchmarkApps, episodeCurve, listeningPatterns, series } from "../src/analytics/trend.js";
import type { DownloadRow } from "../src/api/types.js";

const row = (over: Partial<DownloadRow> = {}): DownloadRow => ({
  time: "2026-08-31T10:00:00.000Z",
  audienceId: "a1",
  episodeId: "e1",
  ...over,
});

describe("distribution", () => {
  it("shares are of rows that had a value, not of all rows", () => {
    const rows = [row({ countryCode: "US" }), row({ countryCode: "US" }), row({ countryCode: undefined })];
    const d = distribution(rows, (r) => r.countryCode);
    expect(d.counted).toBe(2);
    expect(d.missing).toBe(1);
    // 2 of 2 counted, not 2 of 3 rows.
    expect(d.buckets[0]!.share).toBe(100);
  });

  it("folds a long tail into otherCount rather than dropping it", () => {
    const rows = [
      ...Array.from({ length: 5 }, () => row({ agentName: "Apple" })),
      row({ agentName: "Spotify" }),
      row({ agentName: "Overcast" }),
    ];
    const d = distribution(rows, (r) => r.agentName, { top: 1 });
    expect(d.buckets).toHaveLength(1);
    expect(d.otherCount).toBe(2);
    expect(d.distinct).toBe(3);
  });

  it("returns zero shares rather than dividing by zero", () => {
    const d = distribution([], (r: DownloadRow) => r.countryCode);
    expect(d.counted).toBe(0);
    expect(d.buckets).toHaveLength(0);
  });
});

describe("set maths", () => {
  it("counts distinct values", () => {
    expect(distinctCount([row(), row(), row({ audienceId: "a2" })], (r) => r.audienceId)).toBe(2);
  });

  it("intersects regardless of which set is larger", () => {
    const a = new Set(["x", "y"]);
    const b = new Set(["y", "z", "w"]);
    expect(intersectionSize(a, b)).toBe(1);
    expect(intersectionSize(b, a)).toBe(1);
  });

  it("jaccard is shared over combined", () => {
    expect(jaccard(new Set(["a", "b"]), new Set(["b", "c"]))).toBe(33.33);
    expect(jaccard(new Set(), new Set())).toBe(0);
  });

  it("percent guards a zero denominator", () => {
    expect(percent(1, 0)).toBe(0);
  });
});

describe("audience", () => {
  it("separates downloads from people", () => {
    const rows = [row({ audienceId: "a1" }), row({ audienceId: "a1" }), row({ audienceId: "a2" })];
    const s = audienceSummary(rows);
    expect(s.downloads).toBe(3);
    expect(s.uniqueListeners).toBe(2);
    expect(s.downloadsPerListener).toBe(1.5);
  });

  it("counts rows that cannot be attributed to a listener", () => {
    expect(audienceSummary([row({ audienceId: undefined })]).unattributed).toBe(1);
  });

  it("calls a listener new only when absent from the baseline", () => {
    const current = [row({ audienceId: "a1" }), row({ audienceId: "a2" })];
    const baseline = [row({ audienceId: "a1" })];
    const split = newVsReturning(current, baseline);
    expect(split.newListeners).toBe(1);
    expect(split.returningListeners).toBe(1);
    expect(split.newShare).toBe(50);
  });

  it("reports retention and carry-over as different numbers", () => {
    // Cohort a1,a2. Later a1,a3,a4. Half the cohort returned; a third of the
    // later period is carried over. Reporting only one of these hides the other.
    const cohort = [row({ audienceId: "a1" }), row({ audienceId: "a2" })];
    const later = [row({ audienceId: "a1" }), row({ audienceId: "a3" }), row({ audienceId: "a4" })];
    const r = retention(cohort, later);
    expect(r.retentionRate).toBe(50);
    expect(r.carryOverShare).toBe(33.33);
    expect(r.churnedListeners).toBe(1);
  });

  it("reports the smaller side's share, which raw overlap hides", () => {
    // e1 has 10 listeners, e2 has 2 and both of them also heard e1.
    const rows: DownloadRow[] = [
      ...Array.from({ length: 10 }, (_, i) => row({ episodeId: "e1", audienceId: `a${i}` })),
      row({ episodeId: "e2", audienceId: "a0" }),
      row({ episodeId: "e2", audienceId: "a1" }),
    ];
    const { pairs } = episodeOverlap(rows, new Map());
    expect(pairs[0]!.sharedListeners).toBe(2);
    // Symmetric similarity looks tiny; the smaller side is total.
    expect(pairs[0]!.smallerSideShare).toBe(100);
    expect(pairs[0]!.similarity).toBeLessThan(30);
  });
});

describe("trend", () => {
  it("buckets into a series and compares halves rather than endpoints", () => {
    const rows = [
      row({ time: "2026-08-01T00:00:00.000Z", audienceId: "a1" }),
      row({ time: "2026-08-02T00:00:00.000Z", audienceId: "a2" }),
      row({ time: "2026-08-03T00:00:00.000Z", audienceId: "a3" }),
      row({ time: "2026-08-04T00:00:00.000Z", audienceId: "a4" }),
      row({ time: "2026-08-04T01:00:00.000Z", audienceId: "a5" }),
    ];
    const s = series(rows, "day");
    expect(s.points).toHaveLength(4);
    expect(s.totalDownloads).toBe(5);
    expect(s.peak!.period).toBe("2026-08-04");
  });

  it("reports zero growth rather than Infinity when the first half is empty", () => {
    expect(series([], "day").growthRate).toBe(0);
  });

  it("labels listening patterns as UTC request timing, not behavior", () => {
    const p = listeningPatterns([row({ time: "2026-08-31T10:00:00.000Z" })]);
    expect(p.busiestHourUtc).toBe(10);
    expect(p.byHourUtc).toHaveLength(24);
    expect(p.byWeekday).toHaveLength(7);
    expect(p.note).toMatch(/UTC/);
  });

  it("indexes app share against the global mix rather than ranking it", () => {
    // 40% Apple is under-indexed when Apple is 50% globally, which raw share hides.
    const rows = benchmarkApps(new Map([["Apple Podcasts", 40], ["Overcast", 20]]), {
      "Apple Podcasts": 50,
      Overcast: 4,
    });
    const apple = rows.find((r) => r.app === "Apple Podcasts")!;
    const overcast = rows.find((r) => r.app === "Overcast")!;
    expect(apple.index).toBe(80);
    expect(overcast.index).toBe(500);
    expect(rows[0]!.app).toBe("Overcast");
  });

  it("ignores apps below the floor, so one download is not a huge over-index", () => {
    expect(benchmarkApps(new Map([["Tiny", 0.1]]), { Tiny: 0.001 }, 0.5)).toHaveLength(0);
  });

  it("compares an episode at equal age against the median", () => {
    const pub = "2026-08-01T00:00:00.000Z";
    const pubMs = Date.parse(pub);
    const at = (days: number, n: number, episodeId: string) =>
      Array.from({ length: n }, (_, i) =>
        row({
          time: new Date(pubMs + days * 86_400_000 + i * 1000).toISOString(),
          episodeId,
          audienceId: `${episodeId}-${days}-${i}`,
        }),
      );

    const target = { episodeId: "t", pubdate: pub, rows: at(0, 10, "t") };
    const others = [
      { episodeId: "o1", pubdate: pub, rows: at(0, 5, "o1") },
      { episodeId: "o2", pubdate: pub, rows: at(0, 5, "o2") },
    ];

    const now = pubMs + 10 * 86_400_000;
    const curve = episodeCurve(target, others, 2, now);
    expect(curve.comparedEpisodes).toBe(2);
    expect(curve.points[0]!.cumulative).toBe(10);
    expect(curve.points[0]!.medianCumulative).toBe(5);
    expect(curve.points[0]!.vsMedian).toBe(200);
    expect(curve.verdict).toMatch(/Ahead of pace/);
  });

  it("excludes episodes younger than the horizon from the median", () => {
    const pub = "2026-08-01T00:00:00.000Z";
    const pubMs = Date.parse(pub);
    const now = pubMs + 40 * 86_400_000;
    const curve = episodeCurve(
      { episodeId: "t", pubdate: pub, rows: [] },
      // Published yesterday relative to `now`, so it cannot have a 30-day figure.
      [{ episodeId: "young", pubdate: new Date(now - 86_400_000).toISOString(), rows: [] }],
      30,
      now,
    );
    expect(curve.comparedEpisodes).toBe(0);
    expect(curve.verdict).toMatch(/nothing to compare/i);
  });

  it("says so when an episode has no publication date", () => {
    const curve = episodeCurve({ episodeId: "t", rows: [] }, [], 30);
    expect(curve.verdict).toMatch(/no publication date/i);
  });
});
