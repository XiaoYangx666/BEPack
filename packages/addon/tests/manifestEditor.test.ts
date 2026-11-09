import { describe, expect, it } from "vitest";
import { AddonError, readAddon, type ManifestDependency } from "../src/index.js";
import { BP_HEADER, BP_MODULE, RP_HEADER, RP_MODULE, makeAddon } from "./helpers.js";

describe("ManifestEditor", () => {
    it("edits, validates, and saves a pack manifest", async () => {
        const addon = await readAddon(makeAddon());
        const bp = addon.manifest("bp");

        bp.setName("Edited BP")
            .setDescription("Edited description")
            .setVersion([2, 3, 4])
            .setMinEngineVersion([1, 21, 0])
            .addDependency({ module_name: "@minecraft/server", version: "2.0.0" })
            .setCapability("pbr")
            .setMetadata("product_type", "addon")
            .validate()
            .save();

        const reopened = await readAddon(await addon.toBytes());
        const manifest = reopened.packs.bp!.manifest;
        expect(manifest.header?.name).toBe("Edited BP");
        expect(manifest.header?.description).toBe("Edited description");
        expect(manifest.header?.version).toEqual([2, 3, 4]);
        expect(manifest.header?.custom_header).toBe("keep");
        expect(manifest.dependencies).toContainEqual({
            module_name: "@minecraft/server",
            version: "2.0.0",
        });
        expect(manifest.capabilities).toEqual(["pbr"]);
        expect(manifest.metadata).toMatchObject({ custom: true, product_type: "addon" });
    });

    it("keeps editing the refreshed manifest after save", async () => {
        const addon = await readAddon(makeAddon());
        const bp = addon.manifest("bp");

        bp.addDependency({ module_name: "@minecraft/server", version: "1.0.0" }).save();
        bp.addDependency({ module_name: "@minecraft/server", version: "2.0.0" }).save();

        const reopened = await readAddon(await addon.toBytes());
        const dependencies = (reopened.packs.bp!.manifest.dependencies ?? []).filter(
            (entry) => (entry as { module_name?: string }).module_name === "@minecraft/server"
        );
        expect(dependencies).toHaveLength(1);
        expect(dependencies[0]).toMatchObject({ version: "2.0.0" });
    });

    it("converts versions to the manifest format", async () => {
        const addon = await readAddon(makeAddon({ formatVersion: 3 }));
        const bp = addon.manifest("bp");

        bp.setVersion([2, 0, 0])
            .addDependency({ uuid: RP_MODULE, version: [1, 2, 3] })
            .addModule({
                type: "script",
                uuid: "55555555-5555-4555-8555-555555555555",
                version: [1, 0, 0],
                entry: "scripts/extra.js",
            });

        expect(bp.manifest.header?.version).toBe("2.0.0");
        expect(bp.dependency({ uuid: RP_MODULE })).toMatchObject({ version: "1.2.3" });
        expect(bp.module("script")?.version).toBe("1.0.0");
    });

    it("removes dependencies and modules", async () => {
        const addon = await readAddon(makeAddon());
        const bp = addon.manifest("bp");

        expect(bp.removeDependency({ uuid: RP_HEADER })).toBe(1);
        expect(bp.removeDependency({ module_name: "missing" })).toBe(0);
        expect(bp.removeModule("script")).toBe(1);
        expect(bp.modules()).toEqual([]);
    });

    it("replaces a dependency with the same key", async () => {
        const addon = await readAddon(makeAddon());
        const bp = addon.manifest("bp");

        bp.addDependency({ module_name: "@minecraft/server", version: "1.0.0" });
        bp.addDependency({ module_name: "@minecraft/server", version: "3.0.0" });

        const matches = bp
            .dependencies()
            .filter(
                (entry) => (entry as { module_name?: string }).module_name === "@minecraft/server"
            );
        expect(matches).toHaveLength(1);
        expect(matches[0]).toMatchObject({ version: "3.0.0" });
    });

    it("can keep an existing dependency", async () => {
        const addon = await readAddon(makeAddon());
        const bp = addon.manifest("bp");

        bp.addDependency({ module_name: "@minecraft/server", version: "1.0.0" });
        bp.addDependency(
            { module_name: "@minecraft/server", version: "9.0.0" },
            { keepExisting: true }
        );

        expect(bp.dependency({ module_name: "@minecraft/server" })).toMatchObject({
            version: "1.0.0",
        });
    });

    it("rejects ambiguous dependencies and module/header UUID collisions", async () => {
        const addon = await readAddon(makeAddon());
        const bp = addon.manifest("bp");

        expect(() =>
            bp.addDependency({
                module_name: "@minecraft/server",
                uuid: RP_MODULE,
                version: [1, 0, 0],
            } as unknown as ManifestDependency)
        ).toThrow(AddonError);

        expect(() => bp.addModule({ type: "script", uuid: BP_HEADER, version: [1, 0, 0] })).toThrow(
            /already used by the pack header/
        );
    });

    it("toggles capabilities", async () => {
        const addon = await readAddon(makeAddon());
        const bp = addon.manifest("bp");

        bp.setCapability("pbr");
        expect(bp.hasCapability("pbr")).toBe(true);
        bp.setCapability("pbr", false);
        expect(bp.hasCapability("pbr")).toBe(false);
        expect(bp.manifest.capabilities).toBeUndefined();
    });

    it("applies a structured patch", async () => {
        const addon = await readAddon(makeAddon({ formatVersion: 2 }));
        const bp = addon.manifest("bp");

        bp.patch({
            format_version: 3,
            header: { version: [1, 2, 3], min_engine_version: [1, 21, 0] },
            metadata: { custom: null, product_type: "addon" },
            capabilities: ["pbr", "pbr", "script_eval"],
        });

        const manifest = bp.manifest;
        expect(bp.formatVersion).toBe(3);
        expect(manifest.header?.version).toBe("1.2.3");
        expect(manifest.header?.min_engine_version).toBe("1.21.0");
        expect(manifest.metadata).toEqual({ product_type: "addon" });
        expect(manifest.capabilities).toEqual(["pbr", "script_eval"]);
        expect((manifest.dependencies?.[0] as { version?: unknown }).version).toBe("1.0.0");
    });

    it("reports invalid manifests on validate", async () => {
        const addon = await readAddon(makeAddon());
        const bp = addon.manifest("bp");
        bp.manifest.header!.name = "";
        expect(() => bp.validate()).toThrow(/header.name/);
    });

    it("writes the requested indentation", async () => {
        const addon = await readAddon(makeAddon());
        addon.manifest("bp").setName("Indented").save({ indent: 4 });
        expect(addon.readTextSync("bp/manifest.json")).toContain('\n    "header"');
    });

    it("edits the resource pack independently", async () => {
        const addon = await readAddon(makeAddon());
        const rp = addon.manifest("rp");
        rp.setName("Edited RP").setDescription("RP only").save();

        const reopened = await readAddon(await addon.toBytes());
        expect(reopened.packs.rp?.manifest.header?.name).toBe("Edited RP");
        expect(reopened.packs.bp?.manifest.header?.name).toBe("Test BP");
    });

    it("throws when the pack is missing", async () => {
        const addon = await readAddon(makeAddon({ rp: null }));
        expect(() => addon.manifest("rp")).toThrow(AddonError);
    });

    it("exposes the manifest path and current module UUIDs", async () => {
        const addon = await readAddon(makeAddon());
        const bp = addon.manifest("bp");
        expect(bp.manifestPath).toBe("bp/manifest.json");
        expect(bp.module(BP_MODULE)).toMatchObject({ type: "script" });
    });
});
