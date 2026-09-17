import { describe, expect, it } from "vitest";
import path from "node:path";
import os from "node:os";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { unzipSync } from "fflate";
import { normalizeConfig } from "../../config/normalizeConfig.js";
import { parseBrarchive } from "../../pack/brarchive.js";
import { packProject } from "../pack.js";

function manifest(minEngineVersion: number[] | string): string {
    return JSON.stringify({
        format_version: 2,
        header: {
            name: "Optimized",
            description: "",
            uuid: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
            version: [1, 0, 0],
            min_engine_version: minEngineVersion,
        },
        modules: [
            {
                type: "script",
                language: "javascript",
                uuid: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
                version: [1, 0, 0],
                entry: "scripts/main.js",
            },
        ],
    });
}

function makeOptimizableProject(minEngineVersion: number[] | string = [1, 26, 40]): string {
    const temp = mkdtempSync(path.join(os.tmpdir(), "bepack-pack-"));
    mkdirSync(path.join(temp, "bp", "entities"), { recursive: true });
    mkdirSync(path.join(temp, "bp", "scripts"), { recursive: true });
    writeFileSync(path.join(temp, "bp", "manifest.json"), manifest(minEngineVersion));
    writeFileSync(
        path.join(temp, "bp", "entities", "zombie.json"),
        '{ "minecraft:entity" : { "description": { "identifier": "test:zombie" } } }'
    );
    writeFileSync(path.join(temp, "bp", "scripts", "main.js"), "console.warn(1);\n");
    return temp;
}

function optimizedConfig(temp: string, optimize: boolean | Record<string, unknown> = true) {
    return normalizeConfig(
        {
            root: temp,
            name: "addon",
            packs: { bp: { root: "bp", uuid: "bp-uuid", moduleUuid: "module-uuid" } },
            pack: { outDir: "dist", optimize },
        },
        {},
        temp
    );
}

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

describe("packProject with pack.optimize", () => {
    it("replaces loose files with __brarchive archives inside the .mcpack", async () => {
        const temp = makeOptimizableProject();
        try {
            const output = await packProject(temp, optimizedConfig(temp));
            const zip = unzipSync(new Uint8Array(readFileSync(output)));
            const keys = Object.keys(zip).sort();

            expect(keys).toContain("__brarchive/entities.brarchive");
            expect(keys).toContain("__brarchive/scripts.brarchive");
            expect(keys).toContain("manifest.json");
            // Archived originals are dropped; only keep-loose folders are duplicated
            expect(keys).not.toContain("entities/zombie.json");
            expect(keys).not.toContain("scripts/main.js");

            const entries = parseBrarchive(zip["__brarchive/entities.brarchive"]!);
            expect(entries.map((entry) => entry.name)).toEqual(["zombie.json"]);
            expect(JSON.parse(new TextDecoder().decode(entries[0]!.data))).toEqual({
                "minecraft:entity": { description: { identifier: "test:zombie" } },
            });

            // The packaged manifest carries the switch that makes the engine read archives
            const manifest = JSON.parse(new TextDecoder().decode(zip["manifest.json"]!));
            expect(manifest.header.pack_optimization_version).toBe("0.1.0");

            // The project's own pack folder is never modified
            expect(existsSync(path.join(temp, "bp", "entities", "zombie.json"))).toBe(true);
        } finally {
            rmSync(temp, { recursive: true, force: true });
        }
    });

    it("keeps loose files when keepLooseFiles is enabled", async () => {
        const temp = makeOptimizableProject();
        try {
            const output = await packProject(temp, optimizedConfig(temp, { keepLooseFiles: true }));
            const keys = Object.keys(unzipSync(new Uint8Array(readFileSync(output))));
            expect(keys).toContain("entities/zombie.json");
            expect(keys).toContain("__brarchive/entities.brarchive");
        } finally {
            rmSync(temp, { recursive: true, force: true });
        }
    });

    it("optimizes even when min_engine_version predates archive support", async () => {
        const temp = makeOptimizableProject([1, 21, 0]);
        try {
            // The engine reads __brarchive regardless of min_engine_version
            // (Mojang's own vanilla pack declares [1,13,0]).
            const output = await packProject(temp, optimizedConfig(temp));
            const keys = Object.keys(unzipSync(new Uint8Array(readFileSync(output))));
            expect(keys).toContain("__brarchive/entities.brarchive");
        } finally {
            rmSync(temp, { recursive: true, force: true });
        }
    });

    it("lets --optimize enable optimization even when the config leaves it off", async () => {
        const temp = makeOptimizableProject();
        try {
            const output = await packProject(temp, optimizedConfig(temp, false), {
                optimize: true,
            });
            const keys = Object.keys(unzipSync(new Uint8Array(readFileSync(output))));
            expect(keys).toContain("__brarchive/entities.brarchive");
        } finally {
            rmSync(temp, { recursive: true, force: true });
        }
    });

    it("lets --no-optimize disable a configured pack.optimize", async () => {
        const temp = makeOptimizableProject();
        try {
            const output = await packProject(temp, optimizedConfig(temp), { optimize: false });
            const keys = Object.keys(unzipSync(new Uint8Array(readFileSync(output))));
            expect(keys).toContain("entities/zombie.json");
            expect(keys).not.toContain("__brarchive/entities.brarchive");
        } finally {
            rmSync(temp, { recursive: true, force: true });
        }
    });
});
