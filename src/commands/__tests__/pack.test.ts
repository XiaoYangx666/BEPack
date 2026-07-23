import { describe, expect, it } from "vitest";
import path from "node:path";
import os from "node:os";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { normalizeConfig } from "../../config/normalizeConfig.js";
import { packProject } from "../pack.js";

describe("packProject", () => {
    it("allows dist output inside a project-root BP when it is not included", async () => {
        const temp = mkdtempSync(path.join(os.tmpdir(), "bepack-pack-"));
        try {
            writeFileSync(path.join(temp, "manifest.json"), "{}");
            const config = normalizeConfig(
                {
                    root: temp,
                    name: "addon",
                    packs: { bp: { root: ".", uuid: "bp-uuid", moduleUuid: "module-uuid" } },
                    pack: { outDir: "dist" },
                },
                {},
                temp
            );

            const result = await packProject(temp, config);
            expect(result).toBe(path.join(temp, "dist", "addon-1.0.0.mcpack"));
        } finally {
            rmSync(temp, { recursive: true, force: true });
        }
    });

    it("refuses output inside an RP-only pack", async () => {
        const temp = mkdtempSync(path.join(os.tmpdir(), "bepack-pack-"));
        try {
            const config = normalizeConfig(
                {
                    root: temp,
                    name: "addon",
                    packs: { rp: { root: "rp", uuid: "rp-uuid", moduleUuid: "module-uuid" } },
                    pack: { outDir: "rp" },
                },
                {},
                temp
            );

            await expect(packProject(temp, config)).rejects.toMatchObject({ code: "PACK_FAILED" });
        } finally {
            rmSync(temp, { recursive: true, force: true });
        }
    });

    it("refuses an output name that escapes pack.outDir", async () => {
        const temp = mkdtempSync(path.join(os.tmpdir(), "bepack-pack-"));
        try {
            const config = normalizeConfig(
                {
                    root: temp,
                    name: "addon",
                    packs: { rp: { root: "rp", uuid: "rp-uuid", moduleUuid: "module-uuid" } },
                    pack: { name: "../escape", outDir: "dist" },
                },
                {},
                temp
            );

            await expect(packProject(temp, config)).rejects.toMatchObject({ code: "PACK_FAILED" });
        } finally {
            rmSync(temp, { recursive: true, force: true });
        }
    });
});
