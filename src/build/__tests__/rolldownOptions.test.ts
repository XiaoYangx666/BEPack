import { afterEach, describe, expect, it } from "vitest";
import path from "node:path";
import os from "node:os";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { RolldownOptions, RolldownPlugin } from "rolldown";
import { normalizeConfig } from "../../config/normalizeConfig.js";
import type { BpCompileOptions, ResolvedConfig } from "../../config/configTypes.js";
import { mergeRolldownOptions, resolveRolldownOptions } from "../rolldownOptions.js";
import { runRolldown } from "../runRolldown.js";

const tempDirs: string[] = [];

afterEach(() => {
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

type CompileInput = Omit<Partial<BpCompileOptions>, "rolldown"> & {
    rolldown?: NonNullable<BpCompileOptions["rolldown"]>;
};

function makeProject(
    compile: CompileInput = {},
    entrySource = 'export const value = "ok";\n'
): { dir: string; config: ResolvedConfig } {
    const dir = mkdtempSync(path.join(os.tmpdir(), "bepack-rolldown-"));
    tempDirs.push(dir);
    mkdirSync(path.join(dir, "src"), { recursive: true });
    mkdirSync(path.join(dir, "bp"), { recursive: true });
    writeFileSync(path.join(dir, "src", "main.ts"), entrySource);

    const config = normalizeConfig(
        {
            root: dir,
            name: "test-addon",
            packs: {
                bp: {
                    root: "bp",
                    uuid: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                    moduleUuid: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
                    compile: { entry: "src/main.ts", ...compile },
                },
            },
        },
        {},
        dir
    );
    return { dir, config };
}

function write(dir: string, name: string, content: string): string {
    const file = path.join(dir, name);
    writeFileSync(file, content);
    return file;
}

// ---------------------------------------------------------------------------
// Merge rules
// ---------------------------------------------------------------------------

describe("mergeRolldownOptions", () => {
    it("appends plugins after the base plugins", () => {
        const base = { plugins: [{ name: "base" }] } as RolldownOptions;
        const merged = mergeRolldownOptions(base, {
            plugins: [{ name: "user" }],
        } as RolldownOptions);
        expect((merged.plugins as { name: string }[]).map((p) => p.name)).toEqual(["base", "user"]);
    });

    it("unions external and deduplicates strings", () => {
        const base = { external: ["a", /^b/] } as unknown as RolldownOptions;
        const merged = mergeRolldownOptions(base, {
            external: ["a", "c"],
        } as RolldownOptions);
        expect(merged.external).toEqual(["a", /^b/, "c"]);
    });

    it("merges transform.define key by key", () => {
        const base = { transform: { define: { A: "1", B: "2" } } } as RolldownOptions;
        const merged = mergeRolldownOptions(base, {
            transform: { define: { B: "22", C: "3" } },
        } as RolldownOptions);
        expect(merged.transform).toMatchObject({ define: { A: "1", B: "22", C: "3" } });
    });

    it("merges known object keys one level deep", () => {
        const base = {
            experimental: { attachDebugInfo: "simple", chunkOptimization: true },
        } as unknown as RolldownOptions;
        const merged = mergeRolldownOptions(base, {
            experimental: { attachDebugInfo: "none" },
        } as RolldownOptions) as { experimental: Record<string, unknown> };
        expect(merged.experimental).toEqual({
            attachDebugInfo: "none",
            chunkOptimization: true,
        });
    });

    it("replaces unknown scalar and array fields", () => {
        const base = { treeshake: true, moduleTypes: { ".txt": "text" } } as RolldownOptions;
        const merged = mergeRolldownOptions(base, {
            treeshake: false,
            preserveEntrySignatures: "strict",
        } as RolldownOptions);
        expect(merged.treeshake).toBe(false);
        expect(merged.preserveEntrySignatures).toBe("strict");
        // No explicit override → untouched
        expect(merged.moduleTypes).toEqual({ ".txt": "text" });
    });

    it("ignores undefined values", () => {
        const base = { treeshake: true } as RolldownOptions;
        const merged = mergeRolldownOptions(base, {
            treeshake: undefined,
        } as unknown as RolldownOptions);
        expect(merged.treeshake).toBe(true);
    });

    it("does not mutate the base options", () => {
        const base = { plugins: [{ name: "base" }] } as RolldownOptions;
        mergeRolldownOptions(base, { plugins: [{ name: "user" }] } as RolldownOptions);
        expect((base.plugins as unknown[]).length).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// Resolving the final options
// ---------------------------------------------------------------------------

describe("resolveRolldownOptions", () => {
    it("builds managed defaults when nothing is customized", async () => {
        const { dir, config } = makeProject();
        const { inputOptions, outputOptions } = await resolveRolldownOptions({ cwd: dir, config });

        expect(inputOptions.input).toBe(path.join(dir, "src", "main.ts"));
        expect(outputOptions).toMatchObject({
            dir: path.join(dir, "bp", "scripts"),
            format: "esm",
            preserveModules: true,
            entryFileNames: "[name].js",
        });
        // Manifest dependencies stay external, package-only ones do not
        const external = inputOptions.external as (string | RegExp)[];
        expect(external).toContainEqual(/^@minecraft\/server.*/);
        expect(external).toContain("@minecraft/server");
        expect(external).not.toContain("@minecraft/vanilla-data");
    });

    it("merges an inline options object", async () => {
        const { dir, config } = makeProject({
            rolldown: { resolve: { alias: { "@lib": "./src/lib" } }, treeshake: false },
        });
        const { inputOptions } = await resolveRolldownOptions({ cwd: dir, config });
        expect(inputOptions.resolve).toMatchObject({ alias: { "@lib": "./src/lib" } });
        expect(inputOptions.treeshake).toBe(false);
    });

    it("passes merged options and context to a customization function", async () => {
        let seenCommand: string | undefined;
        let seenEntry: string | undefined;
        let seenOutDir: string | undefined;
        let seenExternalCount = 0;

        const { dir, config } = makeProject({
            define: { __FLAG__: "true" },
            rolldown(options, context) {
                seenCommand = context.command;
                seenEntry = context.entry;
                seenOutDir = context.outDir;
                seenExternalCount = (options.external as unknown[]).length;
                return { resolve: { alias: { "@ctx": context.outDir } } };
            },
        });

        const { inputOptions } = await resolveRolldownOptions({
            cwd: dir,
            config,
            command: "dev",
            mode: "staging",
        });

        expect(seenCommand).toBe("dev");
        expect(seenEntry).toBe(path.join(dir, "src", "main.ts"));
        expect(seenOutDir).toBe(path.join(dir, "bp", "scripts"));
        // The function sees the BePack-generated options
        expect(seenExternalCount).toBeGreaterThan(0);
        expect(inputOptions.resolve).toMatchObject({
            alias: { "@ctx": path.join(dir, "bp", "scripts") },
        });
        // transform.define from compile.define survives
        expect(inputOptions.transform).toMatchObject({ define: { __FLAG__: "true" } });
    });

    it("merges output options without losing the managed location", async () => {
        const { dir, config } = makeProject({
            rolldown: { output: { sourcemap: true, banner: "// banner" } },
        });
        const { outputOptions } = await resolveRolldownOptions({ cwd: dir, config });
        expect(outputOptions).toMatchObject({
            dir: path.join(dir, "bp", "scripts"),
            sourcemap: true,
            banner: "// banner",
            format: "esm",
        });
    });

    it("rejects overriding the managed input", async () => {
        const { dir, config } = makeProject({ rolldown: { input: "src/other.ts" } });
        await expect(resolveRolldownOptions({ cwd: dir, config })).rejects.toMatchObject({
            code: "CONFIG_INVALID",
        });
    });

    it("accepts an input equal to the configured entry", async () => {
        const { dir, config } = makeProject({ rolldown: { input: "src/main.ts" } });
        const { inputOptions } = await resolveRolldownOptions({ cwd: dir, config });
        expect(inputOptions.input).toBe(path.join(dir, "src", "main.ts"));
    });

    it("rejects overriding the managed output location and format", async () => {
        const { dir, config } = makeProject({
            rolldown: { output: { dir: "bp/other" } },
        });
        await expect(resolveRolldownOptions({ cwd: dir, config })).rejects.toThrow(
            /cannot override "output\.dir"/
        );

        const { dir: dir2, config: config2 } = makeProject({
            rolldown: { output: { format: "cjs" } },
        });
        await expect(resolveRolldownOptions({ cwd: dir2, config: config2 })).rejects.toThrow(
            /cannot override "output\.format"/
        );
    });

    it("rejects an output array", async () => {
        const { dir, config } = makeProject({
            rolldown: { output: [{ dir: "a" }, { dir: "b" }] },
        });
        await expect(resolveRolldownOptions({ cwd: dir, config })).rejects.toThrow(
            /multiple outputs/
        );
    });
});

// ---------------------------------------------------------------------------
// Config files
// ---------------------------------------------------------------------------

describe("resolveRolldownOptions with a config file", () => {
    it("loads an .mjs config exporting an object", async () => {
        const { dir, config } = makeProject();
        write(dir, "custom.rolldown.mjs", `export default { treeshake: false };\n`);
        const customized = normalizeConfig(
            {
                root: dir,
                name: "test-addon",
                packs: {
                    bp: {
                        root: "bp",
                        uuid: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                        moduleUuid: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
                        compile: { entry: "src/main.ts", rolldownConfig: "custom.rolldown.mjs" },
                    },
                },
            },
            {},
            dir
        );
        expect(config.packs.bp!.compile!.rolldownConfig).toBeUndefined();

        const { inputOptions } = await resolveRolldownOptions({ cwd: dir, config: customized });
        expect(inputOptions.treeshake).toBe(false);
    });

    it("loads a .ts config exporting a function", async () => {
        const { dir } = makeProject();
        write(
            dir,
            "custom.rolldown.ts",
            `export default (options, context) => ({ resolve: { alias: { "@entry": context.entry } } });\n`
        );
        const config = normalizeConfig(
            {
                root: dir,
                name: "test-addon",
                packs: {
                    bp: {
                        root: "bp",
                        uuid: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                        moduleUuid: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
                        compile: { entry: "src/main.ts", rolldownConfig: "custom.rolldown.ts" },
                    },
                },
            },
            {},
            dir
        );

        const { inputOptions } = await resolveRolldownOptions({ cwd: dir, config });
        expect(inputOptions.resolve).toMatchObject({
            alias: { "@entry": path.join(dir, "src", "main.ts") },
        });
    });

    it("lets the config file win over the inline object", async () => {
        const { dir } = makeProject();
        write(dir, "override.mjs", `export default { treeshake: false };\n`);
        const config = normalizeConfig(
            {
                root: dir,
                name: "test-addon",
                packs: {
                    bp: {
                        root: "bp",
                        uuid: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                        moduleUuid: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
                        compile: {
                            entry: "src/main.ts",
                            rolldown: { treeshake: true, resolve: { alias: { "@a": "./a" } } },
                            rolldownConfig: "override.mjs",
                        },
                    },
                },
            },
            {},
            dir
        );

        const { inputOptions } = await resolveRolldownOptions({ cwd: dir, config });
        expect(inputOptions.treeshake).toBe(false);
        expect(inputOptions.resolve).toMatchObject({ alias: { "@a": "./a" } });
    });

    it("lets an explicit path (CLI --rolldown-config) replace the configured one", async () => {
        const { dir } = makeProject();
        write(dir, "from-config.mjs", `export default { treeshake: true };\n`);
        write(dir, "from-cli.mjs", `export default { treeshake: false };\n`);
        const config = normalizeConfig(
            {
                root: dir,
                name: "test-addon",
                packs: {
                    bp: {
                        root: "bp",
                        uuid: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                        moduleUuid: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
                        compile: { entry: "src/main.ts", rolldownConfig: "from-config.mjs" },
                    },
                },
            },
            {},
            dir
        );

        const { inputOptions } = await resolveRolldownOptions({
            cwd: dir,
            config,
            configPath: "from-cli.mjs",
        });
        expect(inputOptions.treeshake).toBe(false);
    });

    it("reports a missing config file", async () => {
        const { dir, config } = makeProject({ rolldownConfig: "nope.mjs" });
        await expect(resolveRolldownOptions({ cwd: dir, config })).rejects.toThrow(
            /config file not found/
        );
    });

    it("rejects multi-config and invalid exports", async () => {
        const { dir } = makeProject();
        write(dir, "multi.mjs", `export default [{ treeshake: true }, { treeshake: false }];\n`);
        write(dir, "invalid.mjs", `export default 42;\n`);

        const withConfig = (file: string) =>
            normalizeConfig(
                {
                    root: dir,
                    name: "test-addon",
                    packs: {
                        bp: {
                            root: "bp",
                            uuid: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                            moduleUuid: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
                            compile: { entry: "src/main.ts", rolldownConfig: file },
                        },
                    },
                },
                {},
                dir
            );

        await expect(
            resolveRolldownOptions({ cwd: dir, config: withConfig("multi.mjs") })
        ).rejects.toThrow(/builds a single behavior pack/);
        await expect(
            resolveRolldownOptions({ cwd: dir, config: withConfig("invalid.mjs") })
        ).rejects.toThrow(/must default-export/);
    });
});

// ---------------------------------------------------------------------------
// End-to-end through runRolldown
// ---------------------------------------------------------------------------

describe("runRolldown with custom rolldown options", () => {
    it("applies custom plugins and defines to the real output", async () => {
        const markerPlugin: RolldownPlugin = {
            name: "test-marker",
            transform(code, id) {
                if (!id.endsWith("main.ts")) return null;
                return { code: code.replaceAll("__MARKER__", JSON.stringify("replaced")) };
            },
        };

        const { dir, config } = makeProject(
            {
                rolldown: {
                    plugins: [markerPlugin],
                    transform: { define: { __FLAG__: JSON.stringify("flag-value") } },
                },
            },
            "export const marker = __MARKER__;\nexport const flag = __FLAG__;\n"
        );

        await runRolldown(dir, config, undefined, { command: "build" });

        const output = path.join(dir, "bp", "scripts", "main.js");
        expect(existsSync(output)).toBe(true);
        const code = readFileSync(output, "utf8");
        expect(code).toContain('"replaced"');
        expect(code).toContain("flag-value");
    });
});

// ---------------------------------------------------------------------------
// Config validation
// ---------------------------------------------------------------------------

describe("compile.rolldown config validation", () => {
    it("rejects a non-object, non-function rolldown value", () => {
        expect(() =>
            normalizeConfig({
                name: "test",
                packs: {
                    bp: {
                        root: "bp",
                        uuid: "a",
                        moduleUuid: "b",
                        compile: { entry: "src/main.ts", rolldown: 42 as never },
                    },
                },
            })
        ).toThrow(/packs\.bp\.compile\.rolldown must be/);
    });

    it("rejects an empty rolldownConfig path", () => {
        expect(() =>
            normalizeConfig({
                name: "test",
                packs: {
                    bp: {
                        root: "bp",
                        uuid: "a",
                        moduleUuid: "b",
                        compile: { entry: "src/main.ts", rolldownConfig: "  " },
                    },
                },
            })
        ).toThrow(/rolldownConfig must be a non-empty path/);
    });
});
