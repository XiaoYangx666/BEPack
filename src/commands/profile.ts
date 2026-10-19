import path from "node:path";
import { loadCpuProfile, DEFAULT_GAP_MS, DEFAULT_MIN_BURST_SAMPLES } from "../profile/analyze.js";
import {
    burstsReport,
    diffReport,
    summaryReport,
    topReport,
    type ReportOptions,
} from "../profile/report.js";
import type { SortBy } from "../profile/types.js";
import { BePackError } from "../errors/BePackError.js";
import { Logger } from "../logger/logger.js";

const MODES = ["summary", "bursts", "top", "diff"] as const;
type ProfileMode = (typeof MODES)[number];

const DEFAULT_LIMIT = 15;
const DEFAULT_STACKS = 5;

function argumentError(message: string, suggestions: string[] = []): never {
    throw new BePackError("CLI_ARGUMENT_INVALID", message, {
        ...(suggestions.length === 0 ? {} : { suggestions }),
    });
}

function numberOption(
    value: unknown,
    name: string,
    fallback: number,
    options: { min: number; integer?: boolean }
): number {
    if (value === undefined) return fallback;
    const number = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(number) || number < options.min) {
        argumentError(
            `--${name} must be a number >= ${options.min}, got ${JSON.stringify(value)}.`
        );
    }
    if (options.integer && !Number.isInteger(number)) {
        argumentError(`--${name} must be an integer, got ${JSON.stringify(value)}.`);
    }
    return number;
}

function optionalNumberOption(value: unknown, name: string): number | undefined {
    if (value === undefined) return undefined;
    const number = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(number)) {
        argumentError(`--${name} must be a number, got ${JSON.stringify(value)}.`);
    }
    return number;
}

function modeOf(value: string | undefined): ProfileMode {
    if (value && (MODES as readonly string[]).includes(value)) return value as ProfileMode;
    argumentError(
        `Unknown profile command: ${value ?? "(none)"}. Expected one of ${MODES.join(", ")}.`,
        ["Run `bepack profile --help` to see available commands."]
    );
}

export async function commandProfile(
    command: string | undefined,
    profiles: readonly string[],
    options: any
) {
    const mode = modeOf(command);
    const expected = mode === "diff" ? 2 : 1;
    if (profiles.length !== expected) {
        argumentError(
            `${mode} expects ${expected} profile file${expected === 1 ? "" : "s"}, got ${profiles.length}.`,
            [
                mode === "diff"
                    ? "Usage: bepack profile diff <before> <after>"
                    : `Usage: bepack profile ${mode} <profile>`,
            ]
        );
    }

    const gapMs = numberOption(options.gap, "gap", DEFAULT_GAP_MS, { min: 0 });
    const minSamples = numberOption(options.minSamples, "min-samples", DEFAULT_MIN_BURST_SAMPLES, {
        min: 1,
        integer: true,
    });
    const limit = numberOption(options.limit ?? options.n, "limit", DEFAULT_LIMIT, {
        min: 0,
        integer: true,
    });
    const stacks = numberOption(options.stacks, "stacks", DEFAULT_STACKS, {
        min: 0,
        integer: true,
    });
    const fromMs = optionalNumberOption(options.from, "from");
    const toMs = optionalNumberOption(options.to, "to");

    const by = (options.by ?? "self") as SortBy;
    if (by !== "self" && by !== "total") {
        argumentError(`--by must be self or total, got ${JSON.stringify(options.by)}.`);
    }

    const cwd = path.resolve(typeof options.cwd === "string" ? options.cwd : process.cwd());
    const root = path.resolve(cwd, typeof options.root === "string" ? options.root : ".");
    const logger = new Logger({ silent: options.silent || options.json, verbose: options.verbose });

    const files = profiles.map((file) => path.resolve(cwd, file));
    const loaded = await Promise.all(
        files.map((file) => loadCpuProfile(file, { gapMs, minSamples }))
    );

    const reportOptions: ReportOptions = { limit, root };
    if (mode === "summary") {
        const report = summaryReport(loaded, reportOptions);
        if (!options.json) logger.info(report.text);
        return { ok: true, command: "profile", mode, ...report.data };
    }

    if (mode === "bursts") {
        const report = burstsReport(loaded, { ...reportOptions, stacks });
        if (!options.json) logger.info(report.text);
        return { ok: true, command: "profile", mode, ...report.data };
    }

    const profile = loaded[0];
    if (!profile) argumentError("top expects one profile file.");

    if (mode === "top") {
        const report = topReport(profile, {
            ...reportOptions,
            by,
            ...(fromMs === undefined ? {} : { fromMs }),
            ...(toMs === undefined ? {} : { toMs }),
        });
        if (!options.json) logger.info(report.text);
        return { ok: true, command: "profile", mode, ...report.data };
    }

    const after = loaded[1];
    if (!after) argumentError("diff expects two profile files.");

    const report = diffReport(profile, after, reportOptions);
    if (!options.json) logger.info(report.text);
    return { ok: true, command: "profile", mode, ...report.data };
}
