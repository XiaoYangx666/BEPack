import { describe, it, expect } from "vitest";
import { ManifestBuilder } from "../ManifestBuilder.js";
import { ManifestDepManager } from "../ManifestDepManager.js";
import { validateManifest } from "../validate.js";
import { createDependencyCatalog } from "../../install/dependencyCatalog.js";
import { versionToString, parseVersionToTuple } from "../../commands/init.js";
import type { Manifest, ManifestVersion } from "../types.js";
import type { ResolvedConfig } from "../../config/configTypes.js";

// ---------------------------------------------------------------------------
// 测试辅助
// ---------------------------------------------------------------------------

function baseConfig(overrides?: Partial<ResolvedConfig>): ResolvedConfig {
    return {
        root: ".",
        configured: {
            root: false,
            buildEntry: false,
            bpRoot: false,
            rpRoot: false,
            packOutDir: false,
        },
        name: "test-addon",
        version: "1.0.0",
        target: "latest",
        hooks: {},
        packs: {
            bp: {
                root: "bp",
                uuid: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                moduleUuid: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
                name: "Test BP",
                dependencies: {},
            },
        },
        install: {
            registry: "https://registry.npmjs.org/",
            saveTo: "dependencies" as const,
            packageManager: "auto" as const,
            runPackageManager: true,
            updatePackageJson: true,
            updateManifest: true,
            dependencyCatalog: {},
            dependencyResolvers: [],
        },
        build: {
            entry: "src/main.ts",
            typecheck: true,
            copy: false,
            preserveModules: true,
            external: [],
            externalDependencies: true,
            useNpx: false,
            minify: false,
            timing: false,
        },
        dev: { copy: false },
        copy: { defaultTarget: "win", targets: {} },
        pack: { name: "{name}-{version}", outDir: "dist" },
        ...overrides,
    };
}

function createBuilder(
    config: ResolvedConfig,
    resolvedDeps?: Record<string, string>
): ManifestBuilder {
    const catalog = createDependencyCatalog(config);
    const depManager = new ManifestDepManager(config, catalog, resolvedDeps);
    return new ManifestBuilder(config, depManager);
}

// ---------------------------------------------------------------------------
// 1. ManifestBuilder format_version 输出
// ---------------------------------------------------------------------------

describe("ManifestBuilder format_version 行为", () => {
    it("无 config + 无 existing → 默认 format_version 2", () => {
        const builder = createBuilder(baseConfig());
        const manifest = builder.buildBp();
        expect(manifest.format_version).toBe(2);
    });

    it("保留 existing.format_version = 3", () => {
        const builder = createBuilder(baseConfig());
        const manifest = builder.buildBp({ format_version: 3 } as Manifest);
        expect(manifest.format_version).toBe(3);
    });

    it("保留 existing.format_version = 3（RP）", () => {
        const config = baseConfig({
            packs: {
                bp: { root: "bp", uuid: "a", moduleUuid: "b", name: "BP", dependencies: {} },
                rp: { root: "rp", uuid: "c", moduleUuid: "d", name: "RP" },
            },
        });
        const builder = createBuilder(config);
        const manifest = builder.buildRp({ format_version: 3 } as Manifest);
        expect(manifest.format_version).toBe(3);
    });

    it("config.manifestFormat=2 → 强制 format_version 2（覆盖 existing 3）", () => {
        const builder = createBuilder(baseConfig({ manifestFormat: 2 }));
        const manifest = builder.buildBp({ format_version: 3 } as Manifest);
        expect(manifest.format_version).toBe(2);
    });

    it("config.manifestFormat=3 → 强制 format_version 3（覆盖 existing 2）", () => {
        const builder = createBuilder(baseConfig({ manifestFormat: 3 }));
        const manifest = builder.buildBp({ format_version: 2 } as Manifest);
        expect(manifest.format_version).toBe(3);
    });

    it("config.manifestFormat=3 + 无 existing → format_version 3", () => {
        const builder = createBuilder(baseConfig({ manifestFormat: 3 }));
        const manifest = builder.buildBp();
        expect(manifest.format_version).toBe(3);
    });

    it("config 不设 + existing 2 → 保持 2", () => {
        const builder = createBuilder(baseConfig());
        const manifest = builder.buildBp({ format_version: 2 } as Manifest);
        expect(manifest.format_version).toBe(2);
    });
});

// ---------------------------------------------------------------------------
// 2. ManifestBuilder min_engine_version 保留
// ---------------------------------------------------------------------------

describe("ManifestBuilder min_engine_version 处理", () => {
    it("无 existing → 默认 [1, 21, 0]", () => {
        const manifest = createBuilder(baseConfig()).buildBp();
        expect(manifest.header!.min_engine_version).toEqual([1, 21, 0]);
    });

    it("保留 existing 数组型 min_engine_version（format 2）", () => {
        const builder = createBuilder(baseConfig());
        const manifest = builder.buildBp({
            format_version: 2,
            header: { min_engine_version: [1, 20, 0] as ManifestVersion },
        } as Manifest);
        expect(manifest.header!.min_engine_version).toEqual([1, 20, 0]);
    });

    it("保留 existing 字符串型 min_engine_version（format 3）", () => {
        const builder = createBuilder(baseConfig());
        const manifest = builder.buildBp({
            format_version: 3,
            header: { min_engine_version: "1.26.30" },
        } as Manifest);
        expect(manifest.header!.min_engine_version).toBe("1.26.30");
    });

    it("format 2 时字符串 min_engine_version 自动转数组", () => {
        const builder = createBuilder(baseConfig());
        const manifest = builder.buildBp({
            format_version: 2,
            header: { min_engine_version: "1.26.30" },
        } as Manifest);
        expect(manifest.header!.min_engine_version).toEqual([1, 26, 30]);
    });

    it("config.manifestFormat=2 时字符串转数组", () => {
        const builder = createBuilder(baseConfig({ manifestFormat: 2 }));
        const manifest = builder.buildBp({
            format_version: 3,
            header: { min_engine_version: "1.26.30" },
        } as Manifest);
        expect(manifest.header!.min_engine_version).toEqual([1, 26, 30]);
    });

    it("config.manifestFormat=3 保留字符串", () => {
        const builder = createBuilder(baseConfig({ manifestFormat: 3 }));
        const manifest = builder.buildBp({
            format_version: 3,
            header: { min_engine_version: "1.26.30" },
        } as Manifest);
        expect(manifest.header!.min_engine_version).toBe("1.26.30");
    });

    it("config.manifestFormat=3 也保留数组", () => {
        const builder = createBuilder(baseConfig({ manifestFormat: 3 }));
        const manifest = builder.buildBp({
            format_version: 2,
            header: { min_engine_version: [1, 20, 0] as ManifestVersion },
        } as Manifest);
        // format 3 接受数组 → 保留原样
        expect(manifest.header!.min_engine_version).toEqual([1, 20, 0]);
    });
});

// ---------------------------------------------------------------------------
// 3. validateManifest — format-aware 版本校验
// ---------------------------------------------------------------------------

describe("validateManifest format-aware 校验", () => {
    const validHeader = {
        name: "Test",
        uuid: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    };

    const validModules = [
        {
            type: "script",
            language: "javascript",
            uuid: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
            version: [1, 0, 0] as ManifestVersion,
            entry: "main.js",
        },
    ];

    it("format 2 + 数组版本 → 通过", () => {
        const manifest: Manifest = {
            format_version: 2,
            header: { ...validHeader, version: [1, 0, 0], min_engine_version: [1, 21, 0] },
            modules: validModules,
        };
        expect(() => validateManifest(manifest, "bp")).not.toThrow();
    });

    it("format 2 + 字符串版本 → 拒绝", () => {
        const manifest: Manifest = {
            format_version: 2,
            header: { ...validHeader, version: "1.0.0", min_engine_version: [1, 21, 0] },
            modules: validModules,
        };
        expect(() => validateManifest(manifest, "bp")).toThrow(
            "header.version must be [number, number, number] (format 2)"
        );
    });

    it("format 2 + 字符串 min_engine_version → 拒绝", () => {
        const manifest: Manifest = {
            format_version: 2,
            header: { ...validHeader, version: [1, 0, 0], min_engine_version: "1.21.0" },
            modules: validModules,
        };
        expect(() => validateManifest(manifest, "bp")).toThrow(
            "header.min_engine_version must be [number, number, number] (format 2)"
        );
    });

    it("format 3 + 数组版本 → 通过", () => {
        const manifest: Manifest = {
            format_version: 3,
            header: { ...validHeader, version: [1, 0, 0], min_engine_version: [1, 21, 0] },
            modules: validModules,
        };
        expect(() => validateManifest(manifest, "bp")).not.toThrow();
    });

    it("format 3 + 字符串版本 → 通过", () => {
        const manifest: Manifest = {
            format_version: 3,
            header: { ...validHeader, version: "1.0.0", min_engine_version: "1.21.0" },
            modules: validModules,
        };
        expect(() => validateManifest(manifest, "bp")).not.toThrow();
    });

    it("format 3 + 混合（数组 version + 字符串 min_engine）→ 通过", () => {
        const manifest: Manifest = {
            format_version: 3,
            header: { ...validHeader, version: [1, 0, 0], min_engine_version: "1.21.0" },
            modules: validModules,
        };
        expect(() => validateManifest(manifest, "bp")).not.toThrow();
    });

    it("format 2 + uuid dep 字符串版本 → 拒绝", () => {
        const manifest: Manifest = {
            format_version: 2,
            header: { ...validHeader, version: [1, 0, 0], min_engine_version: [1, 21, 0] },
            modules: validModules,
            dependencies: [{ uuid: "c", version: "1.0.0" }],
        };
        expect(() => validateManifest(manifest, "bp")).toThrow(
            "version must be [number, number, number] (format 2)"
        );
    });

    it("format 3 + uuid dep 字符串版本 → 通过", () => {
        const manifest: Manifest = {
            format_version: 3,
            header: { ...validHeader, version: [1, 0, 0], min_engine_version: [1, 21, 0] },
            modules: validModules,
            dependencies: [{ uuid: "c", version: "1.0.0" }],
        };
        expect(() => validateManifest(manifest, "bp")).not.toThrow();
    });

    it("format 3 + uuid dep 数组版本 → 通过", () => {
        const manifest: Manifest = {
            format_version: 3,
            header: { ...validHeader, version: [1, 0, 0], min_engine_version: [1, 21, 0] },
            modules: validModules,
            dependencies: [{ uuid: "c", version: [1, 0, 0] as ManifestVersion }],
        };
        expect(() => validateManifest(manifest, "bp")).not.toThrow();
    });

    it("format 无值时按 strict（format 2 规则）校验", () => {
        const manifest: Manifest = {
            // 没有 format_version
            header: { ...validHeader, version: [1, 0, 0], min_engine_version: [1, 21, 0] },
            modules: validModules,
        };
        expect(() => validateManifest(manifest, "bp")).toThrow("format_version is required");
    });
});

// ---------------------------------------------------------------------------
// 4. versionToString — 兼容两种格式
// ---------------------------------------------------------------------------

describe("versionToString 兼容性", () => {
    it("数组 [1, 2, 3] → '1.2.3'", () => {
        expect(versionToString([1, 2, 3])).toBe("1.2.3");
    });

    it("字符串 '1.2.3' → '1.2.3'", () => {
        expect(versionToString("1.2.3")).toBe("1.2.3");
    });

    it("undefined → undefined", () => {
        expect(versionToString(undefined)).toBeUndefined();
    });

    it("null → undefined", () => {
        expect(versionToString(null)).toBeUndefined();
    });

    it("空数组 [] → ''", () => {
        expect(versionToString([])).toBe("");
    });

    it("非法类型（number）→ undefined", () => {
        expect(versionToString(42)).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// 5. parseVersionToTuple
// ---------------------------------------------------------------------------

describe("parseVersionToTuple", () => {
    it("数组 [1, 2, 3] → [1, 2, 3]", () => {
        expect(parseVersionToTuple([1, 2, 3])).toEqual([1, 2, 3]);
    });

    it("字符串 '1.26.30' → [1, 26, 30]", () => {
        expect(parseVersionToTuple("1.26.30")).toEqual([1, 26, 30]);
    });

    it("字符串 '1.0.0' → [1, 0, 0]", () => {
        expect(parseVersionToTuple("1.0.0")).toEqual([1, 0, 0]);
    });

    it("无效字符串 '' → undefined", () => {
        expect(parseVersionToTuple("")).toBeUndefined();
    });

    it("无效字符串 'abc' → undefined", () => {
        expect(parseVersionToTuple("abc")).toBeUndefined();
    });

    it("undefined → undefined", () => {
        expect(parseVersionToTuple(undefined)).toBeUndefined();
    });

    it("null → undefined", () => {
        expect(parseVersionToTuple(null)).toBeUndefined();
    });

    it("非法类型（number）→ undefined", () => {
        expect(parseVersionToTuple(42)).toBeUndefined();
    });

    it("数组长度不对 → undefined", () => {
        expect(parseVersionToTuple([1, 2])).toBeUndefined();
    });
});
