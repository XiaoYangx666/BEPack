export interface CallFrame {
    functionName: string;
    scriptId: string;
    url: string;
    lineNumber: number;
    columnNumber: number;
}

export interface CpuProfileNode {
    id: number;
    callFrame: CallFrame;
    hitCount?: number;
    children?: number[];
    locationId?: number;
}

/**
 * The parts of a V8 `.cpuprofile` used by BePack's analysis.
 *
 * Bedrock's profiler writes a standard V8 profile, but it does not emit idle
 * samples. The time between script ticks therefore arrives as a large
 * `timeDeltas` value on the first sample of the next tick.
 */
export interface CpuProfile {
    nodes: CpuProfileNode[];
    samples: number[];
    timeDeltas: number[];
    startTime?: number;
    endTime?: number;
}

export type SortBy = "self" | "total";

export interface ProfileSample {
    index: number;
    timeMs: number;
    deltaMs: number;
    active: boolean;
    node: CpuProfileNode;
    stack: CpuProfileNode[];
}

export interface Burst {
    startMs: number;
    endMs: number;
    spanMs: number;
    busyMs: number;
    samples: number;
    run: ProfileSample[];
}

export interface CpuProfileAnalysis {
    file: string;
    raw: CpuProfile;
    samples: ProfileSample[];
    activeSamples: ProfileSample[];
    gapSamples: ProfileSample[];
    busyMs: number;
    idleMs: number;
    durationMs: number;
    gapMs: number;
    minSamples: number;
    bursts: Burst[];
}

export interface CpuProfileOptions {
    gapMs?: number;
    minSamples?: number;
}

export interface FunctionRow {
    node: CpuProfileNode;
    count: number;
    share: number;
    ms: number;
}

export interface StackRow {
    sample: ProfileSample;
    count: number;
    share: number;
    ms: number;
}

export interface FunctionCounts {
    rows: FunctionRow[];
    active: number;
    busyMs: number;
}
