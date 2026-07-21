import { describe, expect, it } from "vitest";
import path from "node:path";
import os from "node:os";
import { existsSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { normalizeConfig } from "../../config/normalizeConfig.js";
import { copyPacks } from "../copyPacks.js";

describe("copyPacks", () => {
    it("refuses a destination that is the source pack itself", async () => {
        const temp = mkdtempSync(path.join(os.tmpdir(), "bepack-copy-"));
        try {
            mkdirSync(path.join(temp, "bp"));
            const config = normalizeConfig(
                {
                    root: temp,
                    name: "bp",
                    packs: { bp: { root: "bp", uuid: "bp-uuid" } },
                    copy: {
                        defaultTarget: "same",
                        targets: { same: { type: "custom", bp: temp } },
                    },
                },
                {},
                temp
            );

            await expect(copyPacks(temp, config)).rejects.toMatchObject({ code: "COPY_FAILED" });
            expect(existsSync(path.join(temp, "bp"))).toBe(true);
        } finally {
            rmSync(temp, { recursive: true, force: true });
        }
    });

    it("refuses a configured folder name that escapes the copy target", async () => {
        const temp = mkdtempSync(path.join(os.tmpdir(), "bepack-copy-"));
        try {
            const source = path.join(temp, "bp");
            const target = path.join(temp, "target");
            mkdirSync(source);
            mkdirSync(target);
            const config = normalizeConfig(
                {
                    root: temp,
                    name: "bp",
                    packs: { bp: { root: "bp", uuid: "bp-uuid" } },
                    copy: {
                        defaultTarget: "dev",
                        name: "../outside-target",
                        targets: { dev: { type: "custom", bp: target } },
                    },
                },
                {},
                temp
            );

            await expect(copyPacks(temp, config, undefined, true)).rejects.toMatchObject({
                code: "COPY_FAILED",
            });
            expect(existsSync(source)).toBe(true);
            expect(existsSync(target)).toBe(true);
        } finally {
            rmSync(temp, { recursive: true, force: true });
        }
    });
});
