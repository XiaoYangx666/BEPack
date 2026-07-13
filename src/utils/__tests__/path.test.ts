import { describe, it, expect } from "vitest";
import path from "node:path";
import {
    validateScriptOutputDir,
    ensureSafeEmptyDir,
    containsPath,
    getBpIncludeItems,
    getGeneratedScriptDirRelative,
    deduplicatePaths,
} from "../path.js";
import type { ResolvedConfig } from "../../config/configTypes.js";
import { normalizeConfig } from "../../config/normalizeConfig.js";

// ---------------------------------------------------------------------------
// validateScriptOutputDir
// ---------------------------------------------------------------------------

describe("validateScriptOutputDir", () => {
    const bpRoot = "/project/bp";

    it('rejects "."', () => {
        expect(() => validateScriptOutputDir(bpRoot, ".")).toThrow(
            "must be a non-empty relative path"
        );
    });

    it('rejects ".."', () => {
        expect(() => validateScriptOutputDir(bpRoot, "..")).toThrow('must not contain ".."');
    });

    it('rejects "../outside"', () => {
        expect(() => validateScriptOutputDir(bpRoot, "../outside")).toThrow(
            'must not contain ".."'
        );
    });

    it("rejects absolute POSIX paths", () => {
        expect(() => validateScriptOutputDir(bpRoot, "/etc")).toThrow("must be a relative path");
    });

    it("rejects absolute Windows paths", () => {
        expect(() => validateScriptOutputDir(bpRoot, "C:\\Windows")).toThrow(
            "must be a relative path"
        );
    });

    it("rejects empty string", () => {
        expect(() => validateScriptOutputDir(bpRoot, "")).toThrow(
            "must be a non-empty relative path"
        );
    });

    it('accepts "scripts"', () => {
        expect(validateScriptOutputDir(bpRoot, "scripts")).toBe("scripts");
    });

    it('accepts "custom/scripts"', () => {
        expect(validateScriptOutputDir(bpRoot, "custom/scripts")).toBe("custom/scripts");
    });

    it('normalizes "./scripts" to "scripts"', () => {
        expect(validateScriptOutputDir(bpRoot, "./scripts")).toBe("scripts");
    });

    it('normalizes "foo/../scripts" to "scripts"', () => {
        expect(validateScriptOutputDir(bpRoot, "foo/../scripts")).toBe("scripts");
    });

    it('normalizes "foo\\\\..\\\\scripts" (backslash) to "scripts"', () => {
        // Backslash is normalized to forward slash BEFORE validation
        expect(validateScriptOutputDir(bpRoot, "foo\\..\\scripts")).toBe("scripts");
    });

    it('normalizes "foo\\\\bar" to "foo/bar"', () => {
        expect(validateScriptOutputDir(bpRoot, "foo\\bar")).toBe("foo/bar");
    });

    it("rejects deeply nested escape", () => {
        expect(() => validateScriptOutputDir(bpRoot, "a/b/../../../../escape")).toThrow(
            'must not contain ".."'
        );
    });

    it("rejects output dir equal to source dir (containsPath match)", () => {
        const srcDir = path.resolve(bpRoot, "src");
        expect(() => validateScriptOutputDir(bpRoot, "src", srcDir)).toThrow(
            "dangerously overlaps"
        );
    });

    it("rejects output dir that is parent of source dir", () => {
        const srcDir = path.resolve(bpRoot, "generated/src");
        expect(() => validateScriptOutputDir(bpRoot, "generated", srcDir)).toThrow(
            "dangerously overlaps"
        );
    });

    it("allows output dir sibling of source dir", () => {
        const srcDir = path.resolve("/project", "src");
        expect(() => validateScriptOutputDir(bpRoot, "scripts", srcDir)).not.toThrow();
    });

    it("allows output dir inside source dir (subdir)", () => {
        const srcDir = path.resolve(bpRoot, "src");
        expect(() => validateScriptOutputDir(bpRoot, "src/build", srcDir)).not.toThrow();
    });
});

// ---------------------------------------------------------------------------
// containsPath
// ---------------------------------------------------------------------------

describe("containsPath", () => {
    it("parent equals child", () => {
        expect(containsPath("/a/b", "/a/b")).toBe(true);
    });
    it("parent is ancestor", () => {
        expect(containsPath("/a/b", "/a/b/c")).toBe(true);
    });
    it("child is ancestor of parent", () => {
        expect(containsPath("/a/b/c", "/a/b")).toBe(false);
    });
    it("unrelated paths", () => {
        expect(containsPath("/a", "/b")).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// ensureSafeEmptyDir (containsPath-based)
// ---------------------------------------------------------------------------

describe("ensureSafeEmptyDir", () => {
    const bpRoot = "/project/bp";

    it("allows valid subdirectory", () => {
        expect(() => ensureSafeEmptyDir("/project/bp/scripts", bpRoot, "test")).not.toThrow();
    });

    it("rejects bp root (protected path equality)", () => {
        expect(() => ensureSafeEmptyDir("/project/bp", bpRoot, "test")).toThrow("protected path");
    });

    it("rejects output dir that contains protected path (hook-modified scenario)", () => {
        // output=bp/generated, protected=bp/generated/src
        expect(() =>
            ensureSafeEmptyDir("/project/bp/generated", bpRoot, "test", [
                "/project/bp/generated/src",
            ])
        ).toThrow("protected path");
    });

    it("rejects path outside bp root", () => {
        expect(() => ensureSafeEmptyDir("/tmp/evil", bpRoot, "test")).toThrow("not inside");
    });
});

// ---------------------------------------------------------------------------
// getGeneratedScriptDirRelative
// ---------------------------------------------------------------------------

describe("getGeneratedScriptDirRelative", () => {
    function makeConfig(scriptOutputDir?: string): ResolvedConfig {
        const bp: ResolvedConfig["packs"]["bp"] = {
            root: "bp",
            uuid: "a",
            moduleUuid: "b",
            name: "Test",
            dependencies: {},
            include: [],
        };
        if (scriptOutputDir) {
            bp.compile = {
                entry: "src/main.ts",
                tsconfig: "tsconfig.json",
                typecheck: true,
                preserveModules: true,
                external: [],
                useNpx: false,
                minify: false,
                cache: { dev: true, build: false, file: "cache.json" },
                scriptOutputDir,
            };
        }
        return {
            root: ".",
            configured: { root: false, packOutDir: false },
            name: "test",
            version: "1.0.0",
            target: "latest",
            hooks: {},
            packs: { bp },
            install: {
                registry: "",
                saveTo: "dependencies" as const,
                packageManager: "auto" as const,
                runPackageManager: true,
                updatePackageJson: true,
                updateManifest: true,
                dependencyCatalog: {},
                dependencyResolvers: [],
            },
            build: { copy: false, timing: false },
            dev: { copy: false },
            copy: { defaultTarget: "", targets: {} },
            pack: { name: "{name}-{version}", outDir: "dist" },
        } as ResolvedConfig;
    }

    it("defaults to scripts", () => {
        expect(getGeneratedScriptDirRelative(makeConfig())).toBe("scripts");
    });
    it("custom dir", () => {
        expect(getGeneratedScriptDirRelative(makeConfig("generated/scripts"))).toBe(
            "generated/scripts"
        );
    });
});

// ---------------------------------------------------------------------------
// getBpIncludeItems
// ---------------------------------------------------------------------------

describe("getBpIncludeItems", () => {
    function makeConfig(
        opts: { scriptOutputDir?: string; include?: string[] } = {}
    ): ResolvedConfig {
        return {
            root: ".",
            configured: { root: false, packOutDir: false },
            name: "test",
            version: "1.0.0",
            target: "latest",
            hooks: {},
            packs: {
                bp: {
                    root: "bp",
                    uuid: "a",
                    name: "Test",
                    dependencies: {},
                    include: opts.include ?? [],
                    compile: {
                        entry: "src/main.ts",
                        tsconfig: "tsconfig.json",
                        typecheck: true,
                        preserveModules: true,
                        external: [],
                        useNpx: false,
                        minify: false,
                        cache: { dev: true, build: false, file: "cache.json" },
                        scriptOutputDir: opts.scriptOutputDir ?? "scripts",
                    },
                } as ResolvedConfig["packs"]["bp"],
            },
            install: {
                registry: "",
                saveTo: "dependencies" as const,
                packageManager: "auto" as const,
                runPackageManager: true,
                updatePackageJson: true,
                updateManifest: true,
                dependencyCatalog: {},
                dependencyResolvers: [],
            },
            build: { copy: false, timing: false },
            dev: { copy: false },
            copy: { defaultTarget: "", targets: {} },
            pack: { name: "{name}-{version}", outDir: "dist" },
        } as ResolvedConfig;
    }

    it("default items contain scripts", () => {
        expect(getBpIncludeItems(makeConfig())).toContain("scripts");
    });
    it("custom dir replaces scripts", () => {
        const items = getBpIncludeItems(makeConfig({ scriptOutputDir: "build_scripts" }));
        expect(items).toContain("build_scripts");
        expect(items).not.toContain("scripts");
    });
    it("deduplicates", () => {
        const items = getBpIncludeItems(makeConfig({ include: ["scripts"] }));
        expect(items.filter((i) => i === "scripts")).toHaveLength(1);
    });
});

// ---------------------------------------------------------------------------
// deduplicatePaths
// ---------------------------------------------------------------------------

describe("deduplicatePaths", () => {
    it("removes duplicates preserving order", () => {
        expect(deduplicatePaths(["/z", "/a", "/z", "/b"])).toEqual(["/z", "/a", "/b"]);
    });
    it("handles empty", () => {
        expect(deduplicatePaths([])).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// normalizeConfig integration
// ---------------------------------------------------------------------------

describe("normalizeConfig scriptOutputDir integration", () => {
    it("default survives", () => {
        const cfg = normalizeConfig({
            name: "test",
            packs: {
                bp: { root: "bp", uuid: "a", moduleUuid: "b", compile: { entry: "src/main.ts" } },
            },
        });
        expect(cfg.packs.bp!.compile!.scriptOutputDir).toBe("scripts");
    });

    it('normalizes "./scripts"', () => {
        const cfg = normalizeConfig({
            name: "test",
            packs: {
                bp: {
                    root: "bp",
                    uuid: "a",
                    moduleUuid: "b",
                    compile: { entry: "src/main.ts", scriptOutputDir: "./scripts" },
                },
            },
        });
        expect(cfg.packs.bp!.compile!.scriptOutputDir).toBe("scripts");
    });

    it("rejects overlapping source dir (bp root = project root)", () => {
        expect(() =>
            normalizeConfig({
                name: "test",
                packs: {
                    bp: {
                        root: ".",
                        uuid: "a",
                        moduleUuid: "b",
                        compile: { entry: "src/main.ts", scriptOutputDir: "src" },
                    },
                },
            })
        ).toThrow("dangerously overlaps");
    });

    it("allows non-overlapping config with custom dir", () => {
        const cfg = normalizeConfig({
            name: "test",
            packs: {
                bp: {
                    root: "bp",
                    uuid: "a",
                    moduleUuid: "b",
                    compile: { entry: "src/main.ts", scriptOutputDir: "generated/scripts" },
                },
            },
        });
        expect(cfg.packs.bp!.compile!.scriptOutputDir).toBe("generated/scripts");
    });
});
