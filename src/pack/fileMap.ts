import { promises as fs } from "node:fs";
import path from "node:path";

/** Relative POSIX path -> file content. */
export type FileMap = Record<string, Uint8Array>;

/**
 * Optional post-processing hook applied to one pack's collected files before they are
 * written out (zipped for `bepack pack`, copied to disk for `bepack copy`).
 * Used by pack optimization to replace loose files with `__brarchive/` archives.
 */
export type FilesTransform = (files: FileMap) => FileMap | Promise<FileMap>;

/** Recursively collect every file below `dir` into a pack-relative FileMap. */
export async function collectDirFiles(dir: string, prefix = ""): Promise<FileMap> {
    const files: FileMap = {};
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        const name = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
            Object.assign(files, await collectDirFiles(full, name));
        } else {
            files[name] = new Uint8Array(await fs.readFile(full));
        }
    }
    return files;
}

/** Collect the configured include items of a pack into a pack-relative FileMap. */
export async function collectSelectedFiles(source: string, items: string[]): Promise<FileMap> {
    const files: FileMap = {};
    for (const item of items) {
        const full = path.join(source, item);
        try {
            const stat = await fs.stat(full);
            if (stat.isDirectory()) {
                Object.assign(files, await collectDirFiles(full, item));
            } else {
                files[item] = new Uint8Array(await fs.readFile(full));
            }
        } catch {
            // skip missing items
        }
    }
    return files;
}

export async function transformFiles(files: FileMap, transform?: FilesTransform): Promise<FileMap> {
    return transform ? await transform(files) : files;
}

/** Prefix every key, used when nesting packs inside a `.mcaddon`. */
export function withPrefix(files: FileMap, prefix: string): FileMap {
    const prefixed: FileMap = {};
    for (const [name, data] of Object.entries(files)) {
        prefixed[`${prefix}/${name}`] = data;
    }
    return prefixed;
}

/** Sort keys so the produced artifact is stable across runs and platforms. */
export function sortedFiles(files: FileMap): FileMap {
    const out: FileMap = {};
    for (const key of Object.keys(files).sort()) out[key] = files[key]!;
    return out;
}

/** Write a FileMap to disk, replacing whatever the target directory contained. */
export async function writeFileMap(dir: string, files: FileMap): Promise<void> {
    await fs.rm(dir, { recursive: true, force: true });
    await fs.mkdir(dir, { recursive: true });
    for (const [name, data] of Object.entries(files)) {
        const target = path.join(dir, name);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, data);
    }
}
