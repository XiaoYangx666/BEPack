import path from "node:path";
import { loadConfig } from "../config/loadConfig.js";
import { getConfiguredPacks } from "../config/configTypes.js";
import type { PackType } from "../config/configTypes.js";
import { zipSelectedItems, zipAddonSelected, zipAddonHybrid } from "../pack/zip.js";
import { runHook } from "../hooks/runHook.js";
import { Logger } from "../logger/logger.js";
import { packRoot, projectRoot, distRoot } from "../utils/path.js";
import { pathExists } from "../utils/fs.js";
import { BePackError } from "../errors/BePackError.js";
import { DEFAULT_BP_INCLUDES, DEFAULT_RP_INCLUDES, getIncludes } from "../constants/copyIncludes.js";

type LoadedConfig = Awaited<ReturnType<typeof loadConfig>>["config"];

function assertOutputOutsideDir(output: string, dir: string, label: string): void {
    const resolvedOutput = path.resolve(output);
    const resolvedDir = path.resolve(dir);
    const relative = path.relative(resolvedDir, resolvedOutput);
    if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
        throw new BePackError(
            "PACK_FAILED",
            `pack output must not be inside ${label} directory.`,
            {
                details: { output: resolvedOutput, dir: resolvedDir },
                suggestions: [`Set pack.outDir to a path outside ${label}: ${resolvedDir}`],
            }
        );
    }
}

/** Resolve include items for a given pack type when packaging. */
function getPackItems(
    config: LoadedConfig,
    packType: PackType
): { items: string[]; selective: boolean } {
    if (packType === "bp") {
        const items = getIncludes(DEFAULT_BP_INCLUDES, config.packs.bp?.include);
        return { items, selective: true };
    }

    // RP
    const rpIncludes = getIncludes(DEFAULT_RP_INCLUDES, config.packs.rp?.include);
    if (rpIncludes.length > 0) {
        return { items: rpIncludes, selective: true };
    }
    // Also check legacy copy.include.rp
    const legacyRpIncludes = getIncludes(DEFAULT_RP_INCLUDES, config.copy.include?.rp);
    if (legacyRpIncludes.length > 0) {
        return { items: legacyRpIncludes, selective: true };
    }
    return { items: [], selective: false };
}

export async function packProject(
    cwd: string,
    config: LoadedConfig,
    options: { name?: string; dryRun?: boolean } = {}
) {
    const root = projectRoot(cwd, config);
    const fileName = (options.name ?? config.pack.name)
        .replaceAll("{name}", config.name)
        .replaceAll("{version}", config.version);
    const dist = distRoot(cwd, config);
    const packs = getConfiguredPacks(config);

    if (packs.length === 0) {
        throw new BePackError("PACK_FAILED", "No packs configured. At least one pack is required.");
    }

    const bp = config.packs.bp ? { root: packRoot(root, config, "bp")!, config: config } : undefined;
    const rp = config.packs.rp ? { root: packRoot(root, config, "rp")!, config: config } : undefined;

    if (bp && rp) {
        // BP + RP → .mcaddon
        const output = path.join(dist, `${fileName}.mcaddon`);
        if (!options.dryRun) {
            const bpInfo = getPackItems(config, "bp");
            const rpInfo = getPackItems(config, "rp");

            assertOutputOutsideDir(output, bp.root, "BP");
            if (rpInfo.selective) {
                await zipAddonSelected(
                    [
                        { source: bp.root, items: bpInfo.items },
                        { source: rp.root, items: rpInfo.items },
                    ],
                    output
                );
            } else {
                // BP selective + RP full directory
                await zipAddonHybrid(
                    [{ source: bp.root, items: bpInfo.items }],
                    [{ dir: rp.root }],
                    output
                );
            }
        }
        return output;
    }

    if (bp) {
        // BP-only → .mcpack
        const output = path.join(dist, `${fileName}.mcpack`);
        if (!options.dryRun) {
            const bpInfo = getPackItems(config, "bp");
            await zipSelectedItems(bp.root, bpInfo.items, output);
        }
        return output;
    }

    if (rp) {
        // RP-only → .mcpack
        const output = path.join(dist, `${fileName}.mcpack`);
        if (!options.dryRun) {
            const rpInfo = getPackItems(config, "rp");
            if (rpInfo.selective) {
                await zipSelectedItems(rp.root, rpInfo.items, output);
            } else {
                // RP full directory
                const { packMcpack } = await import("../pack/packMcpack.js");
                return await packMcpack(rp.root, dist, fileName, options.dryRun);
            }
        }
        return output;
    }

    throw new BePackError("PACK_FAILED", "No packs configured.");
}

export async function runPack(
    cwd: string,
    config: LoadedConfig,
    logger: Logger,
    options: { name?: string; dryRun?: boolean } = {}
) {
    const start = Date.now();
    await runHook("beforePack", "pack", cwd, config, logger);
    const output = await packProject(cwd, config, options);
    await runHook("afterPack", "pack", cwd, config, logger);
    const durationMs = Date.now() - start;
    logger.done("pack", `packed ${output} in ${logger.formatDuration(durationMs)}`);
    return { output, durationMs };
}

export async function commandPack(options: any) {
    const logger = new Logger({ ...options, silent: options.silent || options.json });
    const loaded = await loadConfig({
        cwd: options.cwd ?? process.cwd(),
        configPath: options.config,
    });
    const { cwd, config } = loaded;
    const { output, durationMs } = await runPack(cwd, config, logger, {
        name: options.name,
        dryRun: options.dryRun,
    });
    return { ok: true, command: "pack", durationMs, output };
}
