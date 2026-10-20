import { readFile } from "node:fs/promises";
import { BePackError } from "../errors/BePackError.js";
import type {
    Burst,
    CallFrame,
    CpuProfile,
    CpuProfileAnalysis,
    CpuProfileNode,
    CpuProfileOptions,
    FunctionCounts,
    ProfileSample,
    SortBy,
    StackRow,
} from "./types.js";

export const DEFAULT_GAP_MS = 5;
export const DEFAULT_MIN_BURST_SAMPLES = 20;

const DEFAULT_FILE = "<profile>";

function invalid(file: string, message: string, details?: unknown): never {
    throw new BePackError("PROFILE_INVALID", `${file}: ${message}`, {
        ...(details === undefined ? {} : { details }),
        suggestions: ["Check that the file was produced by a V8 profiler and is valid JSON."],
    });
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown, path: string, file: string): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        invalid(file, `${path} must be a finite number`);
    }
    return value;
}

function integer(value: unknown, path: string, file: string): number {
    const number = finiteNumber(value, path, file);
    if (!Number.isInteger(number)) invalid(file, `${path} must be an integer`);
    return number;
}

function optionalNumber(
    record: Record<string, unknown>,
    key: string,
    path: string,
    file: string
): number | undefined {
    const value = record[key];
    if (value === undefined) return undefined;
    return finiteNumber(value, `${path}.${key}`, file);
}

function optionalInteger(
    record: Record<string, unknown>,
    key: string,
    path: string,
    file: string
): number | undefined {
    const value = record[key];
    if (value === undefined) return undefined;
    return integer(value, `${path}.${key}`, file);
}

function parseCallFrame(value: unknown, path: string, file: string): CallFrame {
    if (!isRecord(value)) invalid(file, `${path} must be an object`);

    const functionName = value.functionName ?? "";
    if (typeof functionName !== "string") {
        invalid(file, `${path}.functionName must be a string`);
    }

    const url = value.url ?? "";
    if (typeof url !== "string") invalid(file, `${path}.url must be a string`);

    const rawScriptId = value.scriptId;
    let scriptId: string;
    if (rawScriptId === undefined) {
        scriptId = "0";
    } else if (typeof rawScriptId === "number" && Number.isFinite(rawScriptId)) {
        scriptId = String(rawScriptId);
    } else if (typeof rawScriptId === "string") {
        scriptId = rawScriptId;
    } else {
        invalid(file, `${path}.scriptId must be a string`);
    }

    const lineNumber = value.lineNumber ?? -1;
    if (typeof lineNumber !== "number" || !Number.isFinite(lineNumber)) {
        invalid(file, `${path}.lineNumber must be a finite number`);
    }

    const columnNumber = value.columnNumber ?? -1;
    if (typeof columnNumber !== "number" || !Number.isFinite(columnNumber)) {
        invalid(file, `${path}.columnNumber must be a finite number`);
    }

    return {
        functionName,
        scriptId,
        url,
        lineNumber,
        columnNumber,
    };
}

function parseNode(value: unknown, index: number, file: string): CpuProfileNode {
    const path = `nodes[${index}]`;
    if (!isRecord(value)) invalid(file, `${path} must be an object`);

    const id = integer(value.id, `${path}.id`, file);
    const callFrame = parseCallFrame(value.callFrame, `${path}.callFrame`, file);
    const hitCount = optionalInteger(value, "hitCount", path, file);
    const locationId = optionalInteger(value, "locationId", path, file);

    let children: number[] | undefined;
    if (value.children !== undefined) {
        if (!Array.isArray(value.children)) {
            invalid(file, `${path}.children must be an array`);
        }
        children = value.children.map((child, childIndex) =>
            integer(child, `${path}.children[${childIndex}]`, file)
        );
    }

    return {
        id,
        callFrame,
        ...(hitCount === undefined ? {} : { hitCount }),
        ...(children === undefined ? {} : { children }),
        ...(locationId === undefined ? {} : { locationId }),
    };
}

/**
 * Validate and normalize a parsed `.cpuprofile`.
 *
 * Unknown properties are ignored; BePack only needs nodes, samples and
 * timeDeltas. A profile that cannot be interpreted produces PROFILE_INVALID
 * instead of a partial or silently empty analysis.
 */
export function parseCpuProfile(value: unknown, file = DEFAULT_FILE): CpuProfile {
    if (!isRecord(value)) invalid(file, "profile root must be a JSON object");

    if (!Array.isArray(value.nodes)) invalid(file, "missing nodes array");
    if (!Array.isArray(value.samples)) invalid(file, "missing samples array");
    if (!Array.isArray(value.timeDeltas)) invalid(file, "missing timeDeltas array");

    const nodes = value.nodes.map((node, index) => parseNode(node, index, file));
    const ids = new Set<number>();
    for (const node of nodes) {
        if (ids.has(node.id)) invalid(file, `duplicate node id ${node.id}`);
        ids.add(node.id);
    }

    for (const node of nodes) {
        for (const child of node.children ?? []) {
            if (!ids.has(child)) {
                invalid(file, `node ${node.id} references unknown child node ${child}`);
            }
        }
    }

    if (value.timeDeltas.length !== value.samples.length) {
        invalid(
            file,
            `samples and timeDeltas must have the same length (${value.samples.length} != ${value.timeDeltas.length})`
        );
    }

    const samples = value.samples.map((sample, index) => {
        const id = integer(sample, `samples[${index}]`, file);
        if (!ids.has(id)) {
            invalid(file, `samples[${index}] references unknown node ${id}`);
        }
        return id;
    });

    const timeDeltas = value.timeDeltas.map((delta, index) => {
        const number = finiteNumber(delta, `timeDeltas[${index}]`, file);
        if (number < 0) invalid(file, `timeDeltas[${index}] must not be negative`);
        return number;
    });

    const startTime = optionalNumber(value, "startTime", "profile", file);
    const endTime = optionalNumber(value, "endTime", "profile", file);

    return {
        nodes,
        samples,
        timeDeltas,
        ...(startTime === undefined ? {} : { startTime }),
        ...(endTime === undefined ? {} : { endTime }),
    };
}

function buildStack(
    node: CpuProfileNode,
    parentById: Map<number, number>,
    nodesById: Map<number, CpuProfileNode>
): CpuProfileNode[] {
    const stack: CpuProfileNode[] = [];
    const seen = new Set<number>();
    let current: number | undefined = node.id;

    while (current !== undefined && !seen.has(current)) {
        seen.add(current);
        const stackNode = nodesById.get(current);
        if (!stackNode) break;
        stack.push(stackNode);
        current = parentById.get(current);
    }

    return stack;
}

function makeBurst(run: ProfileSample[]): Burst {
    const first = run[0];
    const last = run[run.length - 1];
    if (!first || !last) {
        throw new Error("cannot create a burst from an empty sample run");
    }

    const busyMs = run.reduce((total, sample) => total + sample.deltaMs, 0);
    return {
        startMs: first.timeMs,
        endMs: last.timeMs,
        spanMs: last.timeMs - first.timeMs,
        busyMs,
        samples: run.length,
        run,
    };
}

function findBursts(samples: readonly ProfileSample[], minSamples: number): Burst[] {
    const runs: Burst[] = [];
    let current: ProfileSample[] = [];

    for (const sample of samples) {
        if (sample.active) {
            current.push(sample);
            continue;
        }
        if (current.length > 0 && current.length >= minSamples) runs.push(makeBurst(current));
        current = [];
    }
    if (current.length > 0 && current.length >= minSamples) runs.push(makeBurst(current));

    return runs;
}

function analyze(value: unknown, file: string, options: CpuProfileOptions): CpuProfileAnalysis {
    const raw = parseCpuProfile(value, file);
    const gapMs = options.gapMs ?? DEFAULT_GAP_MS;
    const minSamples = options.minSamples ?? DEFAULT_MIN_BURST_SAMPLES;

    const nodesById = new Map(raw.nodes.map((node) => [node.id, node]));
    const parentById = new Map<number, number>();
    for (const node of raw.nodes) {
        for (const child of node.children ?? []) parentById.set(child, node.id);
    }

    const gapUs = gapMs * 1000;
    let elapsedUs = 0;
    const samples: ProfileSample[] = [];

    for (let index = 0; index < raw.samples.length; index++) {
        const deltaUs = raw.timeDeltas[index] ?? 0;
        elapsedUs += deltaUs;

        const node = nodesById.get(raw.samples[index] ?? -1);
        if (!node) continue;

        samples.push({
            index,
            timeMs: elapsedUs / 1000,
            deltaMs: deltaUs / 1000,
            active: deltaUs <= gapUs,
            node,
            stack: buildStack(node, parentById, nodesById),
        });
    }

    const activeSamples = samples.filter((sample) => sample.active);
    const gapSamples = samples.filter((sample) => !sample.active);
    const busyMs = activeSamples.reduce((total, sample) => total + sample.deltaMs, 0);
    const idleMs = gapSamples.reduce((total, sample) => total + sample.deltaMs, 0);

    return {
        file,
        raw,
        samples,
        activeSamples,
        gapSamples,
        busyMs,
        idleMs,
        durationMs: elapsedUs / 1000,
        gapMs,
        minSamples,
        bursts: findBursts(samples, minSamples),
    };
}

/** Analyze an already-parsed profile object. */
export function analyzeCpuProfile(
    value: unknown,
    options: CpuProfileOptions = {}
): CpuProfileAnalysis {
    return analyze(value, DEFAULT_FILE, options);
}

/** Read and analyze a `.cpuprofile` file. */
export async function loadCpuProfile(
    file: string,
    options: CpuProfileOptions = {}
): Promise<CpuProfileAnalysis> {
    let contents: string;
    try {
        contents = await readFile(file, "utf8");
    } catch (error) {
        throw new BePackError(
            "PROFILE_READ_FAILED",
            `Cannot read profile ${file}: ${error instanceof Error ? error.message : String(error)}`,
            {
                details: { file },
                suggestions: ["Check the path and that the file is readable."],
            }
        );
    }

    let value: unknown;
    try {
        value = JSON.parse(contents);
    } catch (error) {
        invalid(file, `not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }

    return analyze(value, file, options);
}

export function functionKey(node: CpuProfileNode): string {
    const frame = node.callFrame;
    return `${frame.functionName || "(anonymous)"}\u0000${frame.url || "(unknown)"}\u0000${frame.lineNumber}`;
}

/**
 * Count function samples in a set of samples.
 *
 * Deltas above the gap threshold are skipped even when the caller has already
 * selected a time window. This removes the tick gap attached to the first
 * sample inside a `top --from/--to` window.
 *
 * Deltas are not uniform, so each active sample contributes its own
 * `deltaMs` to the row it attributes to rather than an equal share of the
 * total busy time. `share` is therefore the share of busy time, not of the
 * sample count.
 */
export function countFunctions(
    samples: readonly ProfileSample[],
    { by, gapMs }: { by: SortBy; gapMs: number }
): FunctionCounts {
    const counts = new Map<string, { node: CpuProfileNode; count: number; ms: number }>();
    let active = 0;
    let busyMs = 0;

    for (const sample of samples) {
        if (sample.deltaMs > gapMs) continue;
        active++;
        busyMs += sample.deltaMs;

        if (by === "self") {
            const node = sample.stack[0];
            if (!node) continue;
            const key = functionKey(node);
            const entry = counts.get(key) ?? { node, count: 0, ms: 0 };
            entry.count++;
            entry.ms += sample.deltaMs;
            counts.set(key, entry);
            continue;
        }

        const seen = new Set<string>();
        for (const node of sample.stack) {
            const key = functionKey(node);
            if (seen.has(key)) continue;
            seen.add(key);
            const entry = counts.get(key) ?? { node, count: 0, ms: 0 };
            entry.count++;
            entry.ms += sample.deltaMs;
            counts.set(key, entry);
        }
    }

    const rows = [...counts.values()]
        .map((entry) => ({
            node: entry.node,
            count: entry.count,
            share: busyMs === 0 ? 0 : entry.ms / busyMs,
            ms: entry.ms,
        }))
        .sort(
            (a, b) =>
                b.ms - a.ms ||
                b.count - a.count ||
                a.node.callFrame.functionName.localeCompare(b.node.callFrame.functionName)
        );

    return { rows, active, busyMs };
}

export function stackRows(
    samples: readonly ProfileSample[],
    gapMs: number,
    limit: number
): StackRow[] {
    const stacks = new Map<string, { sample: ProfileSample; count: number; ms: number }>();
    let busyMs = 0;

    for (const sample of samples) {
        if (sample.deltaMs > gapMs) continue;
        busyMs += sample.deltaMs;
        const signature = sample.stack.map((node) => functionKey(node)).join("\n");
        const entry = stacks.get(signature) ?? { sample, count: 0, ms: 0 };
        entry.count++;
        entry.ms += sample.deltaMs;
        stacks.set(signature, entry);
    }

    return [...stacks.values()]
        .sort((a, b) => b.ms - a.ms || b.count - a.count)
        .slice(0, limit)
        .map((entry) => ({
            sample: entry.sample,
            count: entry.count,
            share: busyMs === 0 ? 0 : entry.ms / busyMs,
            ms: entry.ms,
        }));
}

/**
 * Pick the burst with the most busy CPU time, which is the actual slowest
 * tick. Sample count is only a tie-breaker because uneven `timeDeltas` mean a
 * burst with fewer samples can still spend more time on the CPU.
 */
export function largestBurst(profile: CpuProfileAnalysis): Burst | undefined {
    return profile.bursts.reduce<Burst | undefined>((best, burst) => {
        if (!best) return burst;
        if (burst.busyMs !== best.busyMs) return burst.busyMs > best.busyMs ? burst : best;
        return burst.samples > best.samples ? burst : best;
    }, undefined);
}
