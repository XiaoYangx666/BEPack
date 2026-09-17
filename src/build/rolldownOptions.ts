import path from "node:path";
import { loadConfig } from "rolldown/config";
import type { OutputOptions, RolldownOptions } from "rolldown";
import type {
    ResolvedConfig,
    RolldownCustomizeContext,
    RolldownCustomizeFunction,
    RolldownOverrides,
} from "../config/configTypes.js";
import { BePackError } from "../errors/BePackError.js";
import { pathExists } from "../utils/fs.js";
import { projectRoot, scriptOutDir, scriptOutFile, srcEntry } from "../utils/path.js";
import { createDependencyCatalog } from "../install/dependencyCatalog.js";
import { createReplacePlugins } from "./replace.js";
import { createDefineTransform } from "./define.js";

type OptionsRecord = Record<string, unknown>;

type ResolvedBpCompile = NonNullable<NonNullable<ResolvedConfig["packs"]["bp"]>["compile"]>;

/** Array options that are appended to the BePack value instead of replacing it. */
const CONCAT_ARRAY_KEYS = new Set(["plugins"]);

/** Array options that are unioned with the BePack value (strings are deduplicated). */
const UNION_ARRAY_KEYS = new Set(["external"]);

/** Object options merged one level deep instead of being replaced. */
const DEEP_MERGE_KEYS = new Set([
    "output",
    "resolve",
    "transform",
    "experimental",
    "checks",
    "optimization",
    "watch",
    "moduleTypes",
]);

/**
 * Output fields owned by BePack. Users may not repoint them, because the manifest
 * script entry, `copy`, `pack` and the dev watcher all depend on the exact location.
 */
const MANAGED_OUTPUT_KEYS: { key: string; suggestion: string }[] = [
    {
        key: "file",
        suggestion: "The output file is derived from packs.bp.compile.entry and scriptOutputDir.",
    },
    {
        key: "dir",
        suggestion: "The output directory is derived from packs.bp.compile.scriptOutputDir.",
    },
    {
        key: "format",
        suggestion:
            'Minecraft Script API modules must be ESM, so BePack always writes format: "esm".',
    },
    {
        key: "preserveModules",
        suggestion: "Use packs.bp.compile.preserveModules instead.",
    },
    {
        key: "preserveModulesRoot",
        suggestion: "The modules root is always the entry file directory.",
    },
    {
        key: "entryFileNames",
        suggestion: "Manifest script entries assume one `.js` file per source module.",
    },
];

function isPlainObject(value: unknown): value is OptionsRecord {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toArray(value: unknown): unknown[] {
    if (value === undefined || value === null || value === false) return [];
    return Array.isArray(value) ? value : [value];
}

function sameResolvedPath(a: string, b: string): boolean {
    if (process.platform === "win32") return a.toLowerCase() === b.toLowerCase();
    return a === b;
}

function samePathValue(value: unknown, expected: unknown, root: string): boolean {
    if (typeof value !== "string" || typeof expected !== "string") return false;
    return sameResolvedPath(path.resolve(root, value), path.resolve(root, expected));
}

function errorMessage(cause: unknown): string {
    if (cause instanceof Error) {
        const inner = (cause as { cause?: unknown }).cause;
        if (inner instanceof Error && inner.message) return inner.message;
        return cause.message;
    }
    return String(cause);
}

function unionExternal(current: unknown, override: unknown): unknown {
    // A function external option cannot be merged — the user's value wins.
    if (typeof current === "function" || typeof override === "function") return override;

    const result: (string | RegExp)[] = [];
    const seenStrings = new Set<string>();
    const seenRegexps = new Set<string>();

    for (const item of [...toArray(current), ...toArray(override)]) {
        if (typeof item === "string") {
            if (seenStrings.has(item)) continue;
            seenStrings.add(item);
            result.push(item);
        } else if (item instanceof RegExp) {
            const key = `${item.source}/${item.flags}`;
            if (seenRegexps.has(key)) continue;
            seenRegexps.add(key);
            result.push(item);
        }
    }

    return result;
}

function mergeTransform(current: unknown, override: unknown): unknown {
    if (!isPlainObject(override)) return override;
    const base = isPlainObject(current) ? current : {};
    const merged: OptionsRecord = { ...base, ...override };

    // `transform.define` maps are merged key by key so custom defines extend
    // `packs.bp.compile.define` instead of silently replacing it.
    const baseDefine = isPlainObject(base["define"]) ? base["define"] : {};
    if (isPlainObject(override["define"])) {
        merged["define"] = { ...baseDefine, ...override["define"] };
    }
    return merged;
}

/**
 * Merge user-supplied rolldown options on top of the BePack-generated ones.
 *
 * - `plugins` are appended after the BePack plugins.
 * - `external` is unioned (strings deduplicated, `RegExp` kept as-is).
 * - `transform` / `resolve` / `experimental` / `checks` / `optimization` / `watch` /
 *   `moduleTypes` / `output` are merged one level deep, and `transform.define` maps are
 *   merged key by key.
 * - Every other field is replaced by the user value.
 */
export function mergeRolldownOptions(
    base: RolldownOptions,
    override: RolldownOptions | undefined
): RolldownOptions {
    if (!override) return { ...(base as OptionsRecord) } as RolldownOptions;

    const merged: OptionsRecord = { ...(base as OptionsRecord) };
    for (const [key, value] of Object.entries(override as OptionsRecord)) {
        if (value === undefined) continue;
        const current = merged[key];

        if (CONCAT_ARRAY_KEYS.has(key)) {
            merged[key] = [...toArray(current), ...toArray(value)];
        } else if (UNION_ARRAY_KEYS.has(key)) {
            merged[key] = unionExternal(current, value);
        } else if (key === "transform") {
            merged[key] = mergeTransform(current, value);
        } else if (DEEP_MERGE_KEYS.has(key) && isPlainObject(current) && isPlainObject(value)) {
            merged[key] = { ...current, ...value };
        } else {
            merged[key] = value;
        }
    }
    return merged as RolldownOptions;
}

/** Build the managed external list: user-declared externals plus manifest dependencies. */
export function buildExternal(config: ResolvedConfig): (string | RegExp)[] {
    if (!config.packs.bp?.compile) return [];
    const external = [...config.packs.bp.compile.external];
    const existingStrings = new Set(
        external.filter((item): item is string => typeof item === "string")
    );
    for (const [packageName, entry] of Object.entries(createDependencyCatalog(config))) {
        if (entry.manifest && !existingStrings.has(packageName)) {
            external.push(packageName);
            existingStrings.add(packageName);
        }
    }
    return external;
}

function requireCompile(config: ResolvedConfig): ResolvedBpCompile {
    const compile = config.packs.bp?.compile;
    if (!compile) {
        throw new BePackError(
            "BUILD_FAILED",
            "rolldown requires packs.bp.compile to be configured."
        );
    }
    return compile;
}

/** BePack-generated input options — the base every customization is merged onto. */
export function createBaseInputOptions(cwd: string, config: ResolvedConfig): RolldownOptions {
    const compile = requireCompile(config);
    const entry = srcEntry(cwd, config);
    if (!entry) {
        throw new BePackError("BUILD_FAILED", "packs.bp.compile.entry could not be resolved.");
    }

    return {
        input: entry,
        external: buildExternal(config),
        plugins: createReplacePlugins(config),
        ...(createDefineTransform(compile.define) ?? {}),
        onwarn(warning, warn) {
            if (warning.code === "CIRCULAR_DEPENDENCY") return;
            warn(warning);
        },
        experimental: {
            attachDebugInfo: compile.preserveModules ? "none" : "simple",
        },
    };
}

/** BePack-generated output options. */
export function createBaseOutputOptions(cwd: string, config: ResolvedConfig): OutputOptions {
    const compile = requireCompile(config);
    const entry = srcEntry(cwd, config);
    const outDir = scriptOutDir(cwd, config);
    const outFile = scriptOutFile(cwd, config);
    if (!entry || !outDir || !outFile) {
        throw new BePackError(
            "BUILD_FAILED",
            "rolldown requires a valid compile entry and output directory."
        );
    }

    return compile.preserveModules
        ? {
              dir: outDir,
              format: "esm",
              preserveModules: true,
              preserveModulesRoot: path.dirname(entry),
              entryFileNames: "[name].js",
              minify: compile.minify,
          }
        : {
              file: outFile,
              format: "esm",
              minify: compile.minify,
          };
}

/** Normalize a rolldown `input` value into sorted absolute paths for comparison. */
function normalizeInputPaths(value: unknown, root: string): string[] | undefined {
    if (typeof value === "string") return [path.resolve(root, value)];
    if (Array.isArray(value)) {
        if (!value.every((item) => typeof item === "string")) return undefined;
        return (value as string[]).map((item) => path.resolve(root, item)).sort();
    }
    if (isPlainObject(value)) {
        const values = Object.values(value);
        if (!values.every((item) => typeof item === "string")) return undefined;
        return (values as string[]).map((item) => path.resolve(root, item)).sort();
    }
    return undefined;
}

function assertManagedInputOptions(
    override: RolldownOptions,
    base: RolldownOptions,
    root: string
): void {
    if (override.input === undefined) return;

    const actual = normalizeInputPaths(override.input, root);
    const expected = normalizeInputPaths(base.input, root);
    const matches =
        actual !== undefined &&
        expected !== undefined &&
        actual.length === expected.length &&
        actual.every((item, index) => sameResolvedPath(item, expected[index]!));

    if (!matches) {
        throw new BePackError(
            "CONFIG_INVALID",
            'packs.bp.compile.rolldown cannot override "input" — the bundle entry is managed by BePack.',
            {
                details: { input: override.input, expected: base.input },
                suggestions: ["Set the entry file via packs.bp.compile.entry instead."],
            }
        );
    }
}

function assertManagedOutputOptions(
    output: OutputOptions,
    base: OutputOptions,
    root: string
): void {
    for (const { key, suggestion } of MANAGED_OUTPUT_KEYS) {
        const value = (output as OptionsRecord)[key];
        if (value === undefined) continue;

        const expected = (base as OptionsRecord)[key];
        const isPathKey = key === "file" || key === "dir" || key === "preserveModulesRoot";
        const matches = isPathKey
            ? samePathValue(value, expected, root)
            : Object.is(value, expected) ||
              (key === "preserveModules" && expected === undefined && value === false);

        if (!matches) {
            throw new BePackError(
                "CONFIG_INVALID",
                `packs.bp.compile.rolldown cannot override "output.${key}" — it is managed by BePack.`,
                {
                    details: { key, value, expected },
                    suggestions: [suggestion],
                }
            );
        }
    }
}

/** Validate the default export of a rolldown config file. */
function resolveConfigFileExport(exported: unknown, file: string): RolldownOverrides {
    // CommonJS interop: rolldown's loader may hand back the module object itself.
    if (isPlainObject(exported) && exported["__esModule"] === true && "default" in exported) {
        return resolveConfigFileExport(exported["default"], file);
    }

    if (typeof exported === "function") return exported as RolldownCustomizeFunction;

    if (Array.isArray(exported)) {
        if (exported.length === 0) {
            throw new BePackError(
                "CONFIG_INVALID",
                `rolldown config file exports an empty array: ${file}`,
                { details: { file }, suggestions: ["Export a single rolldown options object."] }
            );
        }
        if (exported.length > 1) {
            throw new BePackError(
                "CONFIG_INVALID",
                `rolldown config file exports ${exported.length} configs, but BePack builds a single behavior pack per run: ${file}`,
                {
                    details: { file, count: exported.length },
                    suggestions: ["Export a single rolldown options object."],
                }
            );
        }
        if (!isPlainObject(exported[0])) {
            throw new BePackError(
                "CONFIG_INVALID",
                `rolldown config file must export an options object or function: ${file}`
            );
        }
        return exported[0] as RolldownOptions;
    }

    if (isPlainObject(exported)) return exported as RolldownOptions;

    throw new BePackError(
        "CONFIG_INVALID",
        "rolldown config file must default-export a rolldown options object, a function, " +
            `or a single-element array: ${file}`
    );
}

/** Load a rolldown config file with rolldown's own loader (supports `.ts` and friends). */
export async function loadRolldownConfigFile(resolvedPath: string): Promise<RolldownOverrides> {
    if (!(await pathExists(resolvedPath))) {
        throw new BePackError("CONFIG_INVALID", `rolldown config file not found: ${resolvedPath}`, {
            details: { path: resolvedPath },
            suggestions: [
                "Check the path in packs.bp.compile.rolldownConfig or --rolldown-config.",
            ],
        });
    }

    let exported: unknown;
    try {
        exported = await loadConfig(resolvedPath);
    } catch (cause) {
        throw new BePackError(
            "CONFIG_INVALID",
            `Failed to load rolldown config file "${resolvedPath}": ${errorMessage(cause)}`
        );
    }

    return resolveConfigFileExport(exported, resolvedPath);
}

async function applyCustomizeFunction(
    fn: RolldownCustomizeFunction,
    options: RolldownOptions,
    context: RolldownCustomizeContext
): Promise<RolldownOptions> {
    let result: RolldownOptions | undefined | void;
    try {
        result = await fn(options, context);
    } catch (cause) {
        throw new BePackError(
            "BUILD_FAILED",
            `compile.rolldown customization function failed: ${errorMessage(cause)}`
        );
    }

    if (result === undefined || result === null) return options;
    if (!isPlainObject(result)) {
        throw new BePackError(
            "CONFIG_INVALID",
            "compile.rolldown customization function must return a rolldown options object (or nothing)."
        );
    }
    return mergeRolldownOptions(options, result as RolldownOptions);
}

export type ResolveRolldownOptionsInput = {
    cwd: string;
    config: ResolvedConfig;
    /** Command running the build, exposed to customization functions. */
    command?: "build" | "dev";
    /** CLI `--mode` value, exposed to customization functions. */
    mode?: string;
    /** CLI `--rolldown-config` path, overriding `packs.bp.compile.rolldownConfig`. */
    configPath?: string;
};

/**
 * Resolve the final rolldown input/output options for a BP build.
 *
 * Order of application (later wins):
 *   1. options generated by BePack
 *   2. inline `packs.bp.compile.rolldown` (when it is an object)
 *   3. the config file export (when it is an object)
 *   4. the inline function, then the config file function — each receives the options
 *      merged so far and its return value is merged on top
 *
 * `input` and the output location fields are validated afterwards and rejected when a
 * customization tries to move them.
 */
export async function resolveRolldownOptions(
    input: ResolveRolldownOptionsInput
): Promise<{ inputOptions: RolldownOptions; outputOptions: OutputOptions }> {
    const { cwd, config } = input;
    const compile = requireCompile(config);
    const root = projectRoot(cwd, config);

    const entry = srcEntry(cwd, config);
    const outDir = scriptOutDir(cwd, config);
    const outFile = scriptOutFile(cwd, config);
    if (!entry || !outDir || !outFile) {
        throw new BePackError(
            "BUILD_FAILED",
            "rolldown requires a valid compile entry and output directory."
        );
    }

    const baseInputOptions = createBaseInputOptions(cwd, config);
    const baseOutputOptions = createBaseOutputOptions(cwd, config);

    const context: RolldownCustomizeContext = {
        command: input.command ?? "build",
        ...(input.mode !== undefined ? { mode: input.mode } : {}),
        target: config.target,
        entry,
        outDir,
        outFile,
        preserveModules: compile.preserveModules,
    };

    const inline = compile.rolldown;
    const configPath = input.configPath ?? compile.rolldownConfig;
    const fileOverrides = configPath
        ? await loadRolldownConfigFile(path.resolve(root, configPath))
        : undefined;

    let merged = mergeRolldownOptions(
        baseInputOptions,
        typeof inline === "function" ? undefined : inline
    );
    merged = mergeRolldownOptions(
        merged,
        typeof fileOverrides === "function" ? undefined : fileOverrides
    );

    if (typeof inline === "function") {
        merged = await applyCustomizeFunction(inline, merged, context);
    }
    if (typeof fileOverrides === "function") {
        merged = await applyCustomizeFunction(fileOverrides, merged, context);
    }

    const { output: rawOutput, input: rawInput, ...rest } = merged;

    if (Array.isArray(rawOutput)) {
        throw new BePackError(
            "CONFIG_INVALID",
            "packs.bp.compile.rolldown cannot declare multiple outputs (an `output` array) — " +
                "BePack writes exactly one output.",
            { suggestions: ["Declare a single `output` object."] }
        );
    }
    if (rawOutput !== undefined && !isPlainObject(rawOutput)) {
        throw new BePackError(
            "CONFIG_INVALID",
            "packs.bp.compile.rolldown `output` must be an object.",
            {
                details: { output: rawOutput },
            }
        );
    }

    assertManagedInputOptions({ input: rawInput } as RolldownOptions, baseInputOptions, root);

    const outputOptions = mergeRolldownOptions(
        baseOutputOptions as RolldownOptions,
        rawOutput as RolldownOptions | undefined
    ) as OutputOptions;
    assertManagedOutputOptions(outputOptions, baseOutputOptions, root);

    return {
        inputOptions: { ...rest, input: baseInputOptions.input } as RolldownOptions,
        outputOptions,
    };
}
