import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { analyzeCpuProfile, loadCpuProfile } from "../analyze.js";
import { burstsReport, diffReport, summaryReport, topReport } from "../report.js";

const root = "/project";

function fixture(name: string): string {
    return fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
}

function unevenProfile() {
    return {
        nodes: [
            {
                id: 1,
                callFrame: {
                    functionName: "(root)",
                    scriptId: "0",
                    url: "",
                    lineNumber: -1,
                    columnNumber: 0,
                },
                children: [2],
            },
            {
                id: 2,
                callFrame: {
                    functionName: "tick",
                    scriptId: "1",
                    url: "bedrock://script",
                    lineNumber: 0,
                    columnNumber: 0,
                },
                children: [3, 4],
            },
            {
                id: 3,
                callFrame: {
                    functionName: "shortWork",
                    scriptId: "3",
                    url: "/project/short.js",
                    lineNumber: 0,
                    columnNumber: 0,
                },
            },
            {
                id: 4,
                callFrame: {
                    functionName: "longWork",
                    scriptId: "4",
                    url: "/project/long.js",
                    lineNumber: 0,
                    columnNumber: 0,
                },
            },
        ],
        samples: [3, 3, 4],
        timeDeltas: [100, 100, 1000],
    };
}

describe("profile reports", () => {
    it("sorts summary bursts by busy time while keeping per-burst top functions", async () => {
        const profile = await loadCpuProfile(fixture("bursts.cpuprofile"));
        const report = summaryReport([profile], { limit: 15, root });

        expect(report.data.profiles[0]?.bursts.map((burst) => burst.samples)).toEqual([25, 20]);
        expect(report.data.profiles[0]?.bursts[0]?.topSelf[0]).toMatchObject({
            functionName: "slowLoop",
            url: "scripts/loop.js",
            line: 31,
            count: 25,
        });

        const busiest = report.text.indexOf("@ 121.0-145.0 ms");
        const second = report.text.indexOf("@ 51.0-70.0 ms");
        expect(busiest).toBeGreaterThan(-1);
        expect(second).toBeGreaterThan(busiest);
        expect(report.text).toContain("bursts: 2 (>= 20 samples)");
    });

    it("prints bursts in time order with intervals and stacks", async () => {
        const profile = await loadCpuProfile(fixture("bursts.cpuprofile"));
        const report = burstsReport([profile], { limit: 15, stacks: 5, root });

        const first = report.text.indexOf("burst #1: 51.0-70.0 ms");
        const second = report.text.indexOf("burst #2: 121.0-145.0 ms");
        expect(first).toBeGreaterThan(-1);
        expect(second).toBeGreaterThan(first);
        expect(report.text).toContain("burst intervals: 70.0 ms");
        expect(report.text).toContain(
            "World::getDynamicProperty (bedrock://script:1) <- readMetaKey (scripts/meta.js:5) <- list (scripts/inventory.js:20) <- tick (bedrock://script:1) <- (root) ((unknown))"
        );

        expect(report.data.profiles[0]?.intervals).toEqual([70]);
        expect(report.data.profiles[0]?.bursts[1]?.topSelf[0]?.functionName).toBe("slowLoop");
    });

    it("excludes the leading idle gap from top windows", async () => {
        const profile = await loadCpuProfile(fixture("idle-gap.cpuprofile"));
        const report = topReport(profile, {
            limit: 15,
            root,
            by: "self",
            fromMs: 50,
            toMs: 60,
        });

        expect(report.text).toContain("window: 50-60 ms | active: 10 samples");
        expect(report.text).toContain("doWork  scripts/main.js:10");
        expect(report.text).not.toContain("tick ");
        expect(report.data.profile.activeSamples).toBe(10);
        expect(report.data.profile.rows.map((row) => row.functionName)).toEqual(["doWork"]);

        const inclusive = topReport(profile, {
            limit: 15,
            root,
            by: "total",
            fromMs: 50,
            toMs: 60,
        });
        expect(inclusive.data.profile.rows.map((row) => row.functionName)).toContain("tick");
    });

    it("weights burst top rows by real time for uneven sample deltas", () => {
        const profile = analyzeCpuProfile(unevenProfile(), { minSamples: 1 });
        const report = burstsReport([profile], { limit: 15, stacks: 5, root });

        const burst = report.data.profiles[0]?.bursts[0];
        expect(burst?.samples).toBe(3);
        expect(burst?.busyMs).toBeCloseTo(1.2);
        expect(burst?.topSelf[0]).toMatchObject({
            functionName: "longWork",
            url: "long.js",
            count: 1,
        });
        expect(burst?.topSelf[0]?.ms).toBeCloseTo(1);
        expect(burst?.topSelf[0]?.share).toBeCloseTo(1 / 1.2);
        expect(burst?.topSelf[1]?.functionName).toBe("shortWork");
        expect(burst?.topSelf[1]?.ms).toBeCloseTo(0.2);

        expect(burst?.topStacks[0]?.ms).toBeCloseTo(1);
        expect(burst?.topStacks[0]?.share).toBeCloseTo(1 / 1.2);
        expect(report.text).toContain("longWork  long.js:1");
    });

    it("diffs changes and falls back to whole active samples when one side has no burst", async () => {
        const before = await loadCpuProfile(fixture("bursts.cpuprofile"));
        const after = await loadCpuProfile(fixture("after-no-burst.cpuprofile"));
        const report = diffReport(before, after, { limit: 15, root });

        expect(report.data.compared).toBe("active");
        expect(report.data.before.largestBurst?.samples).toBe(25);
        expect(report.data.after.largestBurst).toBeNull();
        expect(report.data.changes).toEqual([
            {
                functionName: "slowLoop",
                url: "scripts/loop.js",
                line: 31,
                before: 25,
                after: 3,
                delta: -22,
            },
            {
                functionName: "list",
                url: "scripts/inventory.js",
                line: 20,
                before: 0,
                after: 7,
                delta: 7,
            },
        ]);
        expect(report.text).toContain("active self samples (after - before):");
        expect(report.text).not.toContain("largest-burst self samples");
        expect(report.text).toContain("-22    25 ->    3  slowLoop");
        expect(report.text).toContain("+   7     0 ->    7  list");
    });

    it("compares the largest bursts when both profiles have one", async () => {
        const profile = await loadCpuProfile(fixture("bursts.cpuprofile"));
        const report = diffReport(profile, profile, { limit: 15, root });

        expect(report.data.compared).toBe("burst");
        expect(report.text).toContain("largest-burst self samples (after - before):");
        expect(report.text).toContain("no difference");
    });
});
