import path from "node:path";
import { loadConfig } from "../config/loadConfig.js";
import { packMcaddon } from "../pack/packMcaddon.js";
import { zipSelectedItems, zipAddonSelected, zipAddonHybrid } from "../pack/zip.js";
import { runHook } from "../hooks/runHook.js";
import { Logger } from "../logger/logger.js";
import { bpRoot, distRoot, rpRoot } from "../utils/path.js";
import { pathExists } from "../utils/fs.js";
import { BePackError } from "../errors/BePackError.js";
import { DEFAULT_BP_INCLUDES, DEFAULT_RP_INCLUDES, getIncludes } from "../constants/copyIncludes.js";

type LoadedConfig = Awaited<ReturnType<typeof loadConfig>>["config"];

async function validatePackInputs(cwd: string, config: LoadedConfig): Promise<void> {
    const missing: string[] = [];
    if (!config.configured.buildEntry) missing.push("build.entry");
    if (!config.configured.bpRoot) missing.push("packs.bp.root");
    if (config.packs.rp && !config.configured.rpRoot) missing.push("packs.rp.root");
    if (!config.configured.packOutDir) missing.push("pack.outDir");
    if (missing.length > 0) {
        throw new BePackError(
            "PACK_FAILED",
            `pack requires explicit config: ${missing.join(", ")}.`,
            { details: { missing } }
        );
    }

    const missingPaths: string[] = [];
    const rootPath = path.resolve(cwd, config.root);
    if (!(await pathExists(rootPath))) missingPaths.push(`root: ${rootPath}`);
    const entryPath = path.resolve(rootPath, config.build.entry);
    if (!(await pathExists(entryPath))) missingPaths.push(`build.entry: ${entryPath}`);
    if (missingPaths.length > 0) {
        throw new BePackError("PACK_FAILED", "pack input paths do not exist.", {
            details: { missingPaths },
        });
    }
}

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

/**
 * BP 始终使用选择性打包（只打包 DEFAULT_BP_INCLUDES + packs.bp.include 中的文件）。
 * 这样可以安全支持 bp.root = "."（项目根目录即行为包）。
 *
 * RP 若配置了 include，也走选择性打包；否则完整打包 RP 目录。
 */
function getBpPackItems(config: LoadedConfig): string[] {
    return getIncludes(DEFAULT_BP_INCLUDES, config.packs.bp.include);
}

function shouldUseSelectiveRpPack(config: LoadedConfig): boolean {
    const rpIncludes = getIncludes(DEFAULT_RP_INCLUDES, config.copy.include?.rp);
    return rpIncludes.length > 0;
}

function getRpPackItems(config: LoadedConfig): string[] {
    return getIncludes(DEFAULT_RP_INCLUDES, config.copy.include?.rp);
}

export async function packProject(
    cwd: string,
    config: LoadedConfig,
    options: { name?: string; dryRun?: boolean } = {}
) {
    await validatePackInputs(cwd, config);
    const fileName = (options.name ?? config.pack.name)
        .replaceAll("{name}", config.name)
        .replaceAll("{version}", config.version);
    const dist = distRoot(cwd, config);
    const bp = bpRoot(cwd, config);
    const rp = config.packs.rp ? rpRoot(cwd, config) : undefined;

    const bpItems = getBpPackItems(config);

    if (rp) {
        const output = path.join(dist, `${fileName}.mcaddon`);
        if (!options.dryRun) {
            const useSelectiveRp = shouldUseSelectiveRpPack(config);
            if (useSelectiveRp) {
                // BP + RP 都选择性打包
                await zipAddonSelected(
                    [
                        { source: bp, items: bpItems },
                        { source: rp, items: getRpPackItems(config) },
                    ],
                    output
                );
            } else {
                // BP 选择性打包 + RP 完整目录
                assertOutputOutsideDir(output, rp, "RP");
                await zipAddonHybrid(
                    [{ source: bp, items: bpItems }],
                    [{ dir: rp }],
                    output
                );
            }
        }
        return output;
    }

    // BP-only .mcpack
    const output = path.join(dist, `${fileName}.mcpack`);
    if (!options.dryRun) {
        await zipSelectedItems(bp, bpItems, output);
    }
    return output;
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
        command: "pack",
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
