import { AsyncUnzipInflate, Unzip, Zip, ZipDeflate, ZipPassThrough } from "fflate";
import { AddonError } from "./core/errors.js";
import { normalizeArchivePath } from "./core/path.js";
import {
    addonFileSize,
    isAddonSource,
    sourceFromBytes,
    type AddonEntry,
    type AddonFileData,
    type AddonSource,
} from "./sources.js";

export const DEFAULT_STORED_EXTENSIONS =
    /\.(?:ogg|opus|mp3|m4a|aac|flac|png|jpe?g|webp|zip|mcpack|mcaddon|wasm)$/i;

export const DEFAULT_MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;
export const DEFAULT_MAX_EXTRACTED_BYTES = 512 * 1024 * 1024;
export const DEFAULT_MAX_FILES = 20_000;
export const DEFAULT_CHUNK_BYTES = 256 * 1024;

export interface ReadAddonArchiveOptions {
    readonly maxArchiveBytes?: number;
    readonly maxExtractedBytes?: number;
    readonly maxFiles?: number;
}

export interface WriteAddonOptions {
    readonly type?: "blob" | "bytes";
    readonly signal?: AbortSignal;
    readonly onProgress?: (processedBytes: number, totalBytes: number) => void;
    readonly level?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
    readonly chunkBytes?: number;
    readonly storedExtensions?: RegExp;
    /** Set a fixed ZIP timestamp for reproducible output. */
    readonly mtime?: Date | number;
    readonly maxBytes?: number;
}

/** A streaming destination for `writeAddonArchiveTo`. `write` must be synchronous. */
export interface AddonArchiveSink {
    write(chunk: Uint8Array): void;
    end?(): void | Promise<void>;
}

/** Read every file from a `.mcaddon` / `.mcpack` archive. */
export function readAddonArchive(
    bytes: Uint8Array,
    options: ReadAddonArchiveOptions = {}
): Promise<readonly AddonFileData[]> {
    const maxArchiveBytes = options.maxArchiveBytes ?? DEFAULT_MAX_ARCHIVE_BYTES;
    const maxExtractedBytes = options.maxExtractedBytes ?? DEFAULT_MAX_EXTRACTED_BYTES;
    const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;

    if (bytes.byteLength === 0) {
        return Promise.reject(
            new AddonError("ADDON_ARCHIVE_INVALID", "The addon archive is empty.")
        );
    }
    if (bytes.byteLength > maxArchiveBytes) {
        return Promise.reject(
            new AddonError(
                "ADDON_ARCHIVE_TOO_LARGE",
                `The addon archive is larger than ${maxArchiveBytes} bytes.`
            )
        );
    }

    return new Promise((resolve, reject) => {
        const files: AddonFileData[] = [];
        const active = new Set<{ terminate(): void }>();
        const paths = new Set<string>();
        let declaredBytes = 0;
        let extractedBytes = 0;
        let fileCount = 0;
        let pendingFiles = 0;
        let inputFinished = false;
        let settled = false;

        const fail = (error: unknown): void => {
            if (settled) return;
            settled = true;
            for (const file of active) file.terminate();
            active.clear();
            reject(
                error instanceof AddonError
                    ? error
                    : new AddonError(
                          "ADDON_ARCHIVE_INVALID",
                          `Unable to read the addon archive: ${
                              error instanceof Error ? error.message : String(error)
                          }.`
                      )
            );
        };

        const finishIfComplete = (): void => {
            if (settled || !inputFinished || pendingFiles !== 0) return;
            settled = true;
            if (files.length === 0) {
                reject(
                    new AddonError("ADDON_ARCHIVE_INVALID", "The addon archive contains no files.")
                );
                return;
            }
            resolve(
                Object.freeze(files.sort((left, right) => left.path.localeCompare(right.path)))
            );
        };

        const archive = new Unzip((file) => {
            if (settled) {
                file.terminate();
                return;
            }
            if (file.name.endsWith("/") || file.name.endsWith("\\")) return;
            try {
                fileCount += 1;
                if (fileCount > maxFiles) {
                    throw new AddonError(
                        "ADDON_ARCHIVE_TOO_MANY_FILES",
                        `The addon archive contains more than ${maxFiles} files.`
                    );
                }
                const path = normalizeArchivePath(file.name);
                if (paths.has(path)) {
                    throw new AddonError(
                        "ADDON_DUPLICATE_PATH",
                        `The addon archive contains duplicate paths after normalization: ${path}.`
                    );
                }
                paths.add(path);

                if (file.originalSize !== undefined) {
                    declaredBytes += file.originalSize;
                    if (declaredBytes > maxExtractedBytes) {
                        throw new AddonError(
                            "ADDON_ARCHIVE_TOO_LARGE",
                            `The addon archive declares more than ${maxExtractedBytes} bytes of content.`
                        );
                    }
                }

                pendingFiles += 1;
                active.add(file);
                const chunks: Uint8Array[] = [];
                let fileBytes = 0;
                file.ondata = (error, data, final) => {
                    if (settled) return;
                    if (error) {
                        fail(
                            new AddonError(
                                "ADDON_ARCHIVE_INVALID",
                                `Unable to read ${path}: ${error.message}.`
                            )
                        );
                        return;
                    }
                    fileBytes += data.byteLength;
                    extractedBytes += data.byteLength;
                    if (extractedBytes > maxExtractedBytes) {
                        fail(
                            new AddonError(
                                "ADDON_ARCHIVE_TOO_LARGE",
                                `The addon archive contains more than ${maxExtractedBytes} bytes of content.`
                            )
                        );
                        return;
                    }
                    if (data.byteLength > 0) chunks.push(data);
                    if (!final) return;
                    active.delete(file);
                    pendingFiles -= 1;
                    files.push({ path, bytes: joinChunks(chunks, fileBytes) });
                    finishIfComplete();
                };
                file.start();
            } catch (error) {
                fail(error);
            }
        });
        archive.register(AsyncUnzipInflate);
        try {
            archive.push(bytes, true);
            inputFinished = true;
            finishIfComplete();
        } catch (error) {
            fail(error);
        }
    });
}

/** Write entries to a Blob (default) or a Uint8Array. */
export async function writeAddonArchive(
    entries: readonly AddonEntry[],
    options: WriteAddonOptions = {}
): Promise<Blob | Uint8Array> {
    if (options.type === "bytes") return writeAddonBytes(entries, options);
    return writeAddonBlob(entries, options);
}

export async function writeAddonBytes(
    entries: readonly AddonEntry[],
    options: Omit<WriteAddonOptions, "type"> = {}
): Promise<Uint8Array> {
    const chunks: Uint8Array[] = [];
    await writeAddonArchiveTo(
        entries,
        {
            write(chunk) {
                chunks.push(chunk);
            },
        },
        options
    );
    return joinChunks(
        chunks,
        chunks.reduce((total, chunk) => total + chunk.byteLength, 0)
    );
}

export async function writeAddonBlob(
    entries: readonly AddonEntry[],
    options: Omit<WriteAddonOptions, "type"> = {}
): Promise<Blob> {
    const parts: BlobPart[] = [];
    await writeAddonArchiveTo(
        entries,
        {
            write(chunk) {
                // Copy into an exact ArrayBuffer. `chunk.slice().buffer` can
                // expose a pooled buffer in Bun and corrupt the output.
                const copy = new Uint8Array(chunk.byteLength);
                copy.set(chunk);
                parts.push(copy);
            },
        },
        options
    );
    return new Blob(parts, { type: "application/zip" });
}

/** Stream an archive into a host-provided sink (file writer, HTTP response, ...). */
export async function writeAddonArchiveTo(
    entries: readonly AddonEntry[],
    sink: AddonArchiveSink,
    options: Omit<WriteAddonOptions, "type"> = {}
): Promise<void> {
    await writeArchive(entries, sink, options);
    await sink.end?.();
}

async function writeArchive(
    entries: readonly AddonEntry[],
    sink: AddonArchiveSink,
    options: Omit<WriteAddonOptions, "type">
): Promise<void> {
    const signal = options.signal;
    if (signal?.aborted) throw aborted();

    const maxBytes = options.maxBytes ?? DEFAULT_MAX_EXTRACTED_BYTES;
    const normalized = normalizeEntries(entries, maxBytes);
    if (normalized.length === 0) {
        throw new AddonError("ADDON_ARCHIVE_INVALID", "The addon has no files to write.");
    }
    const totalBytes = normalized.reduce((total, entry) => total + addonFileSize(entry), 0);

    let callbackError: Error | undefined;
    let resolveCompletion!: () => void;
    const completion = new Promise<void>((resolve) => {
        resolveCompletion = resolve;
    });
    const archive = new Zip((error, data, final) => {
        if (error) {
            callbackError = new AddonError(
                "ADDON_ARCHIVE_INVALID",
                `Unable to write the addon archive: ${error.message}.`
            );
            resolveCompletion();
            return;
        }
        if (data.byteLength > 0) {
            try {
                sink.write(data.slice());
            } catch (writeError) {
                callbackError =
                    writeError instanceof Error
                        ? writeError
                        : new AddonError(
                              "ADDON_ARCHIVE_INVALID",
                              `Unable to write addon data: ${String(writeError)}.`
                          );
            }
        }
        if (final) resolveCompletion();
    });

    let processedBytes = 0;
    const abort = (): never => {
        archive.terminate();
        throw aborted();
    };

    try {
        options.onProgress?.(0, totalBytes);
        for (const entry of normalized) {
            if (signal?.aborted) abort();

            const stream = (options.storedExtensions ?? DEFAULT_STORED_EXTENSIONS).test(entry.path)
                ? new ZipPassThrough(entry.path)
                : new ZipDeflate(entry.path, { level: options.level ?? 6 });
            if (options.mtime !== undefined) stream.mtime = options.mtime;
            archive.add(stream);

            const size = addonFileSize(entry);
            if (size === 0) {
                stream.push(new Uint8Array(), true);
                continue;
            }

            const chunkBytes = options.chunkBytes ?? DEFAULT_CHUNK_BYTES;
            for (let offset = 0; offset < size; offset += chunkBytes) {
                if (signal?.aborted) abort();
                const end = Math.min(offset + chunkBytes, size);
                const length = end - offset;
                const chunk = await entry.read(offset, length);
                if (signal?.aborted) abort();
                if (chunk.byteLength !== length) {
                    throw new AddonError(
                        "ADDON_ARCHIVE_INVALID",
                        `Source ${entry.path} returned ${chunk.byteLength} bytes, expected ${length}.`
                    );
                }
                stream.push(chunk, end === size);
                processedBytes += length;
                options.onProgress?.(processedBytes, totalBytes);
                if (end < size) await yieldToEventLoop();
                if (callbackError) throw callbackError;
            }
        }

        archive.end();
        await completion;
        if (callbackError) throw callbackError;
    } catch (error) {
        archive.terminate();
        throw error;
    }
}

function normalizeEntries(entries: readonly AddonEntry[], maxBytes: number): AddonSource[] {
    const paths = new Set<string>();
    let total = 0;
    const normalized = entries.map((entry) => {
        const path = normalizeArchivePath(entry.path);
        if (paths.has(path)) {
            throw new AddonError("ADDON_DUPLICATE_PATH", `Duplicate addon path: ${path}.`);
        }
        paths.add(path);

        const size = addonFileSize(entry);
        if (!Number.isSafeInteger(size) || size < 0) {
            throw new AddonError(
                "ADDON_ARCHIVE_INVALID",
                `Invalid size for ${path}: ${String(size)}.`
            );
        }
        total += size;
        if (total > maxBytes) {
            throw new AddonError(
                "ADDON_ARCHIVE_TOO_LARGE",
                `The addon content is larger than ${maxBytes} bytes.`
            );
        }
        return isAddonSource(entry) ? { ...entry, path } : sourceFromBytes(path, entry.bytes);
    });
    return normalized.sort((left, right) => left.path.localeCompare(right.path));
}

function joinChunks(chunks: readonly Uint8Array[], size: number): Uint8Array {
    if (chunks.length === 1) return chunks[0]!;
    if (chunks.length === 0) return new Uint8Array();
    const output = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
        output.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return output;
}

function aborted(): AddonError {
    return new AddonError("ADDON_ABORTED", "Addon export was aborted.");
}

function yieldToEventLoop(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}
