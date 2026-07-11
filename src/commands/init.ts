import path from "node:path";
import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import { ensureDir, pathExists } from "../utils/fs.js";
import { BePackError } from "../errors/BePackError.js";
import { Logger } from "../logger/logger.js";
import { ManifestFile } from "../manifest/ManifestFile.js";
import { ManifestReader } from "../manifest/ManifestReader.js";

/**
 * 从 manifest 文件路径推导 pack root 目录（相对 cwd）。
 * 如果路径在 cwd 之外则抛出。
 */
function derivePackRoot(cwd: string, manifestPath: string): string {
    const abs = path.resolve(cwd, manifestPath);
    const dir = path.dirname(abs);
    if (!dir.startsWith(cwd)) {
        throw new BePackError(
            "CONFIG_INVALID",
            `Manifest path is outside the project directory: ${manifestPath}`
        );
    }
    const rel = path.relative(cwd, dir);
    return rel || ".";
}

async function assertFileNotExists(file: string, force: boolean): Promise<void> {
    if (!force && (await pathExists(file))) {
        throw new BePackError(
            "CONFIG_INVALID",
            `Config file already exists: ${file}. Use --force to overwrite.`,
            { suggestions: ["Pass --force to overwrite the existing file."] }
        );
    }
    await ensureDir(path.dirname(file));
}

async function writeConfig(file: string, content: string, force: boolean): Promise<boolean> {
    await assertFileNotExists(file, force);
    await fs.writeFile(file, content, "utf8");
    return true;
}

function formatConfig(config: Record<string, unknown>): string {
    const json = JSON.stringify(config, null, 4);
    // 只移除合法 JS 标识符的引号，@minecraft/server 这类特殊键保留引号
    const unquoted = json.replace(/\n( +)"([a-zA-Z_$][a-zA-Z0-9_$]*)": /g, "\n$1$2: ");
    return `export default ${unquoted}\n`;
}

/** Convert manifest version to string "1.0.0". Handles both tuple [1,0,0] and string "1.0.0" (format_version 3). */
export function versionToString(v: unknown): string | undefined {
    if (!v) return undefined;
    if (Array.isArray(v)) return v.join(".");
    if (typeof v === "string") return v;
    return undefined;
}

/** Compare two version tuples. Returns positive if a > b, negative if a < b, 0 if equal. */
function compareVersionTuple(
    a: [number, number, number],
    b: [number, number, number]
): number {
    if (a[0] !== b[0]) return a[0] - b[0];
    if (a[1] !== b[1]) return a[1] - b[1];
    return a[2] - b[2];
}

/** Parse a version value (tuple or string) into parts [x, y, z] for comparison. */
export function parseVersionToTuple(v: unknown): [number, number, number] | undefined {
    if (Array.isArray(v) && v.length === 3) return v as [number, number, number];
    if (typeof v === "string") {
        const parts = v.split(".").map(Number);
        if (parts.length === 3 && parts.every((n) => !Number.isNaN(n))) {
            return parts as [number, number, number];
        }
    }
    return undefined;
}

// ---------------------------------------------------------------------------
// Reverse-engineering from manifests
// ---------------------------------------------------------------------------

async function initFromManifests(
    cwd: string,
    options: any
): Promise<{ ok: true; command: "init"; filesCreated: number }> {
    const format = options.format ?? "ts";
    if (!["ts", "js", "mjs"].includes(format)) {
        throw new BePackError("CONFIG_INVALID", "init --format must be ts, js, or mjs.");
    }
    const configFile = path.join(cwd, `bepack.config.${format}`);
    const force = Boolean(options.force);
    const logger = new Logger({ silent: options.silent, verbose: options.verbose });

    const hasBp = Boolean(options.fromBp);
    const hasRp = Boolean(options.fromRp);

    // Read manifests and extract data
    let bpInfo: {
        root: string;
        uuid: string;
        moduleUuid?: string;
        version?: string;
        deps: Record<string, string>;
    } | undefined;

    let rpInfo: {
        root: string;
        uuid: string;
        moduleUuid: string;
        version?: string;
    } | undefined;

    // Detect format_version from the first available manifest
    let detectedFormatVersion: number | undefined;

    // name/description rules:
    // - only one pack → set top-level, no per-pack name
    // - both packs    → set top-level from BP, plus per-pack name
    let topName: string | undefined;
    let topDescription: string | undefined;
    let bpName: string | undefined;
    let bpDescription: string | undefined;
    let rpName: string | undefined;
    let rpDescription: string | undefined;

    // Collect versions for conflict resolution
    const versions: string[] = [];

    if (hasBp) {
        const manifest = await ManifestFile.read(options.fromBp);
        if (!manifest) {
            throw new BePackError(
                "CONFIG_NOT_FOUND",
                `BP manifest not found: ${options.fromBp}`
            );
        }
        detectedFormatVersion ??= manifest.format_version;
        const header = ManifestReader.validateHeader(manifest, "BP");
        // Script module is optional — data-only BP may not have one.
        // If found, enable compile + moduleUuid.
        const scriptModuleUuid = ManifestReader.findScriptModuleUuid(manifest);
        const bpVersion = versionToString(manifest.header?.version);
        if (bpVersion) versions.push(bpVersion);

        bpInfo = {
            root: derivePackRoot(cwd, options.fromBp),
            uuid: header.uuid,
            ...(scriptModuleUuid ? { moduleUuid: scriptModuleUuid } : {}),
            ...(bpVersion ? { version: bpVersion } : {}),
            deps: ManifestReader.matchDependencies(manifest),
        };

        // Always set top-level name from BP header (required by normalizeConfig)
        topName = header.name;
        topDescription = header.description;
        bpName = header.name;
        bpDescription = header.description;
    }

    if (hasRp) {
        const manifest = await ManifestFile.read(options.fromRp);
        if (!manifest) {
            throw new BePackError(
                "CONFIG_NOT_FOUND",
                `RP manifest not found: ${options.fromRp}`
            );
        }
        detectedFormatVersion ??= manifest.format_version;
        const header = ManifestReader.validateHeader(manifest, "RP");
        const moduleUuid = ManifestReader.findResourcesModuleUuid(manifest);
        if (!moduleUuid) {
            throw new BePackError(
                "MANIFEST_INVALID",
                "RP manifest is missing a resources module with uuid"
            );
        }
        const rpVersion = versionToString(manifest.header?.version);
        if (rpVersion) versions.push(rpVersion);

        rpInfo = {
            root: derivePackRoot(cwd, options.fromRp),
            uuid: header.uuid,
            moduleUuid,
            ...(rpVersion ? { version: rpVersion } : {}),
        };

        if (!hasBp) {
            topName = header.name;
            topDescription = header.description;
        }
        rpName = header.name;
        rpDescription = header.description;
    }

    // Resolve version conflict
    let resolvedVersion: string | undefined;

    if (versions.length === 1) {
        resolvedVersion = versions[0];
    } else if (versions.length === 2) {
        const v0 = versions[0]!;
        const v1 = versions[1]!;
        if (v0 === v1) {
            resolvedVersion = v0;
        } else {
            // Different versions — pick the higher one
            const vA = parseVersionToTuple(v0);
            const vB = parseVersionToTuple(v1);
            if (vA && vB) {
                resolvedVersion = compareVersionTuple(vA, vB) >= 0 ? v0 : v1;
            } else {
                resolvedVersion = v0;
            }
            logger.warn(
                `BP version (${v0}) and RP version (${v1}) differ. Using ${resolvedVersion}.`
            );
        }
    }

    // Build config object
    const config: Record<string, unknown> = {
        root: ".",
        target: "latest",
        pack: { outDir: "dist" },
    };

    if (detectedFormatVersion !== undefined) {
        config.manifestFormat = detectedFormatVersion;
    }
    if (resolvedVersion) config.version = resolvedVersion;
    if (topName) config.name = topName;
    if (topDescription) config.description = topDescription;

    const packs: Record<string, unknown> = {};

    if (bpInfo) {
        const bp: Record<string, unknown> = {
            root: bpInfo.root,
            uuid: bpInfo.uuid,
        };
        if (bpInfo.moduleUuid) {
            bp.moduleUuid = bpInfo.moduleUuid;
            bp.compile = { entry: "src/main.ts" };
        }
        if (bpName) bp.name = bpName;
        if (bpDescription) bp.description = bpDescription;
        if (Object.keys(bpInfo.deps).length > 0) {
            bp.dependencies = { ...bpInfo.deps };
        }
        packs.bp = bp;
    }

    if (rpInfo) {
        const rp: Record<string, unknown> = {
            root: rpInfo.root,
            uuid: rpInfo.uuid,
            moduleUuid: rpInfo.moduleUuid,
        };
        if (rpName) rp.name = rpName;
        if (rpDescription) rp.description = rpDescription;
        packs.rp = rp;
    }

    config.packs = packs;

    // Windows auto-copy
    if (process.platform === "win32") {
        config.copy = { defaultTarget: "win" };
    }

    const content = formatConfig(config);
    const files = [await writeConfig(configFile, content, force)];
    return { ok: true, command: "init", filesCreated: files.filter(Boolean).length };
}

// ---------------------------------------------------------------------------
// Default scaffold
// ---------------------------------------------------------------------------

function scaffoldConfig(): string {
    const config: Record<string, unknown> = {
        root: ".",
        name: "example-addon",
        version: "1.0.0",
        target: "latest",
        packs: {
            bp: {
                root: "bp",
                uuid: randomUUID(),
                moduleUuid: randomUUID(),
                compile: { entry: "src/main.ts" },
                dependencies: { "@minecraft/server": "stable" },
            },
        },
        pack: { outDir: "dist" },
    };
    return formatConfig(config);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function commandInit(options: any) {
    const cwd = path.resolve(options.cwd ?? process.cwd());

    if (options.fromBp || options.fromRp) {
        return await initFromManifests(cwd, options);
    }

    // Default scaffold
    const format = options.format ?? "ts";
    if (!["ts", "js", "mjs"].includes(format))
        throw new BePackError("CONFIG_INVALID", "init --format must be ts, js, or mjs.");
    const configFile = path.join(cwd, `bepack.config.${format}`);
    const files = [await writeConfig(configFile, scaffoldConfig(), Boolean(options.force))];
    return { ok: true, command: "init", filesCreated: files.filter(Boolean).length };
}
