import { describe, expect, it, vi } from "vitest";
import path from "node:path";
import os from "node:os";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import {
    findUnincludedEntries,
    packAuditIgnoreList,
    warnUnincludedPackEntries,
} from "../packIncludeAudit.js";
import { normalizeConfig } from "../../config/normalizeConfig.js";

function makePack(): string {
    const temp = mkdtempSync(path.join(os.tmpdir(), "bepack-include-"));
    mkdirSync(path.join(temp, "scripts"));
    writeFileSync(path.join(temp, "manifest.json"), "{}");
    writeFileSync(path.join(temp, "README_中文.md"), "docs");
    mkdirSync(path.join(temp, "custom_data"));
    mkdirSync(path.join(temp, ".hidden"));
    mkdirSync(path.join(temp, "node_modules"));
    return temp;
}

describe("findUnincludedEntries", () => {
    it("lists top-level entries the include list would drop", async () => {
        const temp = makePack();
        try {
            const skipped = await findUnincludedEntries(temp, ["scripts", "manifest.json"]);
            expect(skipped).toEqual(["custom_data", "README_中文.md"]);
        } finally {
            rmSync(temp, { recursive: true, force: true });
        }
    });

    it("ignores project files and explicitly ignored entries", async () => {
        const temp = makePack();
        try {
            writeFileSync(path.join(temp, "package.json"), "{}");
            writeFileSync(path.join(temp, "tsconfig.json"), "{}");
            mkdirSync(path.join(temp, "src"));

            const skipped = await findUnincludedEntries(
                temp,
                ["scripts", "manifest.json"],
                ["src"]
            );

            expect(skipped).toEqual(["custom_data", "README_中文.md"]);
        } finally {
            rmSync(temp, { recursive: true, force: true });
        }
    });

    it("returns nothing for a missing pack folder", async () => {
        await expect(findUnincludedEntries("/definitely/missing", ["scripts"])).resolves.toEqual(
            []
        );
    });
});

describe("warnUnincludedPackEntries", () => {
    it("warns with the names and the config key to fix it", async () => {
        const temp = makePack();
        try {
            const logger = {
                warn: vi.fn(),
                info: vi.fn(),
                error: vi.fn(),
                verbose: vi.fn(),
                clear: vi.fn(),
            };
            await warnUnincludedPackEntries({
                logger,
                packType: "bp",
                root: temp,
                items: ["scripts", "manifest.json"],
                action: "pack",
            });

            expect(logger.warn).toHaveBeenCalledOnce();
            const message = String(logger.warn.mock.calls[0]![0]);
            expect(message).toContain("README_中文.md");
            expect(message).toContain("custom_data");
            expect(message).toContain("packs.bp.include");
        } finally {
            rmSync(temp, { recursive: true, force: true });
        }
    });

    it("truncates long lists", async () => {
        const temp = mkdtempSync(path.join(os.tmpdir(), "bepack-include-"));
        try {
            for (let i = 0; i < 12; i += 1) {
                writeFileSync(path.join(temp, `file-${i}.txt`), "x");
            }
            const logger = {
                warn: vi.fn(),
                info: vi.fn(),
                error: vi.fn(),
                verbose: vi.fn(),
                clear: vi.fn(),
            };
            await warnUnincludedPackEntries({
                logger,
                packType: "bp",
                root: temp,
                items: [],
                action: "copy",
            });

            const message = String(logger.warn.mock.calls[0]![0]);
            expect(message).toContain("12 entries");
            expect(message).toContain("+4 more");
        } finally {
            rmSync(temp, { recursive: true, force: true });
        }
    });

    it("stays quiet when everything is included", async () => {
        const temp = makePack();
        try {
            const logger = {
                warn: vi.fn(),
                info: vi.fn(),
                error: vi.fn(),
                verbose: vi.fn(),
                clear: vi.fn(),
            };
            await warnUnincludedPackEntries({
                logger,
                packType: "bp",
                root: temp,
                items: ["scripts", "manifest.json", "README_中文.md", "custom_data"],
                action: "copy",
            });
            expect(logger.warn).not.toHaveBeenCalled();
        } finally {
            rmSync(temp, { recursive: true, force: true });
        }
    });
});

describe("packAuditIgnoreList", () => {
    it("ignores src/ and the pack output dir when the BP root is the project root", () => {
        const temp = mkdtempSync(path.join(os.tmpdir(), "bepack-include-"));
        try {
            mkdirSync(path.join(temp, "src"));
            mkdirSync(path.join(temp, "dist"));
            writeFileSync(path.join(temp, "bepack.config.mjs"), "");
            const config = normalizeConfig(
                {
                    root: temp,
                    name: "addon",
                    packs: {
                        bp: {
                            root: ".",
                            uuid: "a",
                            moduleUuid: "b",
                            compile: { entry: "src/main.ts" },
                        },
                    },
                    pack: { outDir: "dist" },
                },
                {},
                temp
            );

            expect(packAuditIgnoreList(temp, config, "bp").sort()).toEqual(["dist", "src"]);
        } finally {
            rmSync(temp, { recursive: true, force: true });
        }
    });

    it("ignores nothing when the pack root is a dedicated folder", () => {
        const temp = mkdtempSync(path.join(os.tmpdir(), "bepack-include-"));
        try {
            const config = normalizeConfig(
                {
                    root: temp,
                    name: "addon",
                    packs: { bp: { root: "bp", uuid: "a", moduleUuid: "b" } },
                    pack: { outDir: "dist" },
                },
                {},
                temp
            );

            expect(packAuditIgnoreList(temp, config, "bp")).toEqual([]);
        } finally {
            rmSync(temp, { recursive: true, force: true });
        }
    });
});
