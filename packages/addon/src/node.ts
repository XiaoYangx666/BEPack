import { writeSync } from "node:fs";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { basename, dirname } from "node:path";
import {
    readAddonArchive,
    writeAddonArchiveTo,
    type ReadAddonArchiveOptions,
    type WriteAddonOptions,
} from "./archive.js";
import type { AddonEntry, AddonFileData } from "./sources.js";
import { readAddon, type AddonTemplate, type ReadAddonOptions } from "./template.js";

export interface WriteAddonFileOptions extends Omit<WriteAddonOptions, "type"> {
    /** Write to a temporary file and rename it into place. Defaults to true. */
    readonly atomic?: boolean;
    /** Create the parent directory first. Defaults to true. */
    readonly mkdir?: boolean;
}

export interface WriteAddonFileResult {
    readonly path: string;
    /** Compressed archive size in bytes. */
    readonly bytes: number;
}

/** Read a `.mcaddon` / `.mcpack` from disk and discover its packs. */
export async function readAddonFile(
    path: string,
    options: ReadAddonOptions = {}
): Promise<AddonTemplate> {
    const bytes = await readFile(path);
    return readAddon(bytes, {
        ...options,
        sourceName: options.sourceName ?? basename(path),
    });
}

/** Read every file from a `.mcaddon` / `.mcpack` on disk. */
export async function readAddonArchiveFile(
    path: string,
    options: ReadAddonArchiveOptions = {}
): Promise<readonly AddonFileData[]> {
    return readAddonArchive(await readFile(path), options);
}

/** Write an edited addon to disk. */
export async function writeAddonFile(
    path: string,
    addon: AddonTemplate,
    options: WriteAddonFileOptions = {}
): Promise<WriteAddonFileResult> {
    return writeAddonArchiveFile(path, addon.entries(), options);
}

/**
 * Write archive entries to disk without building a Blob.
 *
 * The archive writer pushes chunks synchronously, so this adapter writes them
 * straight to a file descriptor. With `atomic` (the default) the archive is
 * written next to the destination and renamed into place, so a failed export
 * never leaves a truncated `.mcaddon`.
 */
export async function writeAddonArchiveFile(
    path: string,
    entries: readonly AddonEntry[],
    options: WriteAddonFileOptions = {}
): Promise<WriteAddonFileResult> {
    const { atomic = true, mkdir: makeDirectory = true, ...writeOptions } = options;
    if (makeDirectory) await mkdir(dirname(path), { recursive: true });

    const target = atomic ? temporaryPath(path) : path;
    const handle = await open(target, "w");
    let bytes = 0;

    try {
        await writeAddonArchiveTo(
            entries,
            {
                write(chunk) {
                    bytes += chunk.byteLength;
                    writeSync(handle.fd, chunk);
                },
            },
            writeOptions
        );
        await handle.close();
        if (atomic) await rename(target, path);
    } catch (error) {
        await handle.close().catch(() => undefined);
        if (atomic) await rm(target, { force: true }).catch(() => undefined);
        throw error;
    }

    return { path, bytes };
}

function temporaryPath(path: string): string {
    const suffix = `${process.pid.toString(36)}-${Date.now().toString(36)}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;
    return `${path}.${suffix}.tmp`;
}
