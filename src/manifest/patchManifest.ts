import path from "node:path";
import { pathExists, readJsonFile, writeJsonFile } from "../utils/fs.js";
import { bpManifest, rpManifest, slash } from "../utils/path.js";
import type { ResolvedConfig } from "../config/configTypes.js";
import { ManifestBuilder } from "./ManifestBuilder.js";
import { validateManifest } from "./validate.js";

export type PatchManifestOptions = {
    cwd: string;
    config: ResolvedConfig;
    dryRun?: boolean;
    resolvedDeps?: Record<string, string>;
};

/**
 * 修补 BP 和（可选的）RP manifest 文件。
 *
 * - 只负责任务编排：路径计算、文件读写、调用构建器。
 * - 如果 manifest 已存在，保留用户手写字段并覆盖 BePack 管理字段。
 * - 如果 manifest 不存在，根据配置完整生成。
 * - dryRun 时返回结果但不写入文件。
 */
export async function patchManifest(options: PatchManifestOptions) {
    const builder = new ManifestBuilder(options.config, options.resolvedDeps);
    const bpPath = bpManifest(options.cwd, options.config);
    const rpPath = rpManifest(options.cwd, options.config);

    // BP
    const bpExisted = await pathExists(bpPath);
    const bpExisting = bpExisted ? await readJsonFile<unknown>(bpPath) : undefined;
    const bpManifestObj = builder.buildBp(bpExisting);
    validateManifest(bpManifestObj, "bp");
    if (!options.dryRun) await writeJsonFile(bpPath, bpManifestObj);

    // RP
    let rpExisted = false;
    if (options.config.packs.rp) {
        rpExisted = await pathExists(rpPath);
        const rpExisting = rpExisted ? await readJsonFile<unknown>(rpPath) : undefined;
        const rpManifestObj = builder.buildRp(rpExisting);
        validateManifest(rpManifestObj, "rp");
        if (!options.dryRun) await writeJsonFile(rpPath, rpManifestObj);
    }

    return {
        bpManifest: {
            path: slash(path.relative(options.cwd, bpPath)),
            updated: true,
            existed: bpExisted,
        },
        ...(options.config.packs.rp
            ? {
                  rpManifest: {
                      path: slash(path.relative(options.cwd, rpPath)),
                      updated: true,
                  },
              }
            : {}),
    };
}
