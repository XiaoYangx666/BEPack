import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { BePackError } from "../../errors/BePackError.js";
import { analyzeCpuProfile, countFunctions, loadCpuProfile, stackRows } from "../analyze.js";

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
