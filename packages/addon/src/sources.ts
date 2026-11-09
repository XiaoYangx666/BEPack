import { AddonError } from "./core/errors.js";

/** A fully loaded file inside an addon. */
export interface AddonFileData {
    readonly path: string;
    /** Treat as read-only; callers must not mutate the returned buffer. */
    readonly bytes: Uint8Array;
}

/**
 * A lazily readable archive entry. Hosts can back this with a `Blob`, a file
 * handle, or a generated stream without loading it into memory.
 */
export interface AddonSource {
    readonly path: string;
    readonly size: number;
    /** Must return exactly `length` bytes unless the end of the source is reached. */
    read(offset: number, length: number): Promise<Uint8Array>;
}

export type AddonEntry = AddonFileData | AddonSource;

export function isAddonSource(entry: AddonEntry): entry is AddonSource {
    return typeof (entry as Partial<AddonSource>).read === "function";
}

export function addonFileSize(entry: AddonEntry): number {
    return isAddonSource(entry) ? entry.size : entry.bytes.byteLength;
}

export function sourceFromBytes(path: string, bytes: Uint8Array): AddonSource {
    return {
        path,
        size: bytes.byteLength,
        read(offset, length) {
            return Promise.resolve(bytes.subarray(offset, offset + length));
        },
    };
}

export function sourceFromBlob(path: string, blob: Blob): AddonSource {
    return {
        path,
        size: blob.size,
        async read(offset, length) {
            return new Uint8Array(await blob.slice(offset, offset + length).arrayBuffer());
        },
    };
}

export function toAddonSource(entry: AddonEntry): AddonSource {
    return isAddonSource(entry) ? entry : sourceFromBytes(entry.path, entry.bytes);
}

/** Materialize a lazy source. Prefer the archive writer for large entries. */
export async function readSource(source: AddonSource): Promise<Uint8Array> {
    if (source.size === 0) return new Uint8Array();
    const output = new Uint8Array(source.size);
    const chunkBytes = 256 * 1024;
    let offset = 0;
    while (offset < source.size) {
        const end = Math.min(offset + chunkBytes, source.size);
        const chunk = await source.read(offset, end - offset);
        if (chunk.byteLength !== end - offset) {
            throw new AddonError(
                "ADDON_ARCHIVE_INVALID",
                `Source ${source.path} returned ${chunk.byteLength} bytes, expected ${end - offset}.`
            );
        }
        output.set(chunk, offset);
        offset = end;
    }
    return output;
}
