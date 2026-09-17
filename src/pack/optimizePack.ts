import { BePackError } from "../errors/BePackError.js";
import type { PackOptimizeResolved } from "../config/configTypes.js";
import { BRARCHIVE_EXTENSION, serializeBrarchive, type BrarchiveEntry } from "./brarchive.js";
import { sortedFiles } from "./fileMap.js";
import type { FileMap, FilesTransform } from "./fileMap.js";

/**
 * Pack optimization: bundle a pack's loose files into `__brarchive/` archives, the
 * way Minecraft's own pack optimizer does (Bedrock 1.26.40+).
 *
 * Layout rules (verified against a real 1.26.40 client):
 * - every directory (recursively) becomes `<pack>/__brarchive/<relative-dir>.brarchive`
 *   holding that directory's own files;
 * - pack-root files such as `manifest.json` stay loose;
 * - the path-addressed folders listed in {@link DEFAULT_KEEP_LOOSE_BP} /
 *   {@link DEFAULT_KEEP_LOOSE_RP} keep their real files loose, because the engine resolves
 *   those by path on disk; their archive holds only 0-byte name stubs. `scripts` is **not**
 *   one of them — Mojang ships it archived (see `behavior_packs/editor`), so do not add it
 *   to that list;
 * - the packaged `manifest.json` gets `header.pack_optimization_version: "0.1.0"`, which
 *   is what makes the engine read registries (`blocks/`, `items/`, `entities/`, ...)
 *   from `__brarchive/`;
 * - JSON entries are minified, other entries are stored verbatim. Entries that cannot be
 *   decoded or parsed are stored byte-for-byte and reported via `OptimizeLogger.warn`.
 */

/** Folder inside a pack root that holds the generated archives. */
export const BRARCHIVE_DIR = "__brarchive";

/**
 * Default `header.pack_optimization_version` value. Game-version values such as
 * `"1.26.40"` are ignored by the engine — only the optimizer format version works.
 */
export const DEFAULT_PACK_OPTIMIZATION_VERSION = "0.1.0";

/**
 * Directories that keep a loose copy next to their archive, per pack type.
 *
 * Mirrors Minecraft's own packs: the client resolves these by path at runtime
 * (loot tables and structures are referenced from content, textures/sounds/font/
 * materials/texts are referenced by path in other JSON), so the loose files are kept
 * even though an archive exists. `functions` is added by BePack because in-game tests
 * showed `/function` failing when the only copy lived in `__brarchive/`.
 */
export const DEFAULT_KEEP_LOOSE_BP: string[] = ["functions", "loot_tables", "structures", "texts"];

/** Resource-pack counterpart of {@link DEFAULT_KEEP_LOOSE_BP}. */
export const DEFAULT_KEEP_LOOSE_RP: string[] = ["font", "materials", "sounds", "texts", "textures"];

/** Client version that introduced `__brarchive/` support. */
export const MIN_OPTIMIZED_ENGINE_VERSION = [1, 26, 40] as const;

/** Human-readable form of {@link MIN_OPTIMIZED_ENGINE_VERSION}. */
export const MIN_OPTIMIZED_ENGINE_VERSION_STRING = MIN_OPTIMIZED_ENGINE_VERSION.join(".");

/** Minimal logger surface used while optimizing. */
export type OptimizeLogger = {
    pack(message: string): void;
    warn(message: string): void;
};

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const utf16leDecoder = new TextDecoder("utf-16le");
const utf16beDecoder = new TextDecoder("utf-16be");

/**
 * Decode JSON-ish bytes to text.
 *
 * Hand-edited Bedrock files are occasionally UTF-16 despite the ecosystem convention
 * being UTF-8, so honour a BOM when one is present instead of decoding garbage. Without
 * a BOM we assume UTF-8 — a heuristic, not a guarantee, which is why callers must treat
 * a failed `JSON.parse` as "leave it alone" rather than "corrupt it".
 */
function decodeText(data: Uint8Array): string {
    if (data.length >= 2) {
        if (data[0] === 0xff && data[1] === 0xfe) return utf16leDecoder.decode(data.subarray(2));
        if (data[0] === 0xfe && data[1] === 0xff) return utf16beDecoder.decode(data.subarray(2));
    }
    // UTF-8 BOM (EF BB BF) also decodes to U+FEFF, which stripBom then removes.
    return textDecoder.decode(data);
}

/** True when the bytes start with a UTF-16 BOM. */
export function hasUtf16Bom(data: Uint8Array): boolean {
    return (
        data.length >= 2 &&
        ((data[0] === 0xff && data[1] === 0xfe) || (data[0] === 0xfe && data[1] === 0xff))
    );
}

function stripBom(text: string): string {
    return text.startsWith("\uFEFF") ? text.slice(1) : text;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    return value as Record<string, unknown>;
}

function parseVersion(value: unknown): [number, number, number] | undefined {
    if (typeof value === "string") {
        const parts = value.split(".").map((part) => Number.parseInt(part, 10));
        if (parts.length >= 3 && parts.slice(0, 3).every((part) => Number.isInteger(part))) {
            return [parts[0]!, parts[1]!, parts[2]!];
        }
        return undefined;
    }
    if (Array.isArray(value) && value.length >= 3) {
        const parts = value.slice(0, 3);
        if (parts.every((part) => typeof part === "number" && Number.isInteger(part))) {
            return parts as [number, number, number];
        }
    }
    return undefined;
}

function compareVersion(a: readonly number[], b: readonly number[]): number {
    for (let index = 0; index < 3; index++) {
        const diff = (a[index] ?? 0) - (b[index] ?? 0);
        if (diff !== 0) return diff;
    }
    return 0;
}

function readManifest(files: FileMap): Record<string, unknown> | undefined {
    return readManifestBytes(files["manifest.json"]);
}

function readManifestBytes(raw: Uint8Array | undefined): Record<string, unknown> | undefined {
    if (!raw) return undefined;
    try {
        return asRecord(JSON.parse(stripBom(decodeText(raw))));
    } catch {
        return undefined;
    }
}

function minEngineVersionOf(
    manifest: Record<string, unknown> | undefined
): [number, number, number] | undefined {
    const header = asRecord(manifest?.["header"]);
    return parseVersion(header?.["min_engine_version"]);
}

/** Resource packs declare a `resources` module; everything else is a behavior pack. */
function isResourcePack(manifest: Record<string, unknown> | undefined): boolean {
    const modules = manifest?.["modules"];
    if (!Array.isArray(modules)) return false;
    return modules.some((module) => asRecord(module)?.["type"] === "resources");
}

/**
 * The engine reads `__brarchive/` regardless of `header.min_engine_version` (verified
 * in-game), but clients older than 1.26.40 have no archive support at all and would
 * show missing content. Warn instead of failing.
 */
function warnIfEngineTooOld(
    manifest: Record<string, unknown> | undefined,
    options: PackOptimizeResolved,
    logger?: OptimizeLogger
): void {
    if (options.allowUnsupportedTarget) return;

    const minEngineVersion = minEngineVersionOf(manifest);
    if (minEngineVersion && compareVersion(minEngineVersion, MIN_OPTIMIZED_ENGINE_VERSION) >= 0) {
        return;
    }

    const found = minEngineVersion ? minEngineVersion.join(".") : "(not declared)";
    logger?.warn(
        `pack optimization: header.min_engine_version is ${found}, below ${MIN_OPTIMIZED_ENGINE_VERSION_STRING}. ` +
            "The archives still load on 1.26.40+, but older clients cannot read __brarchive/ " +
            "and will show missing content. Set allowUnsupportedTarget: true to silence this warning."
    );
}

/**
 * Minify one archive entry, or return it untouched.
 *
 * Anything that is not a `.json` entry, or that cannot be decoded and parsed as JSON, is
 * passed through byte-for-byte. Those misses are reported to `logger.warn` rather than
 * swallowed: a `minifyJson: true` run that quietly skipped a file is indistinguishable
 * from one that minified it, which makes a bad source file very hard to notice.
 */
function minifyJson(entryName: string, data: Uint8Array, logger?: OptimizeLogger): Uint8Array {
    if (!entryName.toLowerCase().endsWith(".json")) return data;
    try {
        const parsed: unknown = JSON.parse(stripBom(decodeText(data)));
        return textEncoder.encode(JSON.stringify(parsed));
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        const encoding = hasUtf16Bom(data) ? " (UTF-16)" : "";
        logger?.warn(
            `pack optimization: could not minify ${entryName}${encoding}, storing it unchanged. ` +
                `${reason}. Fix the JSON to have it minified.`
        );
        return data;
    }
}

/** Write `header.pack_optimization_version` into the archived pack's manifest. */
function withPackOptimizationVersion(raw: Uint8Array | undefined, version: string): Uint8Array {
    if (!raw) {
        throw new BePackError(
            "PACK_FAILED",
            "Pack optimization needs a manifest.json to write header.pack_optimization_version into."
        );
    }

    let manifest: Record<string, unknown>;
    try {
        const parsed = asRecord(JSON.parse(stripBom(decodeText(raw))));
        if (!parsed) throw new Error("manifest is not an object");
        manifest = parsed;
    } catch {
        throw new BePackError(
            "PACK_FAILED",
            "Cannot write header.pack_optimization_version: the pack's manifest.json is not valid JSON."
        );
    }

    const header = { ...(asRecord(manifest["header"]) ?? {}) };
    header["pack_optimization_version"] = version;
    manifest["header"] = header;
    return textEncoder.encode(JSON.stringify(manifest));
}

/**
 * Replace loose files with `__brarchive/` archives.
 *
 * Input and output keys are pack-relative POSIX paths, so the same transform works
 * for `.mcpack`, for each pack inside a `.mcaddon`, and for copied dev folders.
 *
 * `fallbackManifest` supplies the pack's `manifest.json` bytes when the collected files
 * do not contain one (a selective `packs.*.include` list may omit it). It is used for the
 * engine-version warning and for writing `header.pack_optimization_version`.
 */
export function optimizePackFiles(
    files: FileMap,
    options: PackOptimizeResolved,
    logger?: OptimizeLogger,
    fallbackManifest?: Uint8Array
): FileMap {
    const manifestSource = files["manifest.json"] ?? fallbackManifest;
    const manifest = readManifestBytes(manifestSource);
    warnIfEngineTooOld(manifest, options, logger);

    const exclude = new Set(options.exclude);
    const keepLoose =
        options.keepLoose === false
            ? new Set<string>()
            : new Set([
                  ...(isResourcePack(manifest) ? DEFAULT_KEEP_LOOSE_RP : DEFAULT_KEEP_LOOSE_BP),
                  ...options.keepLoose,
              ]);

    const archives = new Map<string, BrarchiveEntry[]>();
    const loose: FileMap = {};
    const duplicated: FileMap = {};
    let archivedCount = 0;
    let stubCount = 0;

    for (const name of Object.keys(files).sort()) {
        const data = files[name]!;
        const segments = name.split("/");
        const top = segments[0]!;

        // Root files, already-archived content and excluded folders stay as they are.
        if (segments.length < 2 || top === BRARCHIVE_DIR || exclude.has(top)) {
            loose[name] = data;
            continue;
        }

        const dir = segments.slice(0, -1).join("/");
        const entryName = segments[segments.length - 1]!;
        const entries = archives.get(dir) ?? [];

        // Path-addressed folders: register the name in the archive and keep the real
        // file loose, the way Mojang stores structures/, sounds/ and texts/.
        const keepFileLoose = options.keepLooseFiles || keepLoose.has(top);

        if (keepLoose.has(top) && !options.keepLooseFiles) {
            entries.push({ name: entryName, data: new Uint8Array(0) });
            duplicated[name] = data;
            stubCount++;
        } else {
            entries.push({
                name: entryName,
                data: options.minifyJson ? minifyJson(entryName, data, logger) : data,
            });
            archivedCount++;
            if (keepFileLoose) duplicated[name] = data;
        }

        archives.set(dir, entries);
    }

    const output: FileMap = { ...loose, ...duplicated };
    for (const dir of [...archives.keys()].sort()) {
        output[`${BRARCHIVE_DIR}/${dir}${BRARCHIVE_EXTENSION}`] = serializeBrarchive(
            archives.get(dir)!
        );
    }

    // `header.pack_optimization_version` is what makes the engine read `__brarchive/`,
    // so it is always written into the packaged manifest.
    output["manifest.json"] = withPackOptimizationVersion(
        manifestSource,
        options.packOptimizationVersion
    );

    const duplicatedCount = Object.keys(duplicated).length;
    const stubs = stubCount > 0 ? `, ${stubCount} name-stub${stubCount === 1 ? "" : "s"}` : "";
    logger?.pack(
        `optimized into ${archives.size} archive${archives.size === 1 ? "" : "s"} ` +
            `(${archivedCount} file${archivedCount === 1 ? "" : "s"} archived${stubs}, ` +
            `${duplicatedCount} kept loose)`
    );

    // Stable key order keeps the produced artifact deterministic.
    return sortedFiles(output);
}

/** Create the transform used when pack optimization is enabled. */
export function createPackOptimizer(
    options: PackOptimizeResolved,
    logger?: OptimizeLogger,
    fallbackManifest?: Uint8Array
): FilesTransform {
    return (files) => optimizePackFiles(files, options, logger, fallbackManifest);
}
