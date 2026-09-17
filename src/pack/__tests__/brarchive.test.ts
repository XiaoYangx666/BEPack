import { describe, expect, it } from "vitest";
import {
    BRARCHIVE_MAGIC,
    BRARCHIVE_VERSION,
    parseBrarchive,
    serializeBrarchive,
} from "../brarchive.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function viewOf(buffer: Uint8Array): DataView {
    return new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

describe("serializeBrarchive", () => {
    it("writes the documented v1 binary layout", () => {
        const buffer = serializeBrarchive([
            { name: "a.json", data: encoder.encode('{"a":1}') },
            { name: "b.js", data: encoder.encode("x;") },
        ]);

        expect(buffer.length).toBe(16 + 2 * 256 + 7 + 2);
        const view = viewOf(buffer);
        expect(view.getBigUint64(0, false)).toBe(BRARCHIVE_MAGIC);
        expect(view.getUint32(8, true)).toBe(2);
        expect(view.getUint32(12, true)).toBe(BRARCHIVE_VERSION);

        // First descriptor: 1-byte length, 247-byte name field, offset, length
        expect(view.getUint8(16)).toBe("a.json".length);
        expect(decoder.decode(buffer.subarray(17, 17 + 6))).toBe("a.json");
        expect(Array.from(buffer.subarray(23, 16 + 248))).toEqual(new Array(16 + 248 - 23).fill(0));
        expect(view.getUint32(16 + 248, true)).toBe(0);
        expect(view.getUint32(16 + 252, true)).toBe(7);

        // Second descriptor starts right after the first 256-byte slot
        expect(view.getUint32(16 + 256 + 248, true)).toBe(7);
        expect(view.getUint32(16 + 256 + 252, true)).toBe(2);

        // Content section starts after the descriptor table
        expect(decoder.decode(buffer.subarray(16 + 512, 16 + 512 + 7))).toBe('{"a":1}');
        expect(decoder.decode(buffer.subarray(16 + 512 + 7))).toBe("x;");
    });

    it("accepts a 247-byte name and rejects longer ones", () => {
        const maxName = "n".repeat(247);
        const buffer = serializeBrarchive([{ name: maxName, data: new Uint8Array(0) }]);
        expect(parseBrarchive(buffer)[0]!.name).toBe(maxName);

        expect(() =>
            serializeBrarchive([{ name: "n".repeat(248), data: new Uint8Array(0) }])
        ).toThrow(/too long/);
    });

    it("rejects empty names", () => {
        expect(() => serializeBrarchive([{ name: "", data: new Uint8Array(0) }])).toThrow(
            /must not be empty/
        );
    });

    it("supports empty content and binary entries", () => {
        const binary = new Uint8Array([0, 1, 2, 255]);
        const buffer = serializeBrarchive([
            { name: "empty.json", data: new Uint8Array(0) },
            { name: "blob.mcb", data: binary },
        ]);
        const entries = parseBrarchive(buffer);
        expect(entries.map((entry) => entry.name)).toEqual(["empty.json", "blob.mcb"]);
        expect(entries[0]!.data.length).toBe(0);
        expect(Array.from(entries[1]!.data)).toEqual([0, 1, 2, 255]);
    });
});

describe("parseBrarchive", () => {
    it("round-trips entries in order", () => {
        const entries = [
            { name: "manifest-stub.json", data: encoder.encode('{"format_version":2}') },
            { name: "zombie.json", data: encoder.encode('{"a":1}') },
        ];
        const parsed = parseBrarchive(serializeBrarchive(entries));
        expect(parsed.map((entry) => entry.name)).toEqual(entries.map((entry) => entry.name));
        expect(decoder.decode(parsed[1]!.data)).toBe('{"a":1}');
    });

    it("rejects a wrong magic number", () => {
        const buffer = serializeBrarchive([{ name: "a.json", data: new Uint8Array(0) }]);
        buffer[0] = 0;
        expect(() => parseBrarchive(buffer)).toThrow(/Not a brarchive/);
    });

    it("rejects an unsupported version", () => {
        const buffer = serializeBrarchive([{ name: "a.json", data: new Uint8Array(0) }]);
        viewOf(buffer).setUint32(12, 2, true);
        expect(() => parseBrarchive(buffer)).toThrow(/Unsupported brarchive version/);
    });

    it("rejects truncated input", () => {
        expect(() => parseBrarchive(new Uint8Array(8))).toThrow(/truncated/);

        const buffer = serializeBrarchive([{ name: "a.json", data: encoder.encode("{}") }]);
        expect(() => parseBrarchive(buffer.subarray(0, 20))).toThrow(/truncated/);
    });
});
