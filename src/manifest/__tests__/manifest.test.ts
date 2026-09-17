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

const DEFAULT_MANIFEST = {
    merge: "preserve" as const,
    extraDependencies: [],
    extraModules: [],
    extraHeader: {},
};

function baseConfig(overrides?: Partial<ResolvedConfig>): ResolvedConfig {
    return {
        root: ".",
        configured: {
            root: false,
            packOutDir: false,
        },
        name: "test-addon",
        version: "1.0.0",
        replace: {
            values: {},
            builtins: { VERSION: false, NAME: false, UUID: false, DESCRIPTION: false },
        },
        target: "latest",
        hooks: {},
        packs: {
            bp: {
                root: "bp",
                uuid: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                moduleUuid: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
                name: "Test BP",
                manifest: DEFAULT_MANIFEST,
                dependencies: {
                    "@minecraft/server": "2.6.0",
                },
                include: [],
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
            copy: false,
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
    it("supports data-only BP projects without a module UUID", () => {
        const config = baseConfig({
            packs: {
                bp: {
                    root: "bp",
                    uuid: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                    name: "Test BP",
                    manifest: DEFAULT_MANIFEST,
                    dependencies: {},
                    include: [],
                },
            },
        });

        const manifest = createBuilder(config).buildBp();
        expect(manifest.modules).toBeUndefined();
        expect(() => validateManifest(manifest, "bp")).not.toThrow();
    });

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
                    manifest: DEFAULT_MANIFEST,
                    dependencies: {},
                    include: [],
                },
                rp: {
                    root: "rp",
                    uuid: "cccccccc-cccc-cccc-cccc-cccccccccccc",
                    moduleUuid: "dddddddd-dddd-dddd-dddd-dddddddddddd",
                    name: "Test RP",
                    manifest: DEFAULT_MANIFEST,
                    include: [],
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

    it("does not add an empty BP dependency for RP-only projects", () => {
        const config = baseConfig({
            packs: {
                rp: {
                    root: "rp",
                    uuid: "cccccccc-cccc-cccc-cccc-cccccccccccc",
                    moduleUuid: "dddddddd-dddd-dddd-dddd-dddddddddddd",
                    name: "Test RP",
                    manifest: DEFAULT_MANIFEST,
                    include: [],
                },
            },
        });

        expect(createBuilder(config).buildRp().dependencies).toEqual([]);
    });

    it.each(["world", "global", "any"] as const)(
        "packs.rp.packScope=%s 写入 header.pack_scope",
        (packScope) => {
            const config = baseConfig({
                packs: {
                    rp: {
                        root: "rp",
                        uuid: "cccccccc-cccc-cccc-cccc-cccccccccccc",
                        moduleUuid: "dddddddd-dddd-dddd-dddd-dddddddddddd",
                        name: "Test RP",
                        manifest: DEFAULT_MANIFEST,
                        include: [],
                        packScope,
                    },
                },
            });

            const manifest = createBuilder(config).buildRp();
            expect(manifest.header!.pack_scope).toBe(packScope);
        }
    );

    it("packScope 未配置时不写入 header.pack_scope", () => {
        const config = baseConfig({
            packs: {
                rp: {
                    root: "rp",
                    uuid: "cccccccc-cccc-cccc-cccc-cccccccccccc",
                    moduleUuid: "dddddddd-dddd-dddd-dddd-dddddddddddd",
                    name: "Test RP",
                    manifest: DEFAULT_MANIFEST,
                    include: [],
                },
            },
        });

        const manifest = createBuilder(config).buildRp();
        expect(manifest.header!.pack_scope).toBeUndefined();
    });

    it("packScope 未配置时保留已有 header.pack_scope", () => {
        const existing: Manifest = { header: { pack_scope: "global" } };
        const config = baseConfig({
            packs: {
                rp: {
                    root: "rp",
                    uuid: "cccccccc-cccc-cccc-cccc-cccccccccccc",
                    moduleUuid: "dddddddd-dddd-dddd-dddd-dddddddddddd",
                    name: "Test RP",
                    manifest: DEFAULT_MANIFEST,
                    include: [],
                },
            },
        });

        const manifest = createBuilder(config).buildRp(existing);
        expect(manifest.header!.pack_scope).toBe("global");
    });

    it("packScope 配置后覆盖已有 header.pack_scope", () => {
        const existing: Manifest = { header: { pack_scope: "world" } };
        const config = baseConfig({
            packs: {
                rp: {
                    root: "rp",
                    uuid: "cccccccc-cccc-cccc-cccc-cccccccccccc",
                    moduleUuid: "dddddddd-dddd-dddd-dddd-dddddddddddd",
                    name: "Test RP",
                    manifest: DEFAULT_MANIFEST,
                    include: [],
                    packScope: "global",
                },
            },
        });

        const manifest = createBuilder(config).buildRp(existing);
        expect(manifest.header!.pack_scope).toBe("global");
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
                    manifest: DEFAULT_MANIFEST,
                    dependencies: {},
                    include: [],
                },
                rp: {
                    root: "rp",
                    uuid: "cccccccc-cccc-cccc-cccc-cccccccccccc",
                    moduleUuid: "dddddddd-dddd-dddd-dddd-dddddddddddd",
                    name: "Test RP",
                    manifest: DEFAULT_MANIFEST,
                    include: [],
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
        expect(config.packs.bp!.description).toBeUndefined();
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
                bp: {
                    root: "bp",
                    uuid: "a",
                    moduleUuid: "b",
                    name: "BP",
                    manifest: DEFAULT_MANIFEST,
                    dependencies: {},
                    include: [],
                },
                rp: {
                    root: "rp",
                    uuid: "c",
                    moduleUuid: "d",
                    name: "RP",
                    manifest: DEFAULT_MANIFEST,
                    include: [],
                },
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
                    manifest: DEFAULT_MANIFEST,
                    dependencies: {
                        "@minecraft/server": "2.6.0",
                        "@minecraft/vanilla-data": "2.6.0",
                    },
                    include: [],
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
                bp: {
                    root: "bp",
                    uuid: "a",
                    moduleUuid: "b",
                    name: "BP",
                    manifest: DEFAULT_MANIFEST,
                    dependencies: {},
                    include: [],
                },
                rp: {
                    root: "rp",
                    uuid: "cccccccc-cccc-cccc-cccc-cccccccccccc",
                    moduleUuid: "dddddddd-dddd-dddd-dddd-dddddddddddd",
                    name: "Test RP",
                    manifest: DEFAULT_MANIFEST,
                    include: [],
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
// Clean 模式（manifest.merge: "clean"）
// ---------------------------------------------------------------------------

describe("manifest.merge = clean", () => {
    function cleanConfig(manifest: {
        merge?: "preserve" | "clean";
        minEngineVersion?: string;
        extraDependencies?: Record<string, unknown>[];
        extraModules?: Record<string, unknown>[];
        extraHeader?: Record<string, unknown>;
    }) {
        return baseConfig({
            packs: {
                bp: {
                    root: "bp",
                    uuid: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                    moduleUuid: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
                    name: "Test BP",
                    manifest: {
                        merge: manifest.merge ?? "clean",
                        ...(manifest.minEngineVersion !== undefined
                            ? { minEngineVersion: manifest.minEngineVersion }
                            : {}),
                        extraDependencies: manifest.extraDependencies ?? [],
                        extraModules: manifest.extraModules ?? [],
                        extraHeader: manifest.extraHeader ?? {},
                    },
                    dependencies: { "@minecraft/server": "2.6.0" },
                    include: [],
                },
            },
        });
    }

    it("丢弃根对象非 managed 字段", () => {
        const existing: Manifest = {
            minecraft_screening: true,
            _comment: "note",
            capabilities: ["raytraced"],
        };
        const manifest = createBuilder(cleanConfig({})).buildBp(existing);

        expect(manifest.minecraft_screening).toBeUndefined();
        expect(manifest._comment).toBeUndefined();
        expect(manifest.capabilities).toBeUndefined();
    });

    it("丢弃用户手写 dependency 和额外 module", () => {
        const existing: Manifest = {
            dependencies: [
                { module_name: "my-custom-lib", version: "3.0.0" },
                {
                    uuid: "zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz",
                    version: [1, 0, 0] as ManifestVersion,
                },
            ],
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
        const manifest = createBuilder(cleanConfig({})).buildBp(existing);

        expect(manifest.dependencies).toHaveLength(1);
        expect(manifest.dependencies![0]).toMatchObject({ module_name: "@minecraft/server" });
        expect(manifest.modules).toHaveLength(1);
        expect(manifest.modules![0]).toMatchObject({
            type: "script",
            uuid: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
        });
    });

    it("minEngineVersion 写入 header.min_engine_version（format 2 转数组）", () => {
        const manifest = createBuilder(cleanConfig({ minEngineVersion: "1.21.80" })).buildBp();
        expect(manifest.header!.min_engine_version).toEqual([1, 21, 80]);
    });

    it("format 3 时 minEngineVersion 保持字符串", () => {
        const builder = createBuilder(cleanConfig({ minEngineVersion: "1.26.0" }));
        const manifest = builder.buildBp({ format_version: 3 } as Manifest);
        expect(manifest.header!.min_engine_version).toBe("1.26.0");
    });

    it("未配置 minEngineVersion 使用默认值", () => {
        const manifest = createBuilder(cleanConfig({})).buildBp();
        expect(manifest.header!.min_engine_version).toEqual([1, 21, 0]);
    });

    it("extraHeader 合并进 header", () => {
        const manifest = createBuilder(
            cleanConfig({ extraHeader: { product_icon: "icon.png" } })
        ).buildBp();
        expect(manifest.header!.product_icon).toBe("icon.png");
    });

    it("extraDependencies 原样追加", () => {
        const extra = [{ module_name: "my-custom-lib", version: "3.0.0" }];
        const manifest = createBuilder(cleanConfig({ extraDependencies: extra })).buildBp();
        expect(manifest.dependencies).toHaveLength(2);
        expect(manifest.dependencies).toContainEqual(extra[0]);
    });

    it("extraModules 原样追加", () => {
        const extra = [
            {
                type: "script",
                language: "javascript",
                uuid: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
                version: [1, 0, 0] as ManifestVersion,
                entry: "scripts/custom.js",
            },
        ];
        const manifest = createBuilder(cleanConfig({ extraModules: extra })).buildBp();
        expect(manifest.modules).toHaveLength(2);
        expect(manifest.modules![1]).toEqual(extra[0]);
    });

    it("RP clean 模式丢弃非 managed 字段并写入 extra", () => {
        const config = baseConfig({
            packs: {
                bp: {
                    root: "bp",
                    uuid: "a",
                    moduleUuid: "b",
                    name: "BP",
                    manifest: DEFAULT_MANIFEST,
                    dependencies: {},
                    include: [],
                },
                rp: {
                    root: "rp",
                    uuid: "cccccccc-cccc-cccc-cccc-cccccccccccc",
                    moduleUuid: "dddddddd-dddd-dddd-dddd-dddddddddddd",
                    name: "Test RP",
                    manifest: {
                        merge: "clean",
                        minEngineVersion: "1.21.80",
                        extraModules: [],
                        extraHeader: { pack_scope: "global" },
                        extraDependencies: [
                            { uuid: "zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz", version: [1, 0, 0] },
                        ],
                    },
                    include: [],
                },
            },
        });
        const existing: Manifest = {
            capabilities: ["raytraced"],
            dependencies: [{ module_name: "stale", version: "1.0.0" }],
            header: { product_icon: "old.png", min_engine_version: [1, 20, 0] as ManifestVersion },
        };
        const manifest = createBuilder(config).buildRp(existing);

        expect(manifest.capabilities).toBeUndefined();
        expect(manifest.header!.product_icon).toBeUndefined();
        expect(manifest.header!.min_engine_version).toEqual([1, 21, 80]);
        expect(manifest.header!.pack_scope).toBe("global");
        expect(manifest.dependencies).toHaveLength(2);
        expect(manifest.dependencies).toContainEqual({
            uuid: "a",
            version: [1, 0, 0] as ManifestVersion,
        });
        expect(manifest.dependencies).toContainEqual({
            uuid: "zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz",
            version: [1, 0, 0] as ManifestVersion,
        });
    });
});

// ---------------------------------------------------------------------------
// UNSUPPORTED_DEPENDENCY 报错增强
// ---------------------------------------------------------------------------

describe("UNSUPPORTED_DEPENDENCY", () => {
    it("列出可用 catalog 并给出扩展指引", () => {
        const config = baseConfig({
            packs: {
                bp: {
                    root: "bp",
                    uuid: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                    moduleUuid: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
                    name: "Test BP",
                    manifest: DEFAULT_MANIFEST,
                    dependencies: { "my-unknown-lib": "1.0.0" },
                    include: [],
                },
            },
        });
        try {
            createBuilder(config).buildBp();
            throw new Error("expected UNSUPPORTED_DEPENDENCY");
        } catch (error) {
            expect((error as Error).message).toContain(
                "my-unknown-lib is not a managed dependency"
            );
            const bepackError = error as { code?: string; suggestions?: string[] };
            expect(bepackError.code).toBe("UNSUPPORTED_DEPENDENCY");
            expect(bepackError.suggestions?.[0]).toContain("@minecraft/server");
            expect(bepackError.suggestions?.[1]).toContain("install.dependencyCatalog");
        }
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

    it("BP can omit a script module", () => {
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
        ).not.toThrow();
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
