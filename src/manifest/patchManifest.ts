import path from "node:path";
import { pathExists } from "../utils/fs.js";
import { bpManifest, rpManifest, slash } from "../utils/path.js";
import { createDependencyCatalog } from "../install/dependencyCatalog.js";
import type { ResolvedConfig } from "../config/configTypes.js";
import { ManifestFile } from "./ManifestFile.js";
import { ManifestBuilder } from "./ManifestBuilder.js";
import { ManifestDepManager } from "./ManifestDepManager.js";

export type PatchManifestOptions = {
    cwd: string;
    config: ResolvedConfig;
    dryRun?: boolean;
    resolvedDeps?: Record<string, string>;
};

/**
 * 修补 BP 和（可选的）RP manifest 文件。
 *
 * - 只负责任务编排：路径计算、文件读写、调用构建器和依赖管理器。
 * - 如果 manifest 已存在，保留用户手写字段并覆盖 BePack 管理字段。
 * - 如果 manifest 不存在，根据配置完整生成。
 * - dryRun 时返回结果但不写入文件。
 */
export async function patchManifest(options: PatchManifestOptions) {
    const catalog = createDependencyCatalog(options.config);
    const depManager = new ManifestDepManager(
        options.config,
        catalog,
        options.resolvedDeps
    );
    const builder = new ManifestBuilder(options.config, depManager);
    const bpPath = bpManifest(options.cwd, options.config);
    const rpPath = rpManifest(options.cwd, options.config);

    // BP
    const bpExisting = await ManifestFile.read(bpPath);
    const bpExisted = bpExisting !== undefined;
    const bpManifestObj = builder.buildBp(bpExisting);
    if (!options.dryRun) await ManifestFile.write(bpPath, bpManifestObj, "bp");

    // RP
    let rpExisted = false;
    if (options.config.packs.rp) {
        const rpExisting = await ManifestFile.read(rpPath);
        rpExisted = rpExisting !== undefined;
        const rpManifestObj = builder.buildRp(rpExisting);
        if (!options.dryRun) await ManifestFile.write(rpPath, rpManifestObj, "rp");
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
