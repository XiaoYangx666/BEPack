import type { TypecheckConfig, TypecheckCommandSetting } from "../config/configTypes.js";
import { BePackError } from "../errors/BePackError.js";

/**
 * The default checker, used when the user configures none.
 *
 * BePack has no preset table: any checker other than this one is a plain command line
 * supplied through `packs.bp.compile.typecheck.command`. That keeps the feature honest —
 * the exact command line is always visible in the config, the `--json` output and the
 * error messages, and BePack never has to guess how a third-party tool spells its flags.
 */
export const DEFAULT_TYPECHECK_COMMAND = "tsc --noEmit";

/** A fully-resolved typecheck step: the executable plus its arguments. */
export type ResolvedTypecheck = {
    /** Executable to spawn. */
    command: string;
    /** Arguments passed to the executable. */
    args: string[];
    /** Human-readable label for logs, `--json` output and suggestions. */
    label: string;
    /** True when this is the built-in default rather than a user-supplied command. */
    isDefault: boolean;
};

/**
 * Tokenize a command line with quote awareness.
 *
 * Used for the `typecheck.command` string, e.g. `'bun check'` or
 * `'node "./tools/my checker.mjs"'`. The result is spawned with an argument array, so the
 * quotes are never interpreted twice.
 *
 * Backslash escapes **only the surrounding quote character**. It is deliberately not a
 * general escape character: Windows paths are full of backslashes, and any broader rule
 * silently rewrites them (`C:\tools\check.mjs` → `C:toolscheck.mjs`).
 */
export function tokenizeCommandLine(input: string): string[] {
    const tokens: string[] = [];
    let current = "";
    let quote: '"' | "'" | undefined;
    let hasToken = false;

    for (let i = 0; i < input.length; i += 1) {
        const char = input[i]!;
        if (quote) {
            if (char === quote) {
                quote = undefined;
            } else if (char === "\\" && input[i + 1] === quote) {
                i += 1;
                current += quote;
            } else {
                current += char;
            }
            continue;
        }

        if (char === '"' || char === "'") {
            quote = char;
            hasToken = true;
            continue;
        }
        if (char === "\\" && (input[i + 1] === '"' || input[i + 1] === "'")) {
            i += 1;
            current += input[i]!;
            hasToken = true;
            continue;
        }
        if (/\s/.test(char)) {
            if (hasToken) {
                tokens.push(current);
                current = "";
                hasToken = false;
            }
            continue;
        }
        current += char;
        hasToken = true;
    }

    if (quote) {
        throw new BePackError(
            "CONFIG_INVALID",
            `Unterminated ${quote === '"' ? "double" : "single"} quote in typecheck command: ${input}`
        );
    }
    if (hasToken) tokens.push(current);
    return tokens;
}

/**
 * Resolve the checker to run.
 *
 * A user-supplied command replaces the default entirely; `args` are appended last so they
 * can extend or override it. BePack adds nothing of its own to a custom command — include
 * the tsconfig flag in `args` yourself when the tool needs one.
 */
export function resolveTypecheck(
    command: TypecheckCommandSetting | undefined,
    args: string[] = [],
    options: {
        tsconfigPath?: string;
        incremental?: boolean;
        tsBuildInfoFile?: string;
        /** Preserve the legacy `useNpx` behavior while keeping default flags. */
        useNpx?: boolean;
    } = {}
): ResolvedTypecheck {
    const configured = typeof command === "string" ? command.trim() : "";
    if (configured === "") {
        const parts = [...tokenizeCommandLine(DEFAULT_TYPECHECK_COMMAND)];
        const defaultExecutable = parts.shift()!;
        const defaultArgs = [...withDefaultCacheArgs(parts, options), ...args];
        if (options.useNpx) {
            return {
                command: "npx",
                args: [defaultExecutable, ...defaultArgs],
                label: "npx tsc --noEmit",
                isDefault: true,
            };
        }
        return {
            command: defaultExecutable,
            args: defaultArgs,
            label: DEFAULT_TYPECHECK_COMMAND,
            isDefault: true,
        };
    }

    const tokens = tokenizeCommandLine(configured);
    const executable = tokens[0];
    if (!executable) {
        throw new BePackError(
            "CONFIG_INVALID",
            `packs.bp.compile.typecheck.command must be a non-empty command line, got: ${JSON.stringify(command)}`
        );
    }
    return {
        command: executable,
        args: [...tokens.slice(1), ...args],
        label: configured,
        isDefault: false,
    };
}

/**
 * The default `tsc` runs honor `compile.tsconfig` and the build/dev incremental cache.
 * A custom command opts out of both: it owns its own arguments.
 */
function withDefaultCacheArgs(
    args: string[],
    options: { tsconfigPath?: string; incremental?: boolean; tsBuildInfoFile?: string }
): string[] {
    const parts = [...args];
    if (options.tsconfigPath) parts.push("--project", options.tsconfigPath);
    if (options.incremental && options.tsBuildInfoFile) {
        parts.push("--incremental", "--tsBuildInfoFile", options.tsBuildInfoFile);
    }
    return parts;
}

/** Render the command line for logs, `--json` output and error details. */
export function formatTypecheckCommand(typecheck: { command: string; args: string[] }): string {
    return [typecheck.command, ...typecheck.args]
        .map((part) => (/\s/.test(part) ? JSON.stringify(part) : part))
        .join(" ");
}

/**
 * Normalize the hybrid `compile.typecheck` setting.
 *
 * The normalized config always stores a plain boolean for the enable switch plus the
 * resolved command/args, so commands can read them without re-implementing the shapes.
 */
export function normalizeTypecheckSetting(
    value: boolean | TypecheckConfig | undefined,
    fallback: { typecheck: boolean; typecheckCommand?: string; typecheckArgs?: string[] }
): { typecheck: boolean; typecheckCommand?: string; typecheckArgs: string[] } {
    if (value === undefined || typeof value === "boolean") {
        return {
            typecheck: value ?? fallback.typecheck,
            ...(fallback.typecheckCommand === undefined
                ? {}
                : { typecheckCommand: fallback.typecheckCommand }),
            typecheckArgs: fallback.typecheckArgs ?? [],
        };
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new BePackError(
            "CONFIG_INVALID",
            "packs.bp.compile.typecheck must be a boolean or an object " +
                `{ enabled?, command?, args? }, got: ${describe(value)}.`
        );
    }

    rejectLegacyKeys(value);

    const { enabled, command, args } = value;
    if (enabled !== undefined && typeof enabled !== "boolean") {
        throw new BePackError(
            "CONFIG_INVALID",
            `packs.bp.compile.typecheck.enabled must be a boolean, got: ${describe(enabled)}.`
        );
    }
    if (command !== undefined && typeof command !== "string") {
        throw new BePackError(
            "CONFIG_INVALID",
            `packs.bp.compile.typecheck.command must be a string, got: ${describe(command)}.`
        );
    }
    if (typeof command === "string" && command.trim() === "") {
        throw new BePackError(
            "CONFIG_INVALID",
            `packs.bp.compile.typecheck.command must be a non-empty command line, got: ${describe(command)}.`
        );
    }
    const normalizedArgs = normalizeTypecheckArgs(args, "packs.bp.compile.typecheck.args");

    return {
        typecheck: enabled ?? fallback.typecheck,
        ...(command !== undefined
            ? { typecheckCommand: command }
            : fallback.typecheckCommand === undefined
              ? {}
              : { typecheckCommand: fallback.typecheckCommand }),
        typecheckArgs: normalizedArgs ?? fallback.typecheckArgs ?? [],
    };
}

/** Normalize a string array config value, rejecting non-strings. */
export function normalizeTypecheckArgs(value: unknown, key: string): string[] | undefined {
    if (value === undefined) return undefined;
    if (!Array.isArray(value)) {
        throw new BePackError(
            "CONFIG_INVALID",
            `${key} must be an array of strings, got: ${describe(value)}.`
        );
    }
    return value.map((entry) => {
        if (typeof entry !== "string") {
            throw new BePackError(
                "CONFIG_INVALID",
                `${key} entries must be strings, got: ${describe(entry)}.`
            );
        }
        return entry;
    });
}

/** Normalize a single command-line config value. */
export function normalizeTypecheckCommand(value: unknown, key: string): string | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== "string" || value.trim() === "") {
        throw new BePackError(
            "CONFIG_INVALID",
            `${key} must be a non-empty command line string, got: ${describe(value)}.`
        );
    }
    return value.trim();
}

/** Point users at the replacement instead of silently ignoring a config they wrote. */
function rejectLegacyKeys(value: TypecheckConfig): void {
    const record = value as Record<string, unknown>;
    if (record.typechecker !== undefined) {
        throw new BePackError(
            "CONFIG_INVALID",
            "packs.bp.compile.typecheck.typechecker was replaced by " +
                "packs.bp.compile.typecheck.command: write the full command line instead, " +
                `e.g. { command: "bun check" }, got: ${describe(record.typechecker)}.`
        );
    }
}

/** Describe a rejected config value in an error message. */
export function describe(value: unknown): string {
    if (value === null) return "null";
    if (Array.isArray(value)) return "array";
    if (typeof value === "object") return "object";
    if (typeof value === "string") return JSON.stringify(value);
    return String(value);
}
