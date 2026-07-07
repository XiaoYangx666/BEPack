import path from "node:path";
import type { ResolvedConfig } from "../config/configTypes.js";
import { pathExists, readJsonFile, writeJsonFile } from "../utils/fs.js";
import { bpManifest, rpManifest, slash } from "../utils/path.js";
import { createBpManifest, createRpManifest } from "./createManifest.js";
import { patchBpManifest } from "./patchBpManifest.js";
import { patchRpManifest } from "./patchRpManifest.js";

export type PatchManifestOptions = {
    cwd: string;
    config: ResolvedConfig;
    dryRun?: boolean;
    resolvedDeps?: Record<string, string>;
};

export async function patchManifest(options: PatchManifestOptions) {
    const bpPath = bpManifest(options.cwd, options.config);
    const rpPath = rpManifest(options.cwd, options.config);
    const bpExisted = await pathExists(bpPath);
    const bp = patchBpManifest(bpExisted ? await readJsonFile(bpPath) : createBpManifest(options.config), options.config, options.resolvedDeps);
    if (!options.dryRun) await writeJsonFile(bpPath, bp);
    let rpUpdated = false;
    if (options.config.packs.rp) {
        const rpExisted = await pathExists(rpPath);
        const rp = patchRpManifest(rpExisted ? await readJsonFile(rpPath) : createRpManifest(options.config), options.config);
        if (!options.dryRun) await writeJsonFile(rpPath, rp);
        rpUpdated = true;
    }
    return {
        bpManifest: { path: slash(path.relative(options.cwd, bpPath)), updated: true, existed: bpExisted },
        rpManifest: { path: slash(path.relative(options.cwd, rpPath)), updated: rpUpdated },
    };
}
