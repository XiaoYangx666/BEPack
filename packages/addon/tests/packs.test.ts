import { describe, expect, it } from "vitest";
import { AddonError, classifyManifest, discoverPacks, type Manifest } from "../src/index.js";
import { bytesMap, makeManifest } from "./helpers.js";

function dataOnlyManifest(name: string): Manifest {
    return {
        format_version: 2,
        header: {
            name,
            description: "",
            uuid: "11111111-1111-4111-8111-111111111111",
            version: [1, 0, 0],
        },
    };
}

describe("discoverPacks", () => {
    it("classifies packs by module type", () => {
        const packs = discoverPacks(
            bytesMap({
                "bp/manifest.json": makeManifest("bp"),
                "rp/manifest.json": makeManifest("rp"),
            })
        );
        expect(packs.bp?.root).toBe("bp/");
        expect(packs.rp?.root).toBe("rp/");
    });

    it("classifies data-only packs by path", () => {
        const packs = discoverPacks(
            bytesMap({
                "behavior_packs/test/manifest.json": dataOnlyManifest("BP"),
                "resource_packs/test/manifest.json": dataOnlyManifest("RP"),
            })
        );
        expect(packs.bp?.manifestPath).toBe("behavior_packs/test/manifest.json");
        expect(packs.rp?.manifestPath).toBe("resource_packs/test/manifest.json");
    });

    it("supports explicit roots for unusual folder names", () => {
        const packs = discoverPacks(
            bytesMap({
                "behavior/manifest.json": dataOnlyManifest("BP"),
                "resource/manifest.json": dataOnlyManifest("RP"),
            }),
            { bpRoot: "behavior", rpRoot: "resource" }
        );
        expect(packs.bp?.root).toBe("behavior/");
        expect(packs.rp?.root).toBe("resource/");
    });

    it("skips a missing explicit root when allowMissing is set", () => {
        const packs = discoverPacks(
            bytesMap({
                "rp/manifest.json": makeManifest("rp"),
            }),
            { bpRoot: "bp", rpRoot: "rp", allowMissing: true }
        );
        expect(packs.bp).toBeUndefined();
        expect(packs.rp?.manifestPath).toBe("rp/manifest.json");
    });

    it("throws for a missing explicit root by default", () => {
        expect(() =>
            discoverPacks(bytesMap({ "rp/manifest.json": makeManifest("rp") }), {
                bpRoot: "bp",
            })
        ).toThrow(AddonError);
    });

    it("throws when no manifest exists", () => {
        expect(() => discoverPacks(bytesMap({ "bp/scripts/main.js": "" }))).toThrow(AddonError);
    });

    it("throws for duplicate packs of the same kind", () => {
        expect(() =>
            discoverPacks(
                bytesMap({
                    "one/manifest.json": makeManifest("bp"),
                    "two/manifest.json": makeManifest("bp"),
                })
            )
        ).toThrow(AddonError);
    });

    it("throws when a root manifest cannot be classified", () => {
        expect(() =>
            discoverPacks(bytesMap({ "manifest.json": dataOnlyManifest("Unknown") }))
        ).toThrow(AddonError);
    });

    it("returns an empty result with allowMissing when nothing exists", () => {
        const packs = discoverPacks(bytesMap({ "readme.txt": "hi" }), {
            allowMissing: true,
        });
        expect(packs.bp).toBeUndefined();
        expect(packs.rp).toBeUndefined();
    });
});

describe("classifyManifest", () => {
    it("prefers modules over paths", () => {
        expect(classifyManifest(makeManifest("rp"), "bp/manifest.json")).toBe("rp");
    });

    it("throws when script and resources modules are both present", () => {
        const manifest = makeManifest("bp", {
            modules: [
                { type: "script", uuid: "22222222-2222-4222-8222-222222222222" },
                { type: "resources", uuid: "44444444-4444-4444-8444-444444444444" },
            ],
        });
        expect(() => classifyManifest(manifest, "bp/manifest.json")).toThrow(AddonError);
    });
});

describe("archive manifest parsing", () => {
    it("rejects invalid JSON", () => {
        expect(() => discoverPacks(bytesMap({ "bp/manifest.json": "{ nope" }))).toThrow(AddonError);
    });
});
