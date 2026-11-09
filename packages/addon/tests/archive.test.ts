import { describe, expect, it } from "vitest";
import {
    AddonError,
    readAddonArchive,
    sourceFromBlob,
    writeAddonArchiveTo,
    writeAddonBytes,
} from "../src/index.js";
import { encode, zip } from "./helpers.js";

describe("readAddonArchive", () => {
    it("round-trips bytes and normalizes paths", async () => {
        const bytes = await writeAddonBytes([
            { path: "a.txt", bytes: encode("A") },
            { path: "dir\\b.bin", bytes: new Uint8Array([1, 2, 3]) },
            { path: "empty.txt", bytes: new Uint8Array() },
        ]);
        const files = await readAddonArchive(bytes);
        expect(files.map((file) => file.path)).toEqual(["a.txt", "dir/b.bin", "empty.txt"]);
        expect(new TextDecoder().decode(files[0]!.bytes)).toBe("A");
    });

    it("reads Blob sources and reports progress", async () => {
        const source = sourceFromBlob("big.bin", new Blob([new Uint8Array(1024)]));
        const progress: number[] = [];
        const bytes = await writeAddonBytes([source], {
            onProgress(processed) {
                progress.push(processed);
            },
        });
        expect(bytes.byteLength).toBeGreaterThan(0);
        expect(progress[0]).toBe(0);
        expect(progress.at(-1)).toBe(1024);
        const files = await readAddonArchive(bytes);
        expect(files[0]!.bytes.byteLength).toBe(1024);
    });

    it("rejects unsafe paths", async () => {
        await expect(
            writeAddonBytes([{ path: "../evil.txt", bytes: encode("x") }])
        ).rejects.toMatchObject({ code: "ADDON_PATH_INVALID" });
    });

    it("rejects duplicate paths after normalization", async () => {
        await expect(
            writeAddonBytes([
                { path: "a/b.txt", bytes: encode("1") },
                { path: "a\\b.txt", bytes: encode("2") },
            ])
        ).rejects.toMatchObject({ code: "ADDON_DUPLICATE_PATH" });
    });

    it("rejects an empty archive", async () => {
        await expect(readAddonArchive(new Uint8Array())).rejects.toMatchObject({
            code: "ADDON_ARCHIVE_INVALID",
        });
    });

    it("rejects invalid zip data", async () => {
        await expect(readAddonArchive(encode("not a zip"))).rejects.toBeInstanceOf(AddonError);
    });

    it("enforces maxFiles", async () => {
        const bytes = zip({
            "a.txt": "a",
            "b.txt": "b",
        });
        await expect(readAddonArchive(bytes, { maxFiles: 1 })).rejects.toMatchObject({
            code: "ADDON_ARCHIVE_TOO_MANY_FILES",
        });
    });

    it("enforces maxArchiveBytes", async () => {
        const bytes = zip({ "a.txt": "a" });
        await expect(
            readAddonArchive(bytes, { maxArchiveBytes: bytes.byteLength - 1 })
        ).rejects.toMatchObject({ code: "ADDON_ARCHIVE_TOO_LARGE" });
    });

    it("aborts before writing", async () => {
        const controller = new AbortController();
        controller.abort();
        await expect(
            writeAddonBytes([{ path: "a.txt", bytes: encode("a") }], {
                signal: controller.signal,
            })
        ).rejects.toMatchObject({ code: "ADDON_ABORTED" });
    });
});

describe("writeAddonArchiveTo", () => {
    it("streams chunks to a sink and ends it", async () => {
        const chunks: Uint8Array[] = [];
        let ended = false;
        await writeAddonArchiveTo([{ path: "a.txt", bytes: encode("A") }], {
            write(chunk) {
                chunks.push(chunk);
            },
            end() {
                ended = true;
            },
        });
        expect(ended).toBe(true);
        const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
        const bytes = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) {
            bytes.set(chunk, offset);
            offset += chunk.byteLength;
        }
        const files = await readAddonArchive(bytes);
        expect(files[0]!.path).toBe("a.txt");
    });
});
