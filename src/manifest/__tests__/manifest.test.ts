import { describe, it, expect } from "vitest";
import { ManifestBuilder } from "../ManifestBuilder.js";
import { ManifestDepManager } from "../ManifestDepManager.js";
import { validateManifest } from "../validate.js";
import { createDependencyCatalog } from "../../install/dependencyCatalog.js";
import type { Manifest, ManifestVersion } from "../types.js";
import type { ResolvedConfig } from "../../config/configTypes.js";

// ---------------------------------------------------------------------------
// 测试辅助
// ---------------------------------------------------------------------------

const MOD_VERSION: ManifestVersion = [1, 0, 0];

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
                dependencies: {
                    "@minecraft/server": "2.6.0",
                },
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

function bp(overrides?: Partial<ResolvedConfig>): ManifestBuilder {
    return createBuilder(baseConfig(overrides));
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
// ManifestBuilder — 创建
// ---------------------------------------------------------------------------

describe("ManifestBuilder buildBp", () => {
    it("从配置完整生成 BP manifest", () => {
        const builder = bp();
        const manifest = builder.buildBp();

        expect(manifest.format_version).toBe(2);
        expect(manifest.header).toBeDefined();
        expect(manifest.header!.name).toBe("Test BP");
        expect(manifest.header!.uuid).toBe("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
        expect(manifest.header!.version).toEqual([1, 0, 0]);
        expect(manifest.header!.min_engine_version).toEqual([1, 21, 0]);

        expect(manifest.modules).toHaveLength(1);
        expect(manifest.modules![0]).toMatchObject({
            type: "script",
            language: "javascript",
            uuid: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
            version: MOD_VERSION,
            entry: "scripts/main.js",
        });

        expect(Array.isArray(manifest.dependencies)).toBe(true);
        expect(manifest.dependencies).toHaveLength(1);
        expect(manifest.dependencies![0]).toMatchObject({
            module_name: "@minecraft/server",
            version: "2.6.0",
        });
    });

    it("同一 builder 可多次调用 buildBp", () => {
        const builder = bp();
        const a = builder.buildBp();
        const b = builder.buildBp();
        expect(a.format_version).toBe(2);
        expect(b.format_version).toBe(2);
    });
});

describe("ManifestBuilder buildRp", () => {
    it("从配置完整生成 RP manifest", () => {
        const config = baseConfig({
            packs: {
                bp: {
                    root: "bp",
                    uuid: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                    moduleUuid: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
                    name: "Test BP",
                    dependencies: {},
                },
                rp: {
                    root: "rp",
                    uuid: "cccccccc-cccc-cccc-cccc-cccccccccccc",
                    moduleUuid: "dddddddd-dddd-dddd-dddd-dddddddddddd",
                    name: "Test RP",
                },
            },
        });
        const builder = createBuilder(config);
        const manifest = builder.buildRp();

        expect(manifest.format_version).toBe(2);
        expect(manifest.header!.name).toBe("Test RP");
        expect(manifest.header!.uuid).toBe("cccccccc-cccc-cccc-cccc-cccccccccccc");
        expect(manifest.header!.version).toEqual([1, 0, 0]);

        expect(manifest.modules).toHaveLength(1);
        expect(manifest.modules![0]).toMatchObject({
            type: "resources",
            uuid: "dddddddd-dddd-dddd-dddd-dddddddddddd",
            version: MOD_VERSION,
        });

        expect(manifest.dependencies).toHaveLength(1);
        expect(manifest.dependencies![0]).toMatchObject({
            uuid: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
            version: [1, 0, 0],
        });
    });

    it("packs.rp 未配置时抛出", () => {
        expect(() => bp().buildRp()).toThrow("packs.rp is required");
    });
});

// ---------------------------------------------------------------------------
// 复用 builder
// ---------------------------------------------------------------------------

describe("同一 ManifestBuilder 构建 BP 和 RP", () => {
    it("buildBp 和 buildRp 可复用同一 builder 实例", () => {
        const config = baseConfig({
            packs: {
                bp: {
                    root: "bp",
                    uuid: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                    moduleUuid: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
                    name: "Test BP",
                    dependencies: {},
                },
                rp: {
                    root: "rp",
                    uuid: "cccccccc-cccc-cccc-cccc-cccccccccccc",
                    moduleUuid: "dddddddd-dddd-dddd-dddd-dddddddddddd",
                    name: "Test RP",
                },
            },
        });
        const builder = createBuilder(config);

        const bpResult = builder.buildBp();
        expect(bpResult.header!.name).toBe("Test BP");

        const rpResult = builder.buildRp();
        expect(rpResult.header!.name).toBe("Test RP");
    });
});

// ---------------------------------------------------------------------------
// 不可变性
// ---------------------------------------------------------------------------

describe("不可变性", () => {
    it("不会修改传入的 existing 对象", () => {
        const existing: Manifest = {
            minecraft_screening: true,
            header: {
                name: "old-name",
            },
        };
        const frozen = { ...existing };
        const builder = bp();

        builder.buildBp(existing);

        // 原对象不变
        expect(existing).toEqual(frozen);
    });

    it("buildBp 返回全新对象", () => {
        const builder = bp();
        const a = builder.buildBp();
        const b = builder.buildBp();

        expect(a).not.toBe(b);
        expect(a.header).not.toBe(b.header);
        expect(a.modules).not.toBe(b.modules);
        expect(a.dependencies).not.toBe(b.dependencies);
    });
});

// ---------------------------------------------------------------------------
// 保留用户字段
// ---------------------------------------------------------------------------

describe("保留用户字段", () => {
    it("保留根对象未知字段", () => {
        const existing: Manifest = { minecraft_screening: true, _comment: "note" };
        const manifest = bp().buildBp(existing);
        expect(manifest.minecraft_screening).toBe(true);
        expect(manifest._comment).toBe("note");
    });

    it("保留 header 未知字段", () => {
        const existing: Manifest = { header: { product_icon: "icon.png" } };
        const manifest = bp().buildBp(existing);
        expect(manifest.header!.product_icon).toBe("icon.png");
    });

    it("保留 metadata 未知字段", () => {
        const existing: Manifest = { metadata: { author: "TestAuthor" } };
        const manifest = bp().buildBp(existing);
        expect(manifest.metadata!.author).toBe("TestAuthor");
    });

    it("保留用户手写的 unmanaged dependency", () => {
        const existing: Manifest = {
            dependencies: [
                {
                    uuid: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
                    version: [1, 0, 0] as ManifestVersion,
                },
            ],
        };
        const manifest = bp().buildBp(existing);
        const found = manifest.dependencies!.find(
            (d) => "uuid" in d && d.uuid === "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
        );
        expect(found).toBeDefined();
    });

    it("config 未设置 description 时保留已有 description", () => {
        const config = baseConfig();
        expect(config.packs.bp.description).toBeUndefined();
        const existing: Manifest = { header: { description: "My custom" } };
        const manifest = createBuilder(config).buildBp(existing);
        expect(manifest.header!.description).toBe("My custom");
    });
});

// ---------------------------------------------------------------------------
// Module 管理
// ---------------------------------------------------------------------------

describe("Module 管理", () => {
    it("保留用户额外的 script module", () => {
        const existing: Manifest = {
            modules: [
                {
                    type: "script",
                    language: "javascript",
                    uuid: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
                    version: [1, 0, 0] as ManifestVersion,
                    entry: "scripts/custom.js",
                },
            ],
        };
        const manifest = bp().buildBp(existing);

        expect(manifest.modules).toHaveLength(2);
        const custom = manifest.modules!.find(
            (m) => m.uuid === "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee"
        );
        expect(custom).toBeDefined();
    });

    it("保留用户额外的 resources module", () => {
        const config = baseConfig({
            packs: {
                bp: { root: "bp", uuid: "a", moduleUuid: "b", name: "BP", dependencies: {} },
                rp: { root: "rp", uuid: "c", moduleUuid: "d", name: "RP" },
            },
        });
        const existing: Manifest = {
            modules: [
                {
                    type: "resources",
                    uuid: "ffffffff-ffff-ffff-ffff-ffffffffffff",
                    version: [1, 0, 0] as ManifestVersion,
                },
            ],
        };
        const builder = createBuilder(config);
        const manifest = builder.buildRp(existing);

        expect(manifest.modules).toHaveLength(2);
        const custom = manifest.modules!.find(
            (m) => m.uuid === "ffffffff-ffff-ffff-ffff-ffffffffffff"
        );
        expect(custom).toBeDefined();
    });
});

// ---------------------------------------------------------------------------
// Dependency 替换
// ---------------------------------------------------------------------------

describe("Dependency 替换", () => {
    it("删除 config 中移除的 managed dependency", () => {
        const existing: Manifest = {
            dependencies: [
                { module_name: "@minecraft/server", version: "2.0.0" },
                { module_name: "@minecraft/server-ui", version: "2.0.0" },
            ],
        };
        // config 只声明了 @minecraft/server
        const manifest = bp().buildBp(existing);

        const hasServer = manifest.dependencies!.some(
            (d) => "module_name" in d && d.module_name === "@minecraft/server"
        );
        expect(hasServer).toBe(true);

        const hasUi = manifest.dependencies!.some(
            (d) => "module_name" in d && d.module_name === "@minecraft/server-ui"
        );
        expect(hasUi).toBe(false);
    });

    it("保留用户手写的 unmanaged dependency（混合场景）", () => {
        const existing: Manifest = {
            dependencies: [
                { module_name: "@minecraft/server", version: "1.0.0" },
                { module_name: "my-custom-lib", version: "3.0.0" },
                {
                    uuid: "gggggggg-gggg-gggg-gggg-gggggggggggg",
                    version: [1, 0, 0] as ManifestVersion,
                },
            ],
        };
        const manifest = bp().buildBp(existing);

        // managed 的被替换
        const serverDep = manifest.dependencies!.find(
            (d) => "module_name" in d && d.module_name === "@minecraft/server"
        );
        expect(serverDep).toMatchObject({ version: "2.6.0" });

        // unmanaged 保留
        const customLib = manifest.dependencies!.find(
            (d) => "module_name" in d && d.module_name === "my-custom-lib"
        );
        expect(customLib).toBeDefined();

        const uuidDep = manifest.dependencies!.find(
            (d) => "uuid" in d && d.uuid === "gggggggg-gggg-gggg-gggg-gggggggggggg"
        );
        expect(uuidDep).toBeDefined();
    });

    it("manifest=false 的依赖不写入 manifest", () => {
        const config = baseConfig({
            packs: {
                bp: {
                    root: "bp",
                    uuid: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                    moduleUuid: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
                    name: "Test BP",
                    dependencies: {
                        "@minecraft/server": "2.6.0",
                        "@minecraft/vanilla-data": "2.6.0",
                    },
                },
            },
        });
        const builder = createBuilder(config);
        const manifest = builder.buildBp();

        // @minecraft/vanilla-data 在内置 catalog 中 manifest=false
        expect(
            manifest.dependencies!.some(
                (d) => "module_name" in d && d.module_name === "@minecraft/vanilla-data"
            )
        ).toBe(false);

        expect(
            manifest.dependencies!.some(
                (d) => "module_name" in d && d.module_name === "@minecraft/server"
            )
        ).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// PBR
// ---------------------------------------------------------------------------

describe("PBR capability", () => {
    function rpConfig(pbr?: boolean): ResolvedConfig {
        return baseConfig({
            packs: {
                bp: { root: "bp", uuid: "a", moduleUuid: "b", name: "BP", dependencies: {} },
                rp: {
                    root: "rp",
                    uuid: "cccccccc-cccc-cccc-cccc-cccccccccccc",
                    moduleUuid: "dddddddd-dddd-dddd-dddd-dddddddddddd",
                    name: "Test RP",
                    ...(pbr !== undefined ? { pbr } : {}),
                },
            },
        });
    }

    it("pbr=true 添加 pbr", () => {
        const manifest = createBuilder(rpConfig(true)).buildRp();
        expect(manifest.capabilities).toEqual(["pbr"]);
    });

    it("pbr=true 时保留现有 capabilities", () => {
        const existing: Manifest = { capabilities: ["raytraced"] };
        const manifest = createBuilder(rpConfig(true)).buildRp(existing);
        expect(manifest.capabilities).toContain("pbr");
        expect(manifest.capabilities).toContain("raytraced");
        expect(manifest.capabilities).toHaveLength(2);
    });

    it("pbr=false 移除 pbr，保留其他 capability", () => {
        const existing: Manifest = { capabilities: ["pbr", "raytraced"] };
        const manifest = createBuilder(rpConfig(false)).buildRp(existing);
        expect(manifest.capabilities).not.toContain("pbr");
        expect(manifest.capabilities).toContain("raytraced");
    });

    it("pbr=false 且只有 pbr 时删除 capabilities", () => {
        const manifest = createBuilder(rpConfig(false)).buildRp();
        expect(manifest.capabilities).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// Achievement
// ---------------------------------------------------------------------------

describe("achievement", () => {
    function withAchievement(deps: Record<string, string>): ManifestBuilder {
        return createBuilder(
            baseConfig({
                packs: {
                    bp: {
                        root: "bp",
                        uuid: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                        moduleUuid: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
                        name: "Test BP",
                        dependencies: deps,
                        achievement: true,
                    },
                },
            })
        );
    }

    it("achievement + beta 抛出", () => {
        expect(() => withAchievement({ "@minecraft/server": "beta" }).buildBp()).toThrow(
            "achievement requires stable"
        );
    });

    it("achievement + preview 抛出", () => {
        expect(() => withAchievement({ "@minecraft/server": "preview" }).buildBp()).toThrow(
            "achievement requires stable"
        );
    });

    it("achievement + stable 通过", () => {
        const builder = createBuilder(
            baseConfig({
                packs: {
                    bp: {
                        root: "bp",
                        uuid: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                        moduleUuid: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
                        name: "Test BP",
                        dependencies: { "@minecraft/server": "stable" },
                        achievement: true,
                    },
                },
            }),
            { "@minecraft/server": "2.6.0" }
        );
        const result = builder.buildBp();
        expect(result.metadata).toMatchObject({ product_type: "addon" });
    });

    it("achievement + 具体版本通过", () => {
        const manifest = withAchievement({ "@minecraft/server": "2.6.0" }).buildBp();
        expect(manifest.metadata).toMatchObject({ product_type: "addon" });
    });

    it("achievement=false 不设置 product_type", () => {
        const builder = createBuilder(
            baseConfig({
                packs: {
                    bp: {
                        root: "bp",
                        uuid: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                        moduleUuid: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
                        name: "Test BP",
                        dependencies: { "@minecraft/server": "2.6.0" },
                        achievement: false,
                    },
                },
            })
        );
        const manifest = builder.buildBp();
        expect(manifest.metadata).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// validateManifest
// ---------------------------------------------------------------------------

describe("validateManifest", () => {
    it("合法 BP manifest 通过", () => {
        const manifest: Manifest = {
            format_version: 2,
            header: {
                name: "Test",
                uuid: "a",
                version: [1, 0, 0],
                min_engine_version: [1, 21, 0],
            },
            modules: [
                {
                    type: "script",
                    language: "javascript",
                    uuid: "b",
                    version: [1, 0, 0],
                    entry: "main.js",
                },
            ],
        };
        expect(() => validateManifest(manifest, "bp")).not.toThrow();
    });

    it("缺失 format_version 拒绝", () => {
        expect(() =>
            validateManifest(
                {
                    header: {
                        name: "T",
                        uuid: "a",
                        version: [1, 0, 0],
                        min_engine_version: [1, 21, 0],
                    },
                    modules: [],
                } as Manifest,
                "bp"
            )
        ).toThrow("Manifest validation failed");
    });

    it("缺失 header 拒绝", () => {
        expect(() =>
            validateManifest({ format_version: 2, modules: [] } as Manifest, "bp")
        ).toThrow("Manifest validation failed");
    });

    it("BP 无 script module 拒绝", () => {
        expect(() =>
            validateManifest(
                {
                    format_version: 2,
                    header: {
                        name: "T",
                        uuid: "a",
                        version: [1, 0, 0],
                        min_engine_version: [1, 21, 0],
                    },
                    modules: [{ type: "resources", uuid: "c", version: [1, 0, 0] }],
                } as Manifest,
                "bp"
            )
        ).toThrow("must have a script module");
    });

    it("RP 无 resources module 拒绝", () => {
        expect(() =>
            validateManifest(
                {
                    format_version: 2,
                    header: {
                        name: "T",
                        uuid: "a",
                        version: [1, 0, 0],
                        min_engine_version: [1, 21, 0],
                    },
                    modules: [
                        {
                            type: "script",
                            language: "javascript",
                            uuid: "b",
                            version: [1, 0, 0],
                            entry: "main.js",
                        },
                    ],
                } as Manifest,
                "rp"
            )
        ).toThrow("must have a resources module");
    });

    it("uuid dependency version 格式校验", () => {
        expect(() =>
            validateManifest(
                {
                    format_version: 2,
                    header: {
                        name: "T",
                        uuid: "a",
                        version: [1, 0, 0],
                        min_engine_version: [1, 21, 0],
                    },
                    modules: [
                        {
                            type: "script",
                            language: "javascript",
                            uuid: "b",
                            version: [1, 0, 0],
                            entry: "main.js",
                        },
                    ],
                    dependencies: [{ uuid: "c", version: "invalid" as unknown as ManifestVersion }],
                } as Manifest,
                "bp"
            )
        ).toThrow("version must be [number, number, number] (format 2)");
    });
});

// ---------------------------------------------------------------------------
// ManifestDepManager 静态方法
// ---------------------------------------------------------------------------

describe("ManifestDepManager.resolveVersion", () => {
    it("具体版本原样返回", () => {
        expect(ManifestDepManager.resolveVersion({ specifier: "2.6.0", target: "latest" })).toBe(
            "2.6.0"
        );
    });

    it("stable 返回已解析版本", () => {
        expect(
            ManifestDepManager.resolveVersion({
                specifier: "stable",
                target: "latest",
                resolvedVersion: "2.6.0",
            })
        ).toBe("2.6.0");
    });

    it("stable 无已解析版本时抛出", () => {
        expect(() =>
            ManifestDepManager.resolveVersion({ specifier: "stable", target: "latest" })
        ).toThrow("Run `bepack install` to resolve stable");
    });

    it("beta target latest 返回 'beta'", () => {
        expect(ManifestDepManager.resolveVersion({ specifier: "beta", target: "latest" })).toBe(
            "beta"
        );
    });

    it("beta 旧 target 返回已解析版本", () => {
        expect(
            ManifestDepManager.resolveVersion({
                specifier: "beta",
                target: "1.20.80",
                resolvedVersion: "2.0.0-beta.1.20.80-stable",
            })
        ).toBe("2.0.0-beta.1.20.80-stable");
    });

    it("preview 无已解析版本时抛出", () => {
        expect(() =>
            ManifestDepManager.resolveVersion({ specifier: "preview", target: "latest" })
        ).toThrow("Run `bepack install` to resolve preview");
    });
});

describe("ManifestDepManager.isAllowedSpecifier", () => {
    it.each(["stable", "beta", "preview", "1.0.0", "2.6.0"])("接受 '%s'", (v) => {
        expect(ManifestDepManager.isAllowedSpecifier(v)).toBe(true);
    });
    it.each(["", "abc", "latest"])("拒绝 '%s'", (v) => {
        expect(ManifestDepManager.isAllowedSpecifier(v)).toBe(false);
    });
});

describe("ManifestDepManager.isAchievementCompatible", () => {
    it("stable 通过", () => expect(ManifestDepManager.isAchievementCompatible("stable")).toBe(true));
    it("版本号通过", () => expect(ManifestDepManager.isAchievementCompatible("2.6.0")).toBe(true));
    it("beta 拒绝", () => expect(ManifestDepManager.isAchievementCompatible("beta")).toBe(false));
    it("preview 拒绝", () => expect(ManifestDepManager.isAchievementCompatible("preview")).toBe(false));
});
