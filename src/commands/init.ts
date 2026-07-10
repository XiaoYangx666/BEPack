import path from "node:path";
import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import { ensureDir, pathExists } from "../utils/fs.js";
import { BePackError } from "../errors/BePackError.js";
import { Logger } from "../logger/logger.js";
import {
    readManifest,
    validateManifestHeader,
    findScriptModuleUuid,
    findResourcesModuleUuid,
    derivePackRoot,
    matchDependencies,
} from "../init/index.js";

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
    return `export default ${JSON.stringify(config, null, 4)}\n`;
}

/** Convert manifest version tuple [1, 0, 0] to string "1.0.0". */
function versionToString(v: [number, number, number] | undefined): string | undefined {
    if (!v) return undefined;
    return v.join(".");
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
        moduleUuid: string;
        version?: string;
        deps: Record<string, string>;
    } | undefined;

    let rpInfo: {
        root: string;
        uuid: string;
        moduleUuid: string;
        version?: string;
    } | undefined;

    // name/description rules:
    // - only one pack → set top-level, no per-pack name
    // - both packs    → set per-pack name, no top-level
    let topName: string | undefined;
    let topDescription: string | undefined;
    let bpName: string | undefined;
    let bpDescription: string | undefined;
    let rpName: string | undefined;
    let rpDescription: string | undefined;

    // Collect versions for conflict resolution
    const versions: string[] = [];

    if (hasBp) {
        const manifest = await readManifest(options.fromBp);
        const header = validateManifestHeader(manifest, "BP");
        const moduleUuid = findScriptModuleUuid(manifest);
        if (!moduleUuid) {
            throw new BePackError(
                "MANIFEST_INVALID",
                "BP manifest is missing a script module with uuid"
            );
        }
        const bpVersion = versionToString(manifest.header?.version);
        if (bpVersion) versions.push(bpVersion);

        bpInfo = {
            root: derivePackRoot(cwd, options.fromBp),
            uuid: header.uuid,
            moduleUuid,
            ...(bpVersion ? { version: bpVersion } : {}),
            deps: matchDependencies(manifest),
        };

        if (!hasRp) {
            topName = header.name;
            topDescription = header.description;
        } else {
            bpName = header.name;
            bpDescription = header.description;
        }
    }

    if (hasRp) {
        const manifest = await readManifest(options.fromRp);
        const header = validateManifestHeader(manifest, "RP");
        const moduleUuid = findResourcesModuleUuid(manifest);
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
        } else {
            rpName = header.name;
            rpDescription = header.description;
        }
    }

    // Resolve version conflict
    let resolvedVersion: string | undefined;
    const parseVer = (v: string): [number, number, number] =>
        v.split(".").map(Number) as [number, number, number];

    if (versions.length === 1) {
        resolvedVersion = versions[0];
    } else if (versions.length === 2) {
        const v0 = versions[0]!;
        const v1 = versions[1]!;
        if (v0 === v1) {
            resolvedVersion = v0;
        } else {
            // Different versions — pick the higher one
            const vA = parseVer(v0);
            const vB = parseVer(v1);
            resolvedVersion = compareVersionTuple(vA, vB) >= 0 ? v0 : v1;
            logger.warn(
                `BP version (${v0}) and RP version (${v1}) differ. Using ${resolvedVersion}.`
            );
        }
    }

    // Build config object
    const config: Record<string, unknown> = {
        root: ".",
        target: "latest",
        build: { entry: "src/main.ts" },
        pack: { outDir: "dist" },
    };

    if (resolvedVersion) config.version = resolvedVersion;
    if (topName) config.name = topName;
    if (topDescription) config.description = topDescription;

    const packs: Record<string, unknown> = {};

    if (bpInfo) {
        const bp: Record<string, unknown> = {
            root: bpInfo.root,
            uuid: bpInfo.uuid,
            moduleUuid: bpInfo.moduleUuid,
        };
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
        build: { entry: "src/main.ts" },
        packs: {
            bp: {
                root: "bp",
                uuid: randomUUID(),
                moduleUuid: randomUUID(),
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
