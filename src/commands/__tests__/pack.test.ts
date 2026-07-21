import { describe, expect, it } from "vitest";
import path from "node:path";
import os from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { normalizeConfig } from "../../config/normalizeConfig.js";
import { packProject } from "../pack.js";

describe("packProject", () => {
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
