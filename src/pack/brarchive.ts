import { BePackError } from "../errors/BePackError.js";

/**
 * Minecraft: Bedrock Edition `.brarchive` container (format version 1).
 *
 * Binary layout (all multi-byte integers little-endian, magic stored big-endian):
 *
 * ```txt
 * 0   8  u64  magic 0x7D2725B1A0527026
 * 8   4  u32  entry count
 * 12  4  u32  format version (always 1)
 * 16  n*256    entry descriptors
 *        +0    u8   name length in bytes (0-247)
 *        +1    247  name, UTF-8, zero padded
 *        +248  u32  content offset, relative to the content section
 *        +252  u32  content length in bytes
 * rest      content section: entries concatenated in descriptor order
 * ```
 *
 * The format is uncompressed; it exists to bundle many small files into one, which
 * makes the surrounding `.mcpack` / `.mcaddon` compression more effective. Mojang's
 * pack optimizer produces the same layout under a pack's `__brarchive/` folder.
 */

/** Magic number as written to the file (read as a big-endian u64). */
export const BRARCHIVE_MAGIC = 0x7d2725b1a0527026n;

/** Only format version that exists. */
export const BRARCHIVE_VERSION = 1;

/** File extension, including the leading dot. */
export const BRARCHIVE_EXTENSION = ".brarchive";

const HEADER_SIZE = 16;
const ENTRY_SIZE = 256;
const NAME_FIELD_SIZE = 247;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export type BrarchiveEntry = {
    /** Entry name, e.g. `zombie.json`. Never contains a path separator. */
    name: string;
    /** Raw entry content. */
    data: Uint8Array;
};

/** Serialize entries into a `.brarchive` buffer. */
export function serializeBrarchive(entries: BrarchiveEntry[]): Uint8Array {
    const dataBase = HEADER_SIZE + entries.length * ENTRY_SIZE;
    let contentLength = 0;

    const encodedNames: Uint8Array[] = [];
    for (const entry of entries) {
        const name = textEncoder.encode(entry.name);
        if (name.length === 0) {
            throw new BePackError("PACK_FAILED", "brarchive entry names must not be empty.");
        }
        if (name.length > NAME_FIELD_SIZE) {
            throw new BePackError(
                "PACK_FAILED",
                `brarchive entry name is too long (max ${NAME_FIELD_SIZE} bytes): ${entry.name}`,
                { details: { name: entry.name, bytes: name.length } }
            );
        }
        encodedNames.push(name);
        contentLength += entry.data.length;
    }

    const buffer = new Uint8Array(dataBase + contentLength);
    const view = new DataView(buffer.buffer);
    view.setBigUint64(0, BRARCHIVE_MAGIC, false);
    view.setUint32(8, entries.length, true);
    view.setUint32(12, BRARCHIVE_VERSION, true);

    let offset = 0;
    entries.forEach((entry, index) => {
        const base = HEADER_SIZE + index * ENTRY_SIZE;
        const name = encodedNames[index]!;
        view.setUint8(base, name.length);
        buffer.set(name, base + 1);
        view.setUint32(base + 248, offset, true);
        view.setUint32(base + 252, entry.data.length, true);
        buffer.set(entry.data, dataBase + offset);
        offset += entry.data.length;
    });

    return buffer;
}

/** Parse a `.brarchive` buffer back into entries. */
export function parseBrarchive(buffer: Uint8Array): BrarchiveEntry[] {
    if (buffer.length < HEADER_SIZE) {
        throw new BePackError("PACK_FAILED", "brarchive is truncated: missing header.");
    }

    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const magic = view.getBigUint64(0, false);
    if (magic !== BRARCHIVE_MAGIC) {
        throw new BePackError(
            "PACK_FAILED",
            `Not a brarchive: expected magic 0x${BRARCHIVE_MAGIC.toString(16)}, got 0x${magic.toString(16)}.`
        );
    }

    const count = view.getUint32(8, true);
    const version = view.getUint32(12, true);
    if (version !== BRARCHIVE_VERSION) {
        throw new BePackError(
            "PACK_FAILED",
            `Unsupported brarchive version ${version} (expected ${BRARCHIVE_VERSION}).`
        );
    }

    const dataBase = HEADER_SIZE + count * ENTRY_SIZE;
    if (buffer.length < dataBase) {
        throw new BePackError("PACK_FAILED", "brarchive is truncated: entry table is incomplete.");
    }

    const entries: BrarchiveEntry[] = [];
    for (let index = 0; index < count; index++) {
        const base = HEADER_SIZE + index * ENTRY_SIZE;
        const nameLength = view.getUint8(base);
        const name = textDecoder.decode(buffer.subarray(base + 1, base + 1 + nameLength));
        const offset = view.getUint32(base + 248, true);
        const length = view.getUint32(base + 252, true);
        if (dataBase + offset + length > buffer.length) {
            throw new BePackError(
                "PACK_FAILED",
                `brarchive entry "${name}" points outside the content section.`,
                { details: { name, offset, length } }
            );
        }
        entries.push({
            name,
            data: buffer.subarray(dataBase + offset, dataBase + offset + length),
        });
    }

    return entries;
}
