import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { BePackError } from "../../errors/BePackError.js";
import {
    analyzeCpuProfile,
    countFunctions,
    largestBurst,
    loadCpuProfile,
    stackRows,
} from "../analyze.js";

function fixture(name: string): string {
    return fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
}

function expectProfileError(run: () => unknown, pattern: RegExp): void {
    try {
        run();
        throw new Error("expected analyzeCpuProfile to throw");
    } catch (error) {
        expect(error).toBeInstanceOf(BePackError);
        expect((error as BePackError).code).toBe("PROFILE_INVALID");
        expect((error as Error).message).toMatch(pattern);
    }
}

describe("loadCpuProfile", () => {
    it("does not count idle gaps as tick self time", async () => {
        const profile = await loadCpuProfile(fixture("idle-gap.cpuprofile"));

        expect(profile.samples).toHaveLength(12);
        expect(profile.activeSamples).toHaveLength(10);
        expect(profile.gapSamples).toHaveLength(2);
        expect(profile.busyMs).toBe(10);
        expect(profile.idleMs).toBe(100);
        expect(profile.durationMs).toBe(110);

        const counts = countFunctions(profile.samples, { by: "self", gapMs: profile.gapMs });
        expect(counts.active).toBe(10);
        expect(counts.busyMs).toBe(10);
        expect(counts.rows.map((row) => row.node.callFrame.functionName)).toEqual(["doWork"]);
        expect(counts.rows[0]?.count).toBe(10);
        expect(counts.rows[0]?.ms).toBe(10);
    });

    it("detects bursts with their sample counts, stacks and intervals", async () => {
        const profile = await loadCpuProfile(fixture("bursts.cpuprofile"));

        expect(profile.durationMs).toBe(195);
        expect(profile.activeSamples).toHaveLength(45);
        expect(profile.gapSamples).toHaveLength(3);
        expect(profile.busyMs).toBe(45);
        expect(profile.idleMs).toBe(150);
        expect(profile.bursts).toHaveLength(2);

        const [first, second] = profile.bursts;
        expect(first).toMatchObject({
            startMs: 51,
            endMs: 70,
            spanMs: 19,
            busyMs: 20,
            samples: 20,
        });
        expect(second).toMatchObject({
            startMs: 121,
            endMs: 145,
            spanMs: 24,
            busyMs: 25,
            samples: 25,
        });

        const stacks = stackRows(first!.run, profile.gapMs, 5);
        expect(stacks[0]?.count).toBe(20);
        expect(stacks[0]?.sample.stack.map((node) => node.callFrame.functionName)).toEqual([
            "World::getDynamicProperty",
            "readMetaKey",
            "list",
            "tick",
            "(root)",
        ]);
    });

    it("excludes a leading idle gap from top windows", async () => {
        const profile = await loadCpuProfile(fixture("idle-gap.cpuprofile"));
        const selected = profile.samples.filter(
            (sample) => sample.timeMs >= 50 && sample.timeMs <= 60
        );
        expect(selected).toHaveLength(11);

        const counts = countFunctions(selected, { by: "self", gapMs: profile.gapMs });
        expect(counts.active).toBe(10);
        expect(counts.rows.map((row) => row.node.callFrame.functionName)).toEqual(["doWork"]);
    });

    it("supports inclusive attribution for top --by total", async () => {
        const profile = await loadCpuProfile(fixture("idle-gap.cpuprofile"));
        const counts = countFunctions(profile.samples, { by: "total", gapMs: profile.gapMs });
        const tick = counts.rows.find((row) => row.node.callFrame.functionName === "tick");
        expect(tick?.count).toBe(10);
    });
});

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

function rowFor(rows: ReturnType<typeof countFunctions>["rows"], name: string) {
    return rows.find((row) => row.node.callFrame.functionName === name);
}

describe("time-weighted attribution", () => {
    it("weights self time by each sample's delta instead of its sample count", () => {
        const profile = analyzeCpuProfile(unevenProfile());
        expect(profile.busyMs).toBeCloseTo(1.2);

        const counts = countFunctions(profile.samples, { by: "self", gapMs: profile.gapMs });
        const short = rowFor(counts.rows, "shortWork");
        const long = rowFor(counts.rows, "longWork");

        expect(short?.count).toBe(2);
        expect(long?.count).toBe(1);
        expect(short?.ms).toBeCloseTo(0.2);
        expect(long?.ms).toBeCloseTo(1);
        expect(short?.share).toBeCloseTo(0.2 / 1.2);
        expect(long?.share).toBeCloseTo(1 / 1.2);

        // The old count-based weighting put shortWork with 2 samples first.
        expect(counts.rows[0]?.node.callFrame.functionName).toBe("longWork");
    });

    it("gives ancestors the child's real time for --by total", () => {
        const profile = analyzeCpuProfile(unevenProfile());
        const counts = countFunctions(profile.samples, { by: "total", gapMs: profile.gapMs });

        expect(rowFor(counts.rows, "shortWork")?.ms).toBeCloseTo(0.2);
        expect(rowFor(counts.rows, "longWork")?.ms).toBeCloseTo(1);
        expect(rowFor(counts.rows, "tick")?.ms).toBeCloseTo(1.2);
        expect(rowFor(counts.rows, "(root)")?.ms).toBeCloseTo(1.2);
        expect(rowFor(counts.rows, "tick")?.count).toBe(3);
    });

    it("weights stack rows by the samples' real time", () => {
        const profile = analyzeCpuProfile(unevenProfile());
        const rows = stackRows(profile.samples, profile.gapMs, 5);

        expect(rows).toHaveLength(2);
        expect(rows[0]?.sample.stack[0]?.callFrame.functionName).toBe("longWork");
        expect(rows[0]?.count).toBe(1);
        expect(rows[0]?.ms).toBeCloseTo(1);
        expect(rows[0]?.share).toBeCloseTo(1 / 1.2);
        expect(rows[1]?.ms).toBeCloseTo(0.2);
        expect(rows[1]?.share).toBeCloseTo(0.2 / 1.2);
    });

    it("picks the largest burst by busy time, then sample count", () => {
        const profile = analyzeCpuProfile(
            {
                ...unevenProfile(),
                samples: [3, 3, 3, 3, 4],
                timeDeltas: [100, 100, 100, 50000, 1000],
            },
            { minSamples: 1 }
        );

        expect(profile.bursts).toHaveLength(2);
        expect(profile.bursts[0]?.samples).toBe(3);
        expect(profile.bursts[0]?.busyMs).toBeCloseTo(0.3);
        expect(profile.bursts[1]?.samples).toBe(1);
        expect(profile.bursts[1]?.busyMs).toBeCloseTo(1);

        // More samples but less time: the old sample-count comparison picked it.
        expect(largestBurst(profile)).toBe(profile.bursts[1]);
    });
});

describe("analyzeCpuProfile validation", () => {
    it("rejects a non-object profile", () => {
        expectProfileError(() => analyzeCpuProfile(null), /JSON object/);
    });

    it("rejects missing required arrays", () => {
        expectProfileError(() => analyzeCpuProfile({ nodes: [] }), /missing samples array/);
        expectProfileError(
            () => analyzeCpuProfile({ nodes: [], samples: [] }),
            /missing timeDeltas array/
        );
    });

    it("rejects uneven samples and timeDeltas", () => {
        expectProfileError(
            () => analyzeCpuProfile({ nodes: [], samples: [1], timeDeltas: [] }),
            /same length/
        );
    });

    it("rejects samples that reference unknown nodes", () => {
        expectProfileError(
            () =>
                analyzeCpuProfile({
                    nodes: [],
                    samples: [7],
                    timeDeltas: [1000],
                }),
            /unknown node 7/
        );
    });

    it("rejects malformed call frames", () => {
        expectProfileError(
            () =>
                analyzeCpuProfile({
                    nodes: [{ id: 1, callFrame: null }],
                    samples: [1],
                    timeDeltas: [1000],
                }),
            /callFrame/
        );
        expectProfileError(
            () =>
                analyzeCpuProfile({
                    nodes: [{ id: "1", callFrame: {} }],
                    samples: [1],
                    timeDeltas: [1000],
                }),
            /nodes\[0\]\.id/
        );
    });

    it("rejects negative time deltas", () => {
        expectProfileError(
            () =>
                analyzeCpuProfile({
                    nodes: [{ id: 1, callFrame: {} }],
                    samples: [1],
                    timeDeltas: [-1],
                }),
            /must not be negative/
        );
    });

    it("reports invalid JSON and unreadable files clearly", async () => {
        const temp = mkdtempSync(join(tmpdir(), "bepack-profile-"));
        try {
            const invalid = join(temp, "invalid.cpuprofile");
            writeFileSync(invalid, "{ not json");
            await expect(loadCpuProfile(invalid)).rejects.toMatchObject({
                code: "PROFILE_INVALID",
                message: expect.stringContaining("not valid JSON"),
            });
            await expect(loadCpuProfile(join(temp, "missing.cpuprofile"))).rejects.toMatchObject({
                code: "PROFILE_READ_FAILED",
            });
        } finally {
            rmSync(temp, { recursive: true, force: true });
        }
    });
});
