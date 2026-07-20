import { describe, it, expect } from "vitest";
import { normalizeConfig } from "../normalizeConfig.js";
import { getConfiguredPacks } from "../configTypes.js";
import { runHook } from "../../hooks/runHook.js";
import { Logger } from "../../logger/logger.js";
import { DependencyResolverRegistry } from "../../install/resolvers/registry.js";
import { DependencyService } from "../../install/DependencyService.js";
import { loadConfig } from "../loadConfig.js";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// ---------------------------------------------------------------------------
// BP/RP 对等 — 不同项目结构
// ---------------------------------------------------------------------------

describe("BP/RP 对等", () => {
    it("仅 BP 带编译 → 通过", () => {
        const config = normalizeConfig({
            name: "test",
            packs: {
                bp: {
                    root: "bp",
                    uuid: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                    moduleUuid: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
                    compile: { entry: "src/main.ts" },
                },
            },
        });
        expect(config.packs.bp).toBeDefined();
        expect(config.packs.bp!.compile).toBeDefined();
        expect(config.packs.bp!.compile!.entry).toBe("src/main.ts");
        expect(config.packs.rp).toBeUndefined();
    });

    it("仅 BP 不带编译 → 通过", () => {
        const config = normalizeConfig({
            name: "test",
            packs: {
                bp: {
                    root: "bp",
                    uuid: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                    moduleUuid: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
                },
            },
        });
        expect(config.packs.bp).toBeDefined();
        expect(config.packs.bp!.compile).toBeUndefined();
    });

    it("仅 RP → 通过", () => {
        const config = normalizeConfig({
            name: "test",
            packs: {
                rp: {
                    root: "rp",
                    uuid: "cccccccc-cccc-cccc-cccc-cccccccccccc",
                    moduleUuid: "dddddddd-dddd-dddd-dddd-dddddddddddd",
                },
            },
        });
        expect(config.packs.bp).toBeUndefined();
        expect(config.packs.rp).toBeDefined();
        expect(config.packs.rp!.root).toBe("rp");
    });

    it("BP + RP → 通过", () => {
        const config = normalizeConfig({
            name: "test",
            packs: {
                bp: {
                    root: "bp",
                    uuid: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                    moduleUuid: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
                },
                rp: {
                    root: "rp",
                    uuid: "cccccccc-cccc-cccc-cccc-cccccccccccc",
                    moduleUuid: "dddddddd-dddd-dddd-dddd-dddddddddddd",
                },
            },
        });
        expect(config.packs.bp).toBeDefined();
        expect(config.packs.rp).toBeDefined();
    });

    it("无任何 Pack → 抛出", () => {
        expect(() =>
            normalizeConfig({
                name: "test",
                packs: {},
            })
        ).toThrow("At least one pack");
    });

    it("packs 未配置 → 抛出", () => {
        expect(() =>
            normalizeConfig({
                name: "test",
            })
        ).toThrow("At least one pack");
    });
});

describe("plugins", () => {
    const bp = { root: "bp", uuid: "a", moduleUuid: "b" };

    it("resolves a plugin-managed package from the Minecraft target", async () => {
        const pluginResolver = {
            name: "third-party-for-target",
            resolver: "third-party",
            match: () => true,
            resolve: ({ target }: { target: string }) => ({ packageVersion: `3.0.0-mc.${target}` }),
        };
        const config = normalizeConfig({
            name: "test",
            target: "1.21.0",
            plugins: [
                {
                    name: "third-party",
                    install: {
                        dependencyCatalog: { "@example/addon-api": { resolver: "third-party" } },
                        dependencyResolvers: [pluginResolver],
                    },
                },
            ],
            packs: { bp },
        });

        expect(config.plugins?.map((plugin) => plugin.name)).toEqual(["third-party"]);
        expect(config.install.dependencyCatalog["@example/addon-api"]).toEqual({
            resolver: "third-party",
        });
        expect(config.install.dependencyResolvers[0]).toBe(pluginResolver);
        const result = await DependencyResolverRegistry.fromConfig(
            config.install.dependencyResolvers
        ).resolve({
            packageName: "@example/addon-api",
            specifier: "stable",
            target: config.target,
            entry: config.install.dependencyCatalog["@example/addon-api"]!,
            config,
            npm: {} as never,
        });
        expect(result.packageVersion).toBe("3.0.0-mc.1.21.0");
    });

    it("runs plugin hooks in plugin order before the project hook", async () => {
        const calls: string[] = [];
        const config = normalizeConfig({
            name: "test",
            plugins: [
                { name: "first", hooks: { beforeBuild: () => void calls.push("first") } },
                { name: "second", hooks: { beforeBuild: () => void calls.push("second") } },
            ],
            hooks: { beforeBuild: () => void calls.push("project") },
            packs: { bp },
        });

        await runHook("beforeBuild", "build", process.cwd(), config, new Logger({ silent: true }));
        expect(calls).toEqual(["first", "second", "project"]);
    });

    it("orders plugins by priority and reports catalog overrides", () => {
        const config = normalizeConfig({
            name: "test",
            plugins: [
                {
                    name: "low",
                    install: { dependencyCatalog: { "@example/api": { resolver: "low" } } },
                },
                {
                    name: "high",
                    priority: 10,
                    install: { dependencyCatalog: { "@example/api": { resolver: "high" } } },
                },
            ],
            packs: { bp },
        });

        expect(config.plugins?.map((plugin) => plugin.name)).toEqual(["high", "low"]);
        expect(config.install.dependencyCatalog["@example/api"]?.resolver).toBe("low");
        expect(config.pluginDiagnostics).toEqual([
            "dependency catalog @example/api: plugin low overrides plugin high",
        ]);
    });

    it("runs dependency hooks around plugin resolution", async () => {
        const calls: string[] = [];
        const config = normalizeConfig({
            name: "test",
            target: "1.21.0",
            plugins: [
                {
                    name: "api",
                    install: {
                        dependencyCatalog: { "@example/api": { resolver: "api" } },
                        dependencyResolvers: [
                            {
                                name: "api-version",
                                resolver: "api",
                                match: () => true,
                                resolve: () => ({ packageVersion: "1.0.0" }),
                            },
                        ],
                        hooks: {
                            beforeResolveDependency: ({ packageName }) =>
                                calls.push(`before:${packageName}`),
                            afterResolveDependency: ({ result }) =>
                                calls.push(`after:${result.packageVersion}`),
                        },
                    },
                },
            ],
            packs: { bp: { ...bp, dependencies: { "@example/api": "stable" } } },
        });

        await new DependencyService(config).resolveAll();
        expect(calls).toEqual(["before:@example/api", "after:1.0.0"]);
    });

    it("identifies the plugin when a lifecycle hook fails", async () => {
        const config = normalizeConfig({
            name: "test",
            plugins: [
                {
                    name: "broken",
                    hooks: {
                        beforeBuild: () => {
                            throw new Error("boom");
                        },
                    },
                },
            ],
            packs: { bp },
        });

        await expect(
            runHook("beforeBuild", "build", process.cwd(), config, new Logger({ silent: true }))
        ).rejects.toThrow("Plugin broken beforeBuild hook failed: boom");
    });

    it("runs configResolved after loading the normalized config", async () => {
        const cwd = await mkdtemp(path.join(tmpdir(), "bepack-plugin-"));
        try {
            await writeFile(
                path.join(cwd, "bepack.config.mjs"),
                `export default {
                    name: "original",
                    plugins: [{
                        name: "configure",
                        configResolved: ({ config }) => {
                            globalThis.__bepackPluginConfigResolved = config.name;
                        }
                    }],
                    packs: { bp: { root: "bp", uuid: "a", moduleUuid: "b" } }
                };`
            );
            const loaded = await loadConfig({ cwd });
            expect(loaded.config.name).toBe("original");
            expect(
                (globalThis as { __bepackPluginConfigResolved?: string })
                    .__bepackPluginConfigResolved
            ).toBe("original");
        } finally {
            delete (globalThis as { __bepackPluginConfigResolved?: string })
                .__bepackPluginConfigResolved;
            await rm(cwd, { recursive: true, force: true });
        }
    });

    it("rejects plugins without unique names", () => {
        expect(() =>
            normalizeConfig({
                name: "test",
                plugins: [{ name: "duplicate" }, { name: "duplicate" }],
                packs: { bp },
            })
        ).toThrow("Plugin name is duplicated");
    });
});

// ---------------------------------------------------------------------------
// getConfiguredPacks — Pack 遍历
// ---------------------------------------------------------------------------

describe("getConfiguredPacks", () => {
    it("仅 BP → 返回一个 PackInfo", () => {
        const config = normalizeConfig({
            name: "test",
            packs: {
                bp: { root: "bp", uuid: "a", moduleUuid: "b" },
            },
        });
        const packs = getConfiguredPacks(config);
        expect(packs).toHaveLength(1);
        expect(packs[0]!.type).toBe("bp");
    });

    it("仅 RP → 返回一个 PackInfo", () => {
        const config = normalizeConfig({
            name: "test",
            packs: {
                rp: { root: "rp", uuid: "c", moduleUuid: "d" },
            },
        });
        const packs = getConfiguredPacks(config);
        expect(packs).toHaveLength(1);
        expect(packs[0]!.type).toBe("rp");
    });

    it("BP + RP → 返回两个 PackInfo（bp 在前，rp 在后）", () => {
        const config = normalizeConfig({
            name: "test",
            packs: {
                bp: { root: "bp", uuid: "a", moduleUuid: "b" },
                rp: { root: "rp", uuid: "c", moduleUuid: "d" },
            },
        });
        const packs = getConfiguredPacks(config);
        expect(packs).toHaveLength(2);
        expect(packs[0]!.type).toBe("bp");
        expect(packs[1]!.type).toBe("rp");
    });

    it("每个 PackInfo 包含必要的字段", () => {
        const config = normalizeConfig({
            name: "test",
            packs: {
                bp: { root: "bp", uuid: "a", moduleUuid: "b", name: "MyBP" },
                rp: { root: "rp", uuid: "c", moduleUuid: "d", name: "MyRP", include: ["texts"] },
            },
        });
        const packs = getConfiguredPacks(config);
        const bpInfo = packs.find((p) => p.type === "bp")!;
        expect(bpInfo.name).toBe("MyBP");
        expect(bpInfo.root).toBe("bp");
        expect(bpInfo.include).toEqual([]);

        const rpInfo = packs.find((p) => p.type === "rp")!;
        expect(rpInfo.name).toBe("MyRP");
        expect(rpInfo.root).toBe("rp");
        expect(rpInfo.include).toEqual(["texts"]);
    });
});

// ---------------------------------------------------------------------------
// include 配置
// ---------------------------------------------------------------------------

describe("include 配置", () => {
    it("BP include 来自 packs.bp.include", () => {
        const config = normalizeConfig({
            name: "test",
            packs: {
                bp: {
                    root: "bp",
                    uuid: "a",
                    moduleUuid: "b",
                    include: ["my_scripts", "config"],
                },
            },
        });
        expect(config.packs.bp!.include).toEqual(["my_scripts", "config"]);
    });

    it("BP include 默认为空数组", () => {
        const config = normalizeConfig({
            name: "test",
            packs: {
                bp: { root: "bp", uuid: "a", moduleUuid: "b" },
            },
        });
        expect(config.packs.bp!.include).toEqual([]);
    });

    it("RP include 来自 packs.rp.include", () => {
        const config = normalizeConfig({
            name: "test",
            packs: {
                rp: {
                    root: "rp",
                    uuid: "c",
                    moduleUuid: "d",
                    include: ["texts", "texts/zh_CN.lang"],
                },
            },
        });
        expect(config.packs.rp!.include).toEqual(["texts", "texts/zh_CN.lang"]);
    });

    it("RP include 默认为空数组", () => {
        const config = normalizeConfig({
            name: "test",
            packs: {
                rp: { root: "rp", uuid: "c", moduleUuid: "d" },
            },
        });
        expect(config.packs.rp!.include).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// compile 配置 (BP 特有)
// ---------------------------------------------------------------------------

describe("compile 配置", () => {
    it("compile 完整配置保持指定值", () => {
        const config = normalizeConfig({
            name: "test",
            packs: {
                bp: {
                    root: "bp",
                    uuid: "a",
                    moduleUuid: "b",
                    compile: {
                        entry: "src/index.ts",
                        typecheck: false,
                        preserveModules: false,
                        minify: true,
                    },
                },
            },
        });
        expect(config.packs.bp!.compile!.entry).toBe("src/index.ts");
        expect(config.packs.bp!.compile!.typecheck).toBe(false);
        expect(config.packs.bp!.compile!.preserveModules).toBe(false);
        expect(config.packs.bp!.compile!.minify).toBe(true);
    });

    it("compile 缺失字段使用默认值", () => {
        const config = normalizeConfig({
            name: "test",
            packs: {
                bp: {
                    root: "bp",
                    uuid: "a",
                    moduleUuid: "b",
                    compile: { entry: "src/main.ts" },
                },
            },
        });
        expect(config.packs.bp!.compile!.tsconfig).toBe("tsconfig.json");
        expect(config.packs.bp!.compile!.typecheck).toBe(true);
        expect(config.packs.bp!.compile!.preserveModules).toBe(true);
        expect(config.packs.bp!.compile!.minify).toBe(false);
        expect(config.packs.bp!.compile!.useNpx).toBe(false);
    });

    it("未配置 compile 时不存在 compile 字段", () => {
        const config = normalizeConfig({
            name: "test",
            packs: {
                rp: { root: "rp", uuid: "c", moduleUuid: "d" },
            },
        });
        expect(config.packs.bp).toBeUndefined();
    });

    it("BP 未配 compile 时不存在 compile", () => {
        const config = normalizeConfig({
            name: "test",
            packs: {
                bp: { root: "bp", uuid: "a", moduleUuid: "b" },
            },
        });
        expect(config.packs.bp!.compile).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// scriptOutputDir 安全校验
// ---------------------------------------------------------------------------

describe("scriptOutputDir validation", () => {
    it('默认值为 "scripts"', () => {
        const config = normalizeConfig({
            name: "test",
            packs: {
                bp: { root: "bp", uuid: "a", moduleUuid: "b", compile: { entry: "src/main.ts" } },
            },
        });
        expect(config.packs.bp!.compile!.scriptOutputDir).toBe("scripts");
    });

    it('自定义值 "build_scripts" 通过', () => {
        const config = normalizeConfig({
            name: "test",
            packs: {
                bp: {
                    root: "bp",
                    uuid: "a",
                    moduleUuid: "b",
                    compile: { entry: "src/main.ts", scriptOutputDir: "build_scripts" },
                },
            },
        });
        expect(config.packs.bp!.compile!.scriptOutputDir).toBe("build_scripts");
    });

    it("正常化输出路径并拒绝源码目录重叠", () => {
        const normalized = normalizeConfig({
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
        expect(normalized.packs.bp!.compile!.scriptOutputDir).toBe("scripts");

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

    it("使用传入的 cwd 解析相对项目路径", () => {
        const cwd = "/tmp/bepack-project";
        const absoluteBpRoot = "/tmp/bepack-output";
        const config = normalizeConfig(
            {
                name: "test",
                packs: {
                    bp: {
                        root: absoluteBpRoot,
                        uuid: "a",
                        moduleUuid: "b",
                        compile: { entry: "src/main.ts", scriptOutputDir: "src" },
                    },
                },
            },
            {},
            cwd
        );

        expect(config.packs.bp!.compile!.scriptOutputDir).toBe("src");
    });
});

// ---------------------------------------------------------------------------
// 顶层 build 只保留命令行为配置
// ---------------------------------------------------------------------------

describe("顶层 build 配置", () => {
    it("build 只包含 copy 和 timing", () => {
        const config = normalizeConfig({
            name: "test",
            build: { copy: "win", timing: true },
            packs: {
                bp: { root: "bp", uuid: "a", moduleUuid: "b", compile: { entry: "src/main.ts" } },
            },
        });
        expect(config.build.copy).toBe("win");
        expect(config.build.timing).toBe(true);
        // 确保编译字段不在 build 中
        expect(Object.keys(config.build)).toEqual(expect.arrayContaining(["copy", "timing"]));
    });
});
