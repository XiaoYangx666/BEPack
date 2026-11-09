import { describe, expect, it } from "vitest";
import {
    AddonError,
    applyIdentity,
    coerceVersionForFormat,
    generateUuid,
    isUuid,
    parseVersion,
    readIdentity,
    type AddonPacks,
    type ManifestVersion,
} from "../src/index.js";
import { BP_HEADER, BP_MODULE, RP_HEADER, RP_MODULE, makeManifest } from "./helpers.js";

const NEW_BP_HEADER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const NEW_BP_MODULE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NEW_RP_HEADER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const NEW_RP_MODULE = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

function packs(formatVersion: 2 | 3 = 2): AddonPacks {
    return {
        bp: {
            kind: "bp",
            root: "bp/",
            manifestPath: "bp/manifest.json",
            manifest: makeManifest("bp", {}, formatVersion),
        },
        rp: {
            kind: "rp",
            root: "rp/",
            manifestPath: "rp/manifest.json",
            manifest: makeManifest("rp", {}, formatVersion),
        },
    };
}

describe("version handling", () => {
    it("parses format 2 tuples and format 3 strings", () => {
        expect(parseVersion([1, 2, 3], 2, "version")).toEqual([1, 2, 3]);
        expect(parseVersion("1.2.3", 3, "version")).toBe("1.2.3");
        expect(() => parseVersion("1.2.3", 2, "version")).toThrow(AddonError);
        expect(() => parseVersion([1, 2, 3], 3, "version")).toThrow(AddonError);
    });

    it("rejects out-of-range tuple parts", () => {
        expect(() => parseVersion([1, 2, 70_000], 2, "version")).toThrow(AddonError);
        expect(() => parseVersion([1, 2, 3.5], 2, "version")).toThrow(AddonError);
    });

    it("converts between formats", () => {
        expect(coerceVersionForFormat([2, 3, 4], 3)).toBe("2.3.4");
        expect(coerceVersionForFormat("2.3.4", 2)).toEqual([2, 3, 4]);
        expect(coerceVersionForFormat("2.3.4", 3)).toBe("2.3.4");
        expect(coerceVersionForFormat([2, 3, 4], 2)).toEqual([2, 3, 4]);
    });
});

describe("uuid handling", () => {
    it("generates valid v4 UUIDs", () => {
        const uuid = generateUuid();
        expect(isUuid(uuid)).toBe(true);
        expect(uuid).toBe(uuid.toLowerCase());
        expect(generateUuid()).not.toBe(uuid);
    });
});

describe("readIdentity", () => {
    it("reads the behavior pack identity by default", () => {
        const identity = readIdentity(packs());
        expect(identity.name).toBe("Test BP");
        expect(identity.version).toEqual([1, 0, 0]);
        expect(identity.behaviorPack?.headerUuid).toBe(BP_HEADER);
        expect(identity.behaviorPack?.moduleUuids).toEqual([BP_MODULE]);
        expect(identity.resourcePack?.headerUuid).toBe(RP_HEADER);
        expect(identity.resourcePack?.moduleUuids).toEqual([RP_MODULE]);
    });

    it("falls back to the resource pack when there is no behavior pack", () => {
        const all = packs();
        const identity = readIdentity({ rp: all.rp! });
        expect(identity.name).toBe("Test RP");
        expect(identity.behaviorPack).toBeUndefined();
        expect(identity.resourcePack?.headerUuid).toBe(RP_HEADER);
    });
});

describe("applyIdentity", () => {
    it("updates names, versions, UUIDs, and cross-pack dependencies", () => {
        const all = packs();
        const result = applyIdentity(all, {
            name: "New Pack",
            description: "New description",
            version: [2, 3, 4],
            randomizeUuids: true,
        });

        const bp = all.bp!;
        const rp = all.rp!;

        expect(bp.manifest.header?.name).toBe("New Pack");
        expect(rp.manifest.header?.name).toBe("New Pack");
        expect(bp.manifest.header?.description).toBe("New description");
        expect(bp.manifest.header?.version).toEqual([2, 3, 4]);
        expect(rp.manifest.header?.version).toEqual([2, 3, 4]);

        expect(bp.manifest.header?.uuid).not.toBe(BP_HEADER);
        expect(rp.manifest.header?.uuid).not.toBe(RP_HEADER);
        expect(bp.manifest.modules?.[0]?.uuid).not.toBe(BP_MODULE);
        expect(rp.manifest.modules?.[0]?.uuid).not.toBe(RP_MODULE);

        expect(bp.manifest.dependencies?.[0]).toMatchObject({
            uuid: rp.manifest.header?.uuid,
            version: [2, 3, 4],
        });
        expect(rp.manifest.dependencies?.[0]).toMatchObject({
            uuid: bp.manifest.header?.uuid,
            version: [2, 3, 4],
        });

        expect(result.uuidMap.get(BP_HEADER)).toBe(bp.manifest.header?.uuid);
        expect(result.uuidMap.get(RP_HEADER)).toBe(rp.manifest.header?.uuid);
        expect(result.identity.name).toBe("New Pack");
    });

    it("preserves unknown manifest fields and module versions by default", () => {
        const all = packs();
        applyIdentity(all, { name: "Renamed", version: [2, 0, 0] });
        expect(all.bp!.manifest.metadata).toEqual({ custom: true });
        expect(all.bp!.manifest.header?.custom_header).toBe("keep");
        expect(all.bp!.manifest.modules?.[0]?.version).toEqual([1, 0, 0]);
    });

    it("updates module versions when requested", () => {
        const all = packs();
        applyIdentity(all, { version: [2, 0, 0], updateModuleVersions: true });
        expect(all.bp!.manifest.modules?.[0]?.version).toEqual([2, 0, 0]);
        expect(all.rp!.manifest.modules?.[0]?.version).toEqual([2, 0, 0]);
    });

    it("uses pack-specific names and descriptions", () => {
        const all = packs();
        applyIdentity(all, {
            name: "Shared",
            resourceName: "Shared (RP)",
            behaviorDescription: "BP desc",
            resourceDescription: "RP desc",
        });
        expect(all.bp!.manifest.header?.name).toBe("Shared");
        expect(all.rp!.manifest.header?.name).toBe("Shared (RP)");
        expect(all.bp!.manifest.header?.description).toBe("BP desc");
        expect(all.rp!.manifest.header?.description).toBe("RP desc");
    });

    it("converts versions to each manifest's format", () => {
        const all = packs(3);
        applyIdentity(all, { version: [2, 3, 4] });
        expect(all.bp!.manifest.header?.version).toBe("2.3.4");
        expect(all.rp!.manifest.header?.version).toBe("2.3.4");
        expect((all.bp!.manifest.dependencies?.[0] as { version: ManifestVersion }).version).toBe(
            "2.3.4"
        );
    });

    it("accepts explicit UUIDs", () => {
        const all = packs();
        applyIdentity(all, {
            behaviorHeaderUuid: NEW_BP_HEADER,
            behaviorModuleUuids: [NEW_BP_MODULE],
            resourceHeaderUuid: NEW_RP_HEADER,
            resourceModuleUuids: [NEW_RP_MODULE],
        });
        expect(all.bp!.manifest.header?.uuid).toBe(NEW_BP_HEADER);
        expect(all.bp!.manifest.modules?.[0]?.uuid).toBe(NEW_BP_MODULE);
        expect(all.rp!.manifest.header?.uuid).toBe(NEW_RP_HEADER);
        expect(all.rp!.manifest.dependencies?.[0]).toMatchObject({ uuid: NEW_BP_HEADER });
    });

    it("rejects duplicate UUIDs across packs", () => {
        const all = packs();
        expect(() =>
            applyIdentity(all, {
                behaviorHeaderUuid: NEW_BP_HEADER,
                resourceHeaderUuid: NEW_BP_HEADER,
            })
        ).toThrow(AddonError);
    });

    it("rejects an explicit module UUID count that does not match", () => {
        const all = packs();
        expect(() =>
            applyIdentity(all, {
                behaviorModuleUuids: [],
            })
        ).toThrow(AddonError);
    });

    it("rejects empty names", () => {
        const all = packs();
        expect(() => applyIdentity(all, { name: "   " })).toThrow(AddonError);
    });

    it("rejects non-array dependencies", () => {
        const all = packs();
        (all.bp!.manifest as Record<string, unknown>).dependencies = {};
        expect(() => readIdentity(all)).toThrow(AddonError);
    });
});
