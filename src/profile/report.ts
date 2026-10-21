import { countFunctions, functionKey, largestBurst, stackRows } from "./analyze.js";
import type {
    Burst,
    CpuProfileAnalysis,
    CpuProfileNode,
    FunctionRow,
    SortBy,
    StackRow,
} from "./types.js";

export interface FunctionSummary {
    functionName: string;
    url: string;
    line: number | null;
    count: number;
    share: number;
    ms: number;
}

export interface StackSummary {
    count: number;
    share: number;
    ms: number;
    stack: string;
    frames: string[];
}

export interface BurstSummary {
    startMs: number;
    endMs: number;
    spanMs: number;
    busyMs: number;
    samples: number;
    topSelf: FunctionSummary[];
    topStacks: StackSummary[];
}

export interface SummaryProfile {
    file: string;
    durationMs: number;
    samples: number;
    activeSamples: number;
    busyMs: number;
    idleMs: number;
    gapMs: number;
    minSamples: number;
    bursts: BurstSummary[];
}

export interface SummaryReport {
    text: string;
    data: { profiles: SummaryProfile[] };
}

export interface BurstsProfile {
    file: string;
    minSamples: number;
    bursts: BurstSummary[];
    intervals: number[];
}

export interface BurstsReport {
    text: string;
    data: { profiles: BurstsProfile[] };
}

export interface TopProfile {
    file: string;
    window: { fromMs: number | null; toMs: number | null };
    by: SortBy;
    activeSamples: number;
    busyMs: number;
    rows: FunctionSummary[];
}

export interface TopReport {
    text: string;
    data: { profile: TopProfile };
}

export interface DiffSide {
    file: string;
    durationMs: number;
    activeSamples: number;
    busyMs: number;
    bursts: number;
    largestBurst: BurstSummary | null;
}

export interface DiffChange {
    functionName: string;
    url: string;
    line: number | null;
    before: number;
    after: number;
    delta: number;
}

export interface DiffReport {
    text: string;
    data: {
        before: DiffSide;
        after: DiffSide;
        compared: "burst" | "active";
        changes: DiffChange[];
    };
}

export interface ReportOptions {
    limit: number;
    root: string;
}

export interface TopReportOptions extends ReportOptions {
    by: SortBy;
    fromMs?: number;
    toMs?: number;
}

export interface BurstsReportOptions extends ReportOptions {
    stacks: number;
}

function formatMs(value: number): string {
    if (value >= 1000) return `${(value / 1000).toFixed(2)} s`;
    return `${value.toFixed(1)} ms`;
}

function formatPercent(value: number): string {
    return `${(value * 100).toFixed(1)}%`;
}

function functionFrame(
    node: CpuProfileNode,
    root: string
): Omit<FunctionSummary, "count" | "share" | "ms"> {
    const frame = node.callFrame;
    let url = frame.url || "(unknown)";
    // Profile URLs are source identifiers, not host-native filesystem paths. Keep their
    // display format stable across platforms even when the profile or root uses `\\`.
    const sourceUrl = url.replace(/\\/g, "/");
    const sourceRoot = root.replace(/\\/g, "/").replace(/\/+$/, "");
    const compareUrl = process.platform === "win32" ? sourceUrl.toLowerCase() : sourceUrl;
    const rootCandidates = [sourceRoot];
    // Profiles may use POSIX-style absolute URLs even when analyzed on Windows. In that
    // case `path.resolve()` has added a drive to --root; also compare the drive-free root.
    if (process.platform === "win32" && /^[a-z]:/i.test(sourceRoot)) {
        rootCandidates.push(sourceRoot.slice(2));
    }
    const matchedRoot = rootCandidates.find((candidate) => {
        const compareRoot = process.platform === "win32" ? candidate.toLowerCase() : candidate;
        return (
            compareUrl === compareRoot ||
            (compareRoot !== "/" && compareUrl.startsWith(`${compareRoot}/`)) ||
            (compareRoot === "/" && compareUrl.startsWith("/"))
        );
    });
    if (matchedRoot === "/") {
        url = sourceUrl.slice(1);
    } else if (matchedRoot) {
        url =
            compareUrl === (process.platform === "win32" ? matchedRoot.toLowerCase() : matchedRoot)
                ? "."
                : sourceUrl.slice(matchedRoot.length + 1);
    } else if (!sourceRoot && sourceUrl.startsWith("/")) {
        url = sourceUrl.slice(1);
    } else {
        url = sourceUrl;
    }

    return {
        functionName: frame.functionName || "(anonymous)",
        url,
        line: frame.lineNumber >= 0 ? frame.lineNumber + 1 : null,
    };
}

function functionLine(summary: Omit<FunctionSummary, "count" | "share" | "ms">): string {
    return `${summary.functionName}  ${summary.url}${summary.line === null ? "" : `:${summary.line}`}`;
}

function displayFunction(summary: FunctionSummary): string {
    return functionLine(summary);
}

function summarizeFunction(row: FunctionRow, root: string): FunctionSummary {
    return {
        ...functionFrame(row.node, root),
        count: row.count,
        share: row.share,
        ms: row.ms,
    };
}

function displayStack(row: StackRow, root: string): string {
    return row.sample.stack
        .map((node) => {
            const summary = functionFrame(node, root);
            return `${summary.functionName} (${summary.url}${summary.line === null ? "" : `:${summary.line}`})`;
        })
        .join(" <- ");
}

function summarizeStack(row: StackRow, root: string): StackSummary {
    return {
        count: row.count,
        share: row.share,
        ms: row.ms,
        stack: displayStack(row, root),
        frames: row.sample.stack.map((node) => {
            const summary = functionFrame(node, root);
            return `${summary.functionName} (${summary.url}${summary.line === null ? "" : `:${summary.line}`})`;
        }),
    };
}

function functionTextRow(summary: FunctionSummary, indent: string): string {
    return (
        `${indent}${String(summary.count).padStart(4)}  ` +
        `${formatPercent(summary.share).padStart(6)}  ` +
        `${formatMs(summary.ms).padStart(9)}  ${displayFunction(summary)}`
    );
}

function stackTextRow(summary: StackSummary, indent: string): string {
    return (
        `${indent}${String(summary.count).padStart(4)}  ` +
        `${formatPercent(summary.share).padStart(6)}  ` +
        `${formatMs(summary.ms).padStart(9)}  ${summary.stack}`
    );
}

function burstLine(burst: BurstSummary, prefix = ""): string {
    return (
        `${prefix}${burst.startMs.toFixed(1)}-${burst.endMs.toFixed(1)} ms | ` +
        `${burst.samples} samples | span ${formatMs(burst.spanMs)} | busy ${formatMs(burst.busyMs)}`
    );
}

function summarizeBurst(
    profile: CpuProfileAnalysis,
    burst: Burst,
    options: BurstsReportOptions
): BurstSummary {
    return {
        startMs: burst.startMs,
        endMs: burst.endMs,
        spanMs: burst.spanMs,
        busyMs: burst.busyMs,
        samples: burst.samples,
        topSelf: countFunctions(burst.run, { by: "self", gapMs: profile.gapMs })
            .rows.slice(0, options.limit)
            .map((row) => summarizeFunction(row, options.root)),
        topStacks: stackRows(burst.run, profile.gapMs, options.stacks).map((row) =>
            summarizeStack(row, options.root)
        ),
    };
}

/**
 * `summary` is a hotspot view: the busiest burst comes first. Use `bursts` for
 * time order.
 */
export function summaryReport(
    profiles: readonly CpuProfileAnalysis[],
    options: ReportOptions
): SummaryReport {
    const summaries = profiles.map((profile): SummaryProfile => {
        const bursts = [...profile.bursts]
            .sort((a, b) => b.busyMs - a.busyMs)
            .map((burst) =>
                summarizeBurst(profile, burst, {
                    limit: options.limit,
                    stacks: 0,
                    root: options.root,
                })
            );

        return {
            file: profile.file,
            durationMs: profile.durationMs,
            samples: profile.samples.length,
            activeSamples: profile.activeSamples.length,
            busyMs: profile.busyMs,
            idleMs: profile.idleMs,
            gapMs: profile.gapMs,
            minSamples: profile.minSamples,
            bursts,
        };
    });

    const blocks = summaries.map((profile) => {
        const lines = [
            `profile: ${profile.file}`,
            `duration: ${formatMs(profile.durationMs)} | samples: ${profile.samples} | ` +
                `active: ${profile.activeSamples} (${formatMs(profile.busyMs)}) | ` +
                `gaps: ${profile.samples - profile.activeSamples} (${formatMs(profile.idleMs)})`,
            `gap threshold: ${profile.gapMs} ms | bursts: ${profile.bursts.length} (>= ${profile.minSamples} samples)`,
        ];

        for (const burst of profile.bursts) {
            lines.push(`  @ ${burstLine(burst)}`);
            for (const row of burst.topSelf) lines.push(functionTextRow(row, "  "));
        }

        return lines.join("\n");
    });

    return { text: blocks.join("\n"), data: { profiles: summaries } };
}

/** `bursts` keeps time order and prints the interval between spikes. */
export function burstsReport(
    profiles: readonly CpuProfileAnalysis[],
    options: BurstsReportOptions
): BurstsReport {
    const summaries = profiles.map((profile) => {
        const bursts = profile.bursts.map((burst) => summarizeBurst(profile, burst, options));
        const starts = profile.bursts.map((burst) => burst.startMs);
        return {
            file: profile.file,
            minSamples: profile.minSamples,
            bursts,
            intervals: starts.slice(1).map((start, index) => start - (starts[index] ?? start)),
        };
    });

    const blocks = summaries.map((profile) => {
        if (profile.bursts.length === 0) {
            return [
                `profile: ${profile.file}`,
                `no bursts with >= ${profile.minSamples} active samples`,
            ].join("\n");
        }

        const lines: string[] = [];
        for (const [index, burst] of profile.bursts.entries()) {
            lines.push(`burst #${index + 1}: ${burstLine(burst)}`);
            lines.push("  top self:");
            for (const row of burst.topSelf) lines.push(functionTextRow(row, "    "));
            lines.push("  top stacks:");
            for (const row of burst.topStacks) lines.push(stackTextRow(row, "    "));
            lines.push("");
        }

        if (profile.bursts.length > 1) {
            lines.push(
                `burst intervals: ${profile.intervals
                    .map((interval) => interval.toFixed(1))
                    .join(", ")} ms`
            );
        }

        return lines.join("\n");
    });

    return { text: blocks.join("\n"), data: { profiles: summaries } };
}

export function topReport(profile: CpuProfileAnalysis, options: TopReportOptions): TopReport {
    const selected = profile.samples.filter((sample) => {
        if (options.fromMs !== undefined && sample.timeMs < options.fromMs) return false;
        if (options.toMs !== undefined && sample.timeMs > options.toMs) return false;
        return true;
    });

    const { rows, active, busyMs } = countFunctions(selected, {
        by: options.by,
        gapMs: profile.gapMs,
    });
    const visible = rows.slice(0, options.limit).map((row) => summarizeFunction(row, options.root));
    const window =
        options.fromMs === undefined && options.toMs === undefined
            ? "whole profile"
            : `${options.fromMs ?? 0}-${options.toMs ?? "end"} ms`;

    const text = [
        `profile: ${profile.file}`,
        `window: ${window} | active: ${active} samples | busy: ${formatMs(busyMs)} | by: ${options.by}`,
        ...visible.map((row) => functionTextRow(row, "  ")),
    ].join("\n");

    return {
        text,
        data: {
            profile: {
                file: profile.file,
                window: {
                    fromMs: options.fromMs ?? null,
                    toMs: options.toMs ?? null,
                },
                by: options.by,
                activeSamples: active,
                busyMs,
                rows: visible,
            },
        },
    };
}

function burstSummary(burst: Burst): BurstSummary {
    return {
        startMs: burst.startMs,
        endMs: burst.endMs,
        spanMs: burst.spanMs,
        busyMs: burst.busyMs,
        samples: burst.samples,
        topSelf: [],
        topStacks: [],
    };
}

function diffSide(profile: CpuProfileAnalysis): DiffSide {
    const burst = largestBurst(profile);
    return {
        file: profile.file,
        durationMs: profile.durationMs,
        activeSamples: profile.activeSamples.length,
        busyMs: profile.busyMs,
        bursts: profile.bursts.length,
        largestBurst: burst ? burstSummary(burst) : null,
    };
}

export function diffReport(
    before: CpuProfileAnalysis,
    after: CpuProfileAnalysis,
    options: ReportOptions
): DiffReport {
    const beforeLargest = largestBurst(before);
    const afterLargest = largestBurst(after);

    // When one side has no burst (the usual after-fix result), fall back to the
    // whole active profile instead of comparing against an empty burst.
    const beforeSamples = beforeLargest?.run ?? before.samples;
    const afterSamples = afterLargest?.run ?? after.samples;
    const beforeCounts = new Map(
        countFunctions(beforeSamples, { by: "self", gapMs: before.gapMs }).rows.map((row) => [
            functionKey(row.node),
            row,
        ])
    );
    const afterCounts = new Map(
        countFunctions(afterSamples, { by: "self", gapMs: after.gapMs }).rows.map((row) => [
            functionKey(row.node),
            row,
        ])
    );

    const keys = new Set([...beforeCounts.keys(), ...afterCounts.keys()]);
    const changes = [...keys]
        .map((key) => {
            const beforeRow = beforeCounts.get(key);
            const afterRow = afterCounts.get(key);
            const node = beforeRow?.node ?? afterRow?.node;
            if (!node) return undefined;
            return {
                node,
                before: beforeRow?.count ?? 0,
                after: afterRow?.count ?? 0,
                delta: (afterRow?.count ?? 0) - (beforeRow?.count ?? 0),
            };
        })
        .filter((row): row is NonNullable<typeof row> => row !== undefined && row.delta !== 0)
        .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || b.before - a.before)
        .slice(0, options.limit)
        .map((row): DiffChange => ({
            ...functionFrame(row.node, options.root),
            before: row.before,
            after: row.after,
            delta: row.delta,
        }));

    const bothBursts = Boolean(beforeLargest && afterLargest);
    const beforeSummary = diffSide(before);
    const afterSummary = diffSide(after);

    const lines = [
        `before: ${before.file}`,
        `after:  ${after.file}`,
        `duration: ${formatMs(before.durationMs)} -> ${formatMs(after.durationMs)} | ` +
            `active: ${before.activeSamples.length} -> ${after.activeSamples.length} | ` +
            `busy: ${formatMs(before.busyMs)} -> ${formatMs(after.busyMs)} | ` +
            `bursts: ${before.bursts.length} -> ${after.bursts.length}`,
    ];

    if (beforeLargest || afterLargest) {
        lines.push("largest burst:");
        for (const [label, burst] of [
            ["before", beforeLargest],
            ["after ", afterLargest],
        ] as const) {
            lines.push(
                burst ? `  ${label}: ${burstLine(burstSummary(burst))}` : `  ${label}: none`
            );
        }
    }

    lines.push(
        bothBursts
            ? "largest-burst self samples (after - before):"
            : "active self samples (after - before):"
    );

    if (changes.length === 0) {
        lines.push("  no difference");
    } else {
        for (const change of changes) {
            const sign = change.delta > 0 ? "+" : "";
            lines.push(
                `  ${sign}${String(change.delta).padStart(4)}  ${String(change.before).padStart(4)} -> ` +
                    `${String(change.after).padStart(4)}  ${functionLine(change)}`
            );
        }
    }

    return {
        text: lines.join("\n"),
        data: {
            before: beforeSummary,
            after: afterSummary,
            compared: bothBursts ? "burst" : "active",
            changes,
        },
    };
}
