import { promises as fs } from "node:fs";
import path from "node:path";
import type { LoggerLike, PackType, ResolvedConfig } from "../config/configTypes.js";
import { CONFIG_FILES } from "../constants/paths.js";
import { distRoot, packRoot, projectRoot, srcEntry } from "./path.js";

/**
 * Entries that are always skipped by the audit: hidden files, dependency
 * folders and the project files BePack itself consumes.
 */
const ALWAYS_IGNORED = new Set<string>([
    "node_modules",
    "package.json",
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "bun.lock",
    "bun.lockb",
    "tsconfig.json",
    ...CONFIG_FILES,
]);

/**
 * Build/management entries to keep out of the "skipped by include" report.
 *
 * A behavior pack whose root is the project root (`root: "."`) shares its
 * directory with `src/`, the pack output directory and config files; reporting
 * those as "skipped" would be pure noise.
 */
export function packAuditIgnoreList(
    cwd: string,
    config: ResolvedConfig,
    packType: PackType
): string[] {
    const root = packRoot(projectRoot(cwd, config), config, packType);
    if (!root) return [];
    const entry = srcEntry(cwd, config);
    const candidates = [distRoot(cwd, config), entry ? path.dirname(entry) : undefined];
    const ignored: string[] = [];
    for (const candidate of candidates) {
        if (!candidate) continue;
        const relative = path.relative(root, candidate);
        if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) continue;
        const top = relative.split(path.sep)[0];
        if (top) ignored.push(top);
    }
    return ignored;
}

/**
 * Top-level entries inside `root` that a selective include list would skip.
 *
 * BP copying/packing is always selective, and RP becomes selective as soon as
 * `packs.rp.include` is set. Everything outside the include list used to be
 * dropped without a word — a `README_中文.md` next to `bp/manifest.json`
 * silently disappeared from the artifact. Hidden entries and `node_modules`
 * are ignored so the report stays actionable.
 */
export async function findUnincludedEntries(
    root: string,
    items: string[],
    ignore: string[] = []
): Promise<string[]> {
    let entries: import("node:fs").Dirent[];
    try {
        entries = await fs.readdir(root, { withFileTypes: true });
    } catch {
        return [];
    }
    const selected = new Set(items);
    return entries
        .map((entry) => entry.name)
        .filter((name) => !selected.has(name))
        .filter((name) => !name.startsWith(".") && !ALWAYS_IGNORED.has(name))
        .filter((name) => !ignore.includes(name))
        .sort((a, b) => a.localeCompare(b));
}

/** Describe which configured pack owns the include list, for the warning's suggestion. */
function includeConfigPath(packType: PackType): string {
    return packType === "bp" ? "packs.bp.include" : "packs.rp.include";
}

/**
 * Warn about entries a selective copy/pack silently leaves behind.
 *
 * Best-effort diagnostics: never throws, never blocks the operation.
 */
export async function warnUnincludedPackEntries(options: {
    logger?: LoggerLike;
    packType: PackType;
    root: string;
    items: string[];
    action: "copy" | "pack";
    /** Project directory used to print a relative pack path. */
    cwd?: string;
    /** Build/management entries to keep out of the report (see `packAuditIgnoreList`). */
    ignore?: string[];
    /** Max entries listed before the message is truncated. Default: 8. */
    limit?: number;
}): Promise<void> {
    const { logger, packType, root, items, action } = options;
    if (!logger) return;
    const skipped = await findUnincludedEntries(root, items, options.ignore ?? []);
    if (skipped.length === 0) return;

    const limit = options.limit ?? 8;
    const shown = skipped.slice(0, limit).join(", ");
    const rest = skipped.length > limit ? `, +${skipped.length - limit} more` : "";
    const label = packType === "bp" ? "behavior pack" : "resource pack";
    logger.warn(
        `${label} ${action} only includes ${items.length} configured item(s); ` +
            `${skipped.length} entr${skipped.length === 1 ? "y" : "ies"} in "${describeRoot(root, options.cwd)}" ` +
            `${skipped.length === 1 ? "is" : "are"} skipped: ${shown}${rest}. ` +
            `Add them to ${includeConfigPath(packType)} to include them.`
    );
}

/** Prefer a project-relative path so the warning stays readable. */
function describeRoot(root: string, cwd?: string): string {
    if (!cwd) return root;
    const relative = path.relative(cwd, root).replace(/\\/g, "/");
    return relative && !relative.startsWith("..") && !path.isAbsolute(relative) ? relative : root;
}
