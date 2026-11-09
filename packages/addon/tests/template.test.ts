import { describe, expect, it } from "vitest";
import {
    AddonError,
    AddonTemplate,
    readAddon,
    sourceFromBlob,
    writeAddonBytes,
    writeAddonTo,
    type AddonEntry,
} from "../src/index.js";
import { BP_HEADER, RP_HEADER, encode, makeAddon, makeManifest, zip } from "./helpers.js";

describe("readAddon", () => {
    it("discovers packs and reads identity", async () => {
        const addon = await readAddon(makeAddon());
        expect(addon.packs.bp?.root).toBe("bp/");
        expect(addon.packs.rp?.root).toBe("rp/");
        expect(addon.identity().name).toBe("Test BP");
        expect(addon.fileCount).toBe(4);
        expect(addon.totalBytes).toBeGreaterThan(0);
    });

    it("accepts a Blob", async () => {
        const bytes = makeAddon();
        const addon = await readAddon(new Blob([bytes.buffer as ArrayBuffer]));
        expect(addon.packs.bp?.manifestPath).toBe("bp/manifest.json");
    });

    it("reads text and lazy sources", async () => {
        const addon = await readAddon(
            makeAddon({
                files: {
                    "rp/textures/lazy.bin": new Uint8Array([9, 9, 9]),
                },
            })
        );
        expect(addon.readTextSync("bp/scripts/main.js")).toContain(BP_HEADER);
        const file = await addon.read("rp/textures/lazy.bin");
        expect(file?.bytes).toEqual(new Uint8Array([9, 9, 9]));
    });

    it("throws when reading a lazy source synchronously", () => {
        const addon = new AddonTemplate("test.mcaddon", [
            { path: "bp/manifest.json", bytes: encode(makeManifest("bp")) },
            sourceFromBlob("rp/textures/lazy.bin", new Blob([new Uint8Array([1])])),
        ]);
        expect(() => addon.readSync("rp/textures/lazy.bin")).toThrow(AddonError);
    });
});

describe("updateIdentity", () => {
    it("writes updated manifests back into the archive", async () => {
        const addon = await readAddon(makeAddon());
        const result = addon.updateIdentity({
            name: "Generated Pack",
            description: "Generated",
            version: [2, 3, 4],
            randomizeUuids: true,
        });

        expect(result.identity.name).toBe("Generated Pack");
        expect(result.uuidMap.get(BP_HEADER)).toBeTruthy();

        const bytes = await addon.toBytes();
        const reopened = await readAddon(bytes);
        expect(reopened.identity().name).toBe("Generated Pack");
        expect(reopened.identity().version).toEqual([2, 3, 4]);
        expect(reopened.packs.bp?.manifest.header?.uuid).not.toBe(BP_HEADER);
        expect(reopened.packs.bp?.manifest.dependencies?.[0]).toMatchObject({
            uuid: reopened.packs.rp?.manifest.header?.uuid,
        });
    });

    it("preserves the format 3 version representation", async () => {
        const addon = await readAddon(makeAddon({ formatVersion: 3 }));
        addon.updateIdentity({ version: [2, 0, 0] });
        const reopened = await readAddon(await addon.toBytes());
        expect(reopened.identity().version).toBe("2.0.0");
    });

    it("allows hosts to keep their manifest indentation", async () => {
        const addon = await readAddon(makeAddon());
        addon.updateIdentity({ name: "Indented" }, { indent: 4 });
        expect(addon.readTextSync("bp/manifest.json")).toContain('\n    "header"');
    });
});

describe("replace", () => {
    it("replaces exact paths and prefixes", async () => {
        const addon = await readAddon(makeAddon());
        addon.replace({
            exactPaths: ["rp/textures/test.png"],
            prefixes: ["bp/scripts/"],
            files: [
                { path: "bp/scripts/main.js", bytes: encode("export const generated = 1;\n") },
                { path: "rp/textures/test.png", bytes: new Uint8Array([7, 7]) },
            ],
        });
        expect(addon.readTextSync("bp/scripts/main.js")).toContain("generated");
        expect(addon.readSync("rp/textures/test.png")?.bytes).toEqual(new Uint8Array([7, 7]));
        expect(addon.has("bp/scripts/main.js")).toBe(true);
    });

    it("refreshes packs when a manifest is replaced", async () => {
        const addon = await readAddon(makeAddon());
        const renamed = makeManifest("bp", {
            header: { name: "Replaced BP" },
        });
        addon.replace({
            exactPaths: ["bp/manifest.json"],
            files: [{ path: "bp/manifest.json", bytes: encode(renamed) }],
        });
        expect(addon.packs.bp?.manifest.header?.name).toBe("Replaced BP");
        expect(addon.identity().name).toBe("Replaced BP");
    });

    it("removes trees", async () => {
        const addon = await readAddon(makeAddon());
        addon.removeTree("rp/textures");
        expect(addon.has("rp/textures/test.png")).toBe(false);
        expect(addon.packs.rp?.manifestPath).toBe("rp/manifest.json");
    });

    it("rejects duplicate generated paths", async () => {
        const addon = await readAddon(makeAddon());
        expect(() =>
            addon.replace({
                prefixes: ["bp/scripts/"],
                files: [
                    { path: "bp/scripts/a.js", bytes: encode("a") },
                    { path: "bp/scripts/a.js", bytes: encode("b") },
                ],
            })
        ).toThrow(AddonError);
    });
});

describe("writing", () => {
    it("writes a Blob and a stream", async () => {
        const addon = await readAddon(makeAddon());
        const blob = await addon.toBlob();
        expect(blob.type).toBe("application/zip");
        expect(blob.size).toBeGreaterThan(0);

        const chunks: Uint8Array[] = [];
        await addon.toSink({
            write(chunk) {
                chunks.push(chunk);
            },
        });
        expect(chunks.length).toBeGreaterThan(0);

        const exported: Uint8Array[] = [];
        await writeAddonTo(addon, {
            write(chunk) {
                exported.push(chunk);
            },
        });
        expect(exported.length).toBeGreaterThan(0);
    });

    it("round-trips external lazy sources", async () => {
        const entries: AddonEntry[] = [
            { path: "bp/manifest.json", bytes: encode(makeManifest("bp")) },
            { path: "rp/manifest.json", bytes: encode(makeManifest("rp")) },
            sourceFromBlob("rp/sounds/large.ogg", new Blob([new Uint8Array(2048)])),
        ];
        const bytes = await writeAddonBytes(entries);
        const reopened = await readAddon(bytes);
        expect(reopened.has("rp/sounds/large.ogg")).toBe(true);
        expect(reopened.totalBytes).toBeGreaterThan(2048);
    });

    it("reads a manually built zip", async () => {
        const bytes = zip({
            "bp/manifest.json": makeManifest("bp"),
            "rp/manifest.json": makeManifest("rp"),
        });
        const addon = await readAddon(bytes);
        expect(addon.packs.bp?.manifestPath).toBe("bp/manifest.json");
        expect(addon.packs.rp?.manifestPath).toBe("rp/manifest.json");
        expect(addon.packs.bp?.manifest.header?.uuid).toBe(BP_HEADER);
        expect(addon.packs.rp?.manifest.header?.uuid).toBe(RP_HEADER);
    });
});
