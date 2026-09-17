import { promises as fs } from "node:fs";
import path from "node:path";
import { zipSync } from "fflate";
import {
    collectDirFiles,
    collectSelectedFiles,
    sortedFiles,
    transformFiles,
    withPrefix,
} from "./fileMap.js";
import type { FileMap, FilesTransform } from "./fileMap.js";

export type { FileMap, FilesTransform } from "./fileMap.js";

async function writeZip(files: FileMap, output: string): Promise<void> {
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, zipSync(sortedFiles(files)));
}

export async function zipDir(
    source: string,
    output: string,
    transform?: FilesTransform
): Promise<void> {
    await writeZip(await transformFiles(await collectDirFiles(source), transform), output);
}

/**
 * Zip only specific items from a source directory.
 * Missing items are silently skipped.
 */
export async function zipSelectedItems(
    source: string,
    items: string[],
    output: string,
    transform?: FilesTransform
): Promise<void> {
    await writeZip(
        await transformFiles(await collectSelectedFiles(source, items), transform),
        output
    );
}

export async function zipAddonSelected(
    packs: { source: string; items: string[]; transform?: FilesTransform }[],
    output: string
): Promise<void> {
    const files: FileMap = {};
    for (const pack of packs) {
        const collected = await transformFiles(
            await collectSelectedFiles(pack.source, pack.items),
            pack.transform
        );
        Object.assign(files, withPrefix(collected, path.basename(path.resolve(pack.source))));
    }
    await writeZip(files, output);
}

/**
 * Hybrid: selective items from some packs + full directories from others -> mcaddon zip.
 * Used when BP is selective (always) but RP may be a full directory.
 */
export async function zipAddonHybrid(
    selectivePacks: { source: string; items: string[]; transform?: FilesTransform }[],
    fullPacks: { dir: string; transform?: FilesTransform }[],
    output: string
): Promise<void> {
    const files: FileMap = {};
    for (const pack of selectivePacks) {
        const collected = await transformFiles(
            await collectSelectedFiles(pack.source, pack.items),
            pack.transform
        );
        Object.assign(files, withPrefix(collected, path.basename(path.resolve(pack.source))));
    }
    for (const pack of fullPacks) {
        const collected = await transformFiles(await collectDirFiles(pack.dir), pack.transform);
        Object.assign(files, withPrefix(collected, path.basename(path.resolve(pack.dir))));
    }
    await writeZip(files, output);
}
