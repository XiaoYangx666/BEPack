import path from "node:path";
import { loadConfig } from "../config/loadConfig.js";
import { packMcpack } from "../pack/packMcpack.js";
import { packMcaddon } from "../pack/packMcaddon.js";
import { runHook } from "../hooks/runHook.js";
import { Logger } from "../logger/logger.js";
import { bpRoot, distRoot, rpRoot } from "../utils/path.js";
import { pathExists } from "../utils/fs.js";
import { BePackError } from "../errors/BePackError.js";

type LoadedConfig = Awaited<ReturnType<typeof loadConfig>>["config"];

async function validatePackInputs(cwd: string, config: LoadedConfig): Promise<void> {
    const missing: string[] = [];
    if (!config.configured.buildEntry) missing.push("build.entry");
    if (!config.configured.bpRoot) missing.push("packs.bp.root");
    if (config.packs.rp && !config.configured.rpRoot) missing.push("packs.rp.root");
    if (!config.configured.packOutDir) missing.push("pack.outDir");
    if (missing.length > 0) {
        throw new BePackError("PACK_FAILED", `pack requires explicit config: ${missing.join(", ")}.`, { details: { missing } });
    }

    const missingPaths: string[] = [];
    const rootPath = path.resolve(cwd, config.root);
    if (!(await pathExists(rootPath))) missingPaths.push(`root: ${rootPath}`);
    const entryPath = path.resolve(rootPath, config.build.entry);
    if (!(await pathExists(entryPath))) missingPaths.push(`build.entry: ${entryPath}`);
    const bpPath = bpRoot(cwd, config);
    if (!(await pathExists(bpPath))) missingPaths.push(`packs.bp.root: ${bpPath}`);
    if (config.packs.rp) {
        const rpPath = rpRoot(cwd, config);
        if (!(await pathExists(rpPath))) missingPaths.push(`packs.rp.root: ${rpPath}`);
    }
    if (missingPaths.length > 0) {
        throw new BePackError("PACK_FAILED", "pack input paths do not exist.", { details: { missingPaths } });
    }
}

function assertOutputOutsidePackRoots(output: string, roots: string[]): void {
    const resolvedOutput = path.resolve(output);
    for (const root of roots) {
        const resolvedRoot = path.resolve(root);
        const relative = path.relative(resolvedRoot, resolvedOutput);
        if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
            throw new BePackError("PACK_FAILED", "pack output must not be inside a packed BP/RP directory.", { details: { output: resolvedOutput, root: resolvedRoot } });
        }
    }
}

export async function packProject(cwd: string, config: LoadedConfig, options: { name?: string; dryRun?: boolean } = {}) {
    await validatePackInputs(cwd, config);
    const fileName = (options.name ?? config.pack.name).replaceAll("{name}", config.name).replaceAll("{version}", config.version);
    const dist = distRoot(cwd, config);
    const bp = bpRoot(cwd, config);
    const rp = config.packs.rp ? rpRoot(cwd, config) : undefined;
    const output = path.join(dist, `${fileName}.${rp ? "mcaddon" : "mcpack"}`);
    assertOutputOutsidePackRoots(output, [bp, ...(rp ? [rp] : [])]);
    if (rp) {
        return await packMcaddon([{ dir: bp }, { dir: rp }], dist, fileName, options.dryRun);
    }
    return await packMcpack(bp, dist, fileName, options.dryRun);
}

export async function runPack(cwd: string, config: LoadedConfig, logger: Logger, options: { name?: string; dryRun?: boolean } = {}) {
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
    const loaded = await loadConfig({ command: "pack", cwd: options.cwd ?? process.cwd(), configPath: options.config });
    const { cwd, config } = loaded;
    const { output, durationMs } = await runPack(cwd, config, logger, { name: options.name, dryRun: options.dryRun });
    return { ok: true, command: "pack", durationMs, output };
}
