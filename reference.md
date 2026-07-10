# BePack

BePack 是一个轻量级的构建工具，用于 Minecraft 基岩版脚本 API 项目。

它管理常见的 BP/RP 项目任务：配置加载、清单修补、Minecraft 包版本解析、TypeScript 类型检查、Rolldown 构建、复制到游戏目录以及 mcpack/mcaddon 打包。

## 已实现功能

### CLI

已实现的命令：

```bash
bepack init
bepack install
bepack manifest
bepack build
bepack dev
bepack copy
bepack pack
```

通用命令选项：

```bash
--cwd <path>
--config <path>
--json
--dry-run
--silent
--verbose
```

JSON 模式会抑制常规日志，并返回机器可读的成功/错误输出。

### 配置加载

支持的配置文件：

```txt
bepack.config.ts
bepack.config.mjs
bepack.config.js
```

支持的导出方式：

```ts
export default {
    // config
};

export default (ctx) => {
    return {
        // config
    };
};
```

`defineConfig` 已导出并带有类型定义，以支持编辑器自动补全：

```ts
import { defineConfig } from "bepack";

export default defineConfig({
    root: ".",
    target: "latest",

    build: {
        entry: "src/main.ts",
    },

    packs: {
        bp: {
            root: "bp",
            uuid: "00000000-0000-0000-0000-000000000001",
            moduleUuid: "00000000-0000-0000-0000-000000000002",
            dependencies: {
                "@minecraft/server": "stable",
            },
        },
    },

    pack: {
        outDir: "dist",
    },
});
```

生成的包类型可通过以下方式使用：

```json
{
    "types": "dist/index.d.ts"
}
```

### 当前配置结构

重要字段：

```ts
type UserConfig = {
    root?: string;
    name: string;
    version?: string;
    description?: string;
    target?: string;

    /** Manifest format version: 2 (array versions, default) or 3 (SemVer string versions, Minecraft 1.21.110+ preview).
     *  Not set = auto-preserve existing manifest's format_version. New manifests default to 2. */
    manifestFormat?: 2 | 3;

    build?: {
        entry?: string;
        typecheck?: boolean;
        useNpx?: boolean;
        preserveModules?: boolean;
        external?: (string | RegExp)[];
        externalDependencies?: boolean;
        copy?: false | true | string;
        minify?: boolean;
        timing?: boolean;
    };

    packs?: {
        bp?: {
            root?: string;
            uuid: string;
            moduleUuid: string;
            /** 所有 BP 依赖都在此声明——包括清单依赖和纯代码依赖。 */
            dependencies?: Record<string, "stable" | "beta" | "preview" | string>;
            achievement?: boolean;
            /** 额外的打包/复制文件列表（在默认 include 基础上追加）。 */
            include?: string[];
        };

        rp?: {
            root?: string;
            uuid: string;
            moduleUuid: string;
            pbr?: boolean;
        };
    };

    install?: {
        registry?: string;
        saveTo?: "dependencies" | "devDependencies";
        packageManager?: "auto" | "npm" | "pnpm" | "yarn" | "bun";
        runPackageManager?: boolean;
        updatePackageJson?: boolean;
        updateManifest?: boolean;
        dependencyCatalog?: Record<string, DependencyCatalogEntry>;
        dependencyResolvers?: DependencyResolverRule[];
    };

    copy?: {
        defaultTarget?: string;
        name?: string | { bp?: string; rp?: string };
        /** RP 额外文件（BP 的额外文件请用 packs.bp.include）。 */
        include?: { rp?: string[] };
        targets?: Record<string, ({ type: "custom"; bp?: string; rp?: string } | { type: "gameRoot"; path: string }) & { name?: string | { bp?: string; rp?: string } }>;
    };

    dev?: {
        copy?: false | true | string;
        watch?: {
            include?: string[];
            include?: string[];
        };
    };

    pack?: {
        name?: string;
        outDir?: string;
    };
};
```

路径约定：

- `root` 为项目根目录。
- `build.entry` 为 Script API TypeScript 入口文件。
- `packs.bp.root` 为行为包根目录。
- `packs.rp.root` 为资源包根目录。
- `pack.outDir` 为 `.mcpack` / `.mcaddon` 的输出目录。

对于 `bepack pack`，这些字段必须显式配置，且输入路径必须存在：

```txt
build.entry
packs.bp.root
packs.rp.root（如果配置了 RP）
pack.outDir
```

## 依赖安装与解析

`bepack install` 解析受管理的依赖、修补 `package.json`、可选地修补 `manifest.json`，并可选择运行包管理器。

默认安装行为：

- 受管理的包写入 `dependencies`。
- 注册表默认为 `https://registry.npmjs.org/`。
- 包管理器默认为 `auto`。
- 默认会运行包管理器安装。
- 如果配置了 `install.registry`，包管理器安装会接收 `--registry <registry>`。

所有 BP 依赖在 `packs.bp.dependencies` 中声明。依赖目录控制每个包的行为：

| 包                              | 解析器                    | package.json | manifest.json | 打包方式 |
| ------------------------------- | ------------------------- | ------------ | ------------- | -------- |
| `@minecraft/server`             | `minecraft-script-api`    | ✅           | ✅            | 外部     |
| `@minecraft/server-ui`          | `minecraft-script-api`    | ✅           | ✅            | 外部     |
| `@minecraft/server-net`         | `minecraft-script-api-bp` | ✅           | ✅            | 外部     |
| `@minecraft/server-admin`       | `minecraft-script-api-bp` | ✅           | ✅            | 外部     |
| `@minecraft/server-gametest`    | `minecraft-script-api-bp` | ✅           | ✅            | 外部     |
| `@minecraft/vanilla-data`       | `minecraft-vanilla-data`  | ✅           | ❌            | 内联     |

### 版本解析

配置值：

```ts
dependencies: {
    "@minecraft/server": "stable",
    "@minecraft/server-ui": "beta",
    "@minecraft/vanilla-data": "preview",
}
```

受管理的 Minecraft 包在 `package.json` 中不会出现 `stable`、`beta`、`preview` 或 `latest` 字样。BePack 会从配置的注册表中解析具体的 npm 版本。

每个包的解析器决定说明符（specifier）的规则：

#### `minecraft-script-api` — `@minecraft/server`、`@minecraft/server-ui`

| 说明符     | 目标     | package.json                                      | manifest.json                        |
| ---------- | -------- | ------------------------------------------------- | ------------------------------------ |
| `stable`   | `latest` | 注册表中的最新稳定版                               | 相同版本                             |
| `stable`   | 具体版本 | 查找匹配的 beta → 推断稳定版 `betaMajor.(betaMinor-1).betaPatch` | 相同版本                             |
| `beta`     | `latest` | 所有版本中最高的 beta 版（排除 preview）           | `"beta"`                             |
| `beta`     | 具体版本 | 匹配 `*-beta.*<target>-stable` 或 `*-beta-*<target>-stable` | `"beta"`（频道依赖）或具体版本       |
| `preview`  | `latest` | 最高的 preview 版本（rc 或 beta）                  | 完整版本字符串                       |
| `preview`  | 具体版本 | 匹配 `*-{rc\|beta}.<target>-preview.*`            | 完整版本字符串                       |

#### `minecraft-script-api-bp` — `@minecraft/server-net`、`@minecraft/server-admin`、`@minecraft/server-gametest`

这些包没有稳定版本。只接受 `beta` 和 `preview`。

| 说明符     | 行为                                              |
| ---------- | ------------------------------------------------- |
| `beta`     | 同 `minecraft-script-api` 的 beta 解析方式         |
| `preview`  | 同 `minecraft-script-api` 的 preview 解析方式      |
| `stable`   | **拒绝** — `DEPENDENCY_VERSION_INVALID`            |

#### `minecraft-vanilla-data` — `@minecraft/vanilla-data`

| 说明符     | 目标         | 行为                                                        |
| ---------- | ------------ | ----------------------------------------------------------- |
| `stable`   | `latest`     | 最新稳定版（dist-tag `latest` 或最高 semver）               |
| `stable`   | `"1.26.32"`  | 如果注册表中存在，则精确使用 `1.26.32`                      |
| `preview`  | `latest`     | 最高 `X.X.X-preview.N` 版本                                 |
| `preview`  | `"1.26.40"`  | 最高 `1.26.40-preview.N` 版本                               |
| `beta`     | —            | **拒绝** — `DEPENDENCY_VERSION_INVALID`                     |

#### 稳定版推断示例

对于 `minecraft-script-api` 解析器，稳定版从对应的 beta 版本推断：

```txt
2.7.0-beta.1.26.10-stable -> 2.6.0
2.4.0-beta.1.21.120-stable -> 2.3.0
2.1.0-beta.1.26.21-stable -> 2.0.0
```

`target: "stable"` 和 `target: "beta"` 会被拒绝，因为 target 指的是 Minecraft 游戏版本，而非 Script API 频道。

其他 target 字符串会传递给注册表解析。如果找不到匹配版本，安装失败并返回 `SAPI_VERSION_NOT_FOUND`。

当清单依赖中使用 `preview` 或 `beta` 说明符而未先运行 `bepack install` 时，BePack 会抛出 `DEPENDENCY_REQUIRES_INSTALL`。这与 `stable` 的行为相同——说明符本身永远不会直接写入 `manifest.json`。

### 安装日志

常规安装日志显示简洁的进度：

```txt
[Install] resolving dependencies for target 1.26.10
[Install] fetching @minecraft/server metadata from https://registry.npmjs.org/
[Install] @minecraft/server: stable -> package 2.6.0, manifest 2.6.0
```

使用 `--verbose` 可查看更底层的详细信息，如缓存命中、版本数量和推断过程。

### 依赖目录与解析器扩展点

安装解析分为依赖目录和解析器注册表两部分。

依赖目录通过三个字段控制每个包的行为：

- `resolver`：处理此包的解析器组（例如 `"minecraft-script-api"`、`"minecraft-vanilla-data"`）。
- `packageJson`：是否写入 `package.json`（默认为 `true`）。
- `manifest`：是否写入 BP `manifest.json`（默认为 `false`）。当为 `true` 时，该包在构建时也会被外部化。
- `manifest: false`（例如 `@minecraft/vanilla-data`）的包不会写入清单，可以被内联打包。

解析器将 `stable`、`beta`、`preview` 或精确版本号转换为具体的包版本和清单版本。
解析器上下文包含 `ctx.npm`，这是一个可复用的 npm 注册表客户端，会自动使用 `install.registry` 并缓存元数据。

自定义包和解析器可以在配置中提供：

```ts
export default defineConfig({
    install: {
        dependencyCatalog: {
            "my-package": {
                resolver: "my-resolver",
                packageJson: true,
                manifest: true,
            },
        },
        dependencyResolvers: [
            {
                name: "my-resolver",
                resolver: "my-resolver",
                match(ctx) {
                    return ctx.packageName === "my-package";
                },
                async resolve(ctx) {
                    const metadata = await ctx.npm.metadata(ctx.packageName);
                    const latest = ctx.npm.distTag(metadata, "latest") ?? "1.0.0";
                    return {
                        packageVersion: latest,
                        manifestVersion: latest,
                    };
                },
            },
        ],
    },
});
```

解析器顺序：

1. 自定义 `install.dependencyResolvers`
2. 内置 `minecraft-script-api` — `@minecraft/server` 和 `@minecraft/server-ui` 的 stable/beta/preview 解析
3. 内置 `minecraft-script-api-bp` — `@minecraft/server-net`、`@minecraft/server-admin`、`@minecraft/server-gametest` 的 beta/preview 解析
4. 内置 `minecraft-vanilla-data` — `@minecraft/vanilla-data` 的 stable/preview 解析
5. 内置 `exact-version` — 任意精确版本说明符

## 清单管理

`bepack manifest` 和 `bepack install` 可以创建和修补清单。

### format_version 支持

BePack 同时支持 `format_version 2` 和 `format_version 3`（Minecraft 1.21.110+ preview）：

| 特性 | format 2 | format 3 |
|------|----------|----------|
| 版本格式 | 数组 `[1, 0, 0]` | 数组或 SemVer 字符串 `"1.0.0"` |
| 自定义设置面板 | 不支持 | 支持（预览） |
| 兼容性 | 高 | format 3 兼容 format 2 |

**format 选择优先级**：
1. 配置中显式设置 `manifestFormat: 2 | 3` → 强制使用
2. 未设置时保留 existing manifest 的 `format_version`
3. 全新 manifest 默认 `2`

**注意**：format 2 不兼容 format 3 的字符串版本。如果配置强制使用 format 2 但 existing manifest 是 format 3，BePack 会给出降级警告。

BP 清单受控字段：

- `format_version`（根据配置或 existing 保留）
- `header.name`
- `header.description`（仅在配置时）
- `header.uuid`
- `header.version`
- `header.min_engine_version`
- 脚本模块
- BePack 管理的 `@minecraft/*` 依赖
- BP/RP 相互依赖
- `metadata.product_type`（仅在 `achievement: true` 时）

RP 清单受控字段：

- `format_version`
- `header.name`
- `header.description`（仅在配置时）
- `header.uuid`
- `header.version`
- `header.min_engine_version`
- 资源模块
- RP/BP 相互依赖
- `capabilities: ["pbr"]`（当 `pbr: true` 时）

用户定义的清单字段会被保留。

当同时配置了 BP 和 RP 时，BePack 会维护它们 header UUID 之间的相互依赖。

成就元数据：

- `packs.bp.achievement: true` 添加 `metadata.product_type = "addon"`。
- 每个受管理的 Script API 依赖必须使用 `stable` 说明符。
- 如果在启用成就时使用了 `beta` 或 `preview` 依赖，BePack 会抛出 `ACHIEVEMENT_REQUIRES_STABLE_API`。

## 构建

`bepack build` 执行以下步骤：

```txt
清单修补
hooks.beforeBuild
类型检查
Rolldown 构建
hooks.afterBuild
可选复制
可选打包
```

类型检查行为：

- 默认：系统 `tsc --noEmit`。
- `build.useNpx: true` 或 `--use-npx`：`npx tsc --noEmit`。
- 缺少 `tsconfig.json` 会提前失败，返回 `TYPECHECK_FAILED`。

Rolldown 行为：

- 默认 `preserveModules: true`。
- 输出到 `<packs.bp.root>/scripts`。
- 每次构建前会清空 `<packs.bp.root>/scripts` 目录。
- `build.entry` 控制输入文件。
- 外部包来自 `build.external`，默认情况下也来自受管理的依赖目录。
- `build.minify: true` 或 `--minify` 启用 Rolldown 代码压缩，输出更小的 JS 文件。
- 构建完成后显示输出文件的大小统计（单文件显示路径和体积，多文件显示总文件数和总体积）。

`build.externalDependencies` 默认为 `true`，因此内置的 `manifest: true` 受管理包（例如 `@minecraft/server`、`@minecraft/server-ui`、`@minecraft/server-net`）不会被内联打包。`manifest: false` 的包（例如 `@minecraft/vanilla-data`）可以被内联打包。设置 `externalDependencies` 为 `false` 可自定义，或通过 `build.external` 添加额外条目。

`build.timing: true` 或 `--timing` 可在构建时显示各步骤的耗时明细，便于排查性能瓶颈：

```txt
timing    manifest        12 ms
timing    typecheck      856 ms
timing    rolldown        45 ms
```

`--timing` 同样支持 `bepack dev` 命令。

## 开发模式

`bepack dev`：

- 在监视前先执行一次初始构建。
- 支持 `--skip-typecheck` 跳过类型检查（与 `build` 命令一致）。
- 默认监视的路径：
    - `build.entry` 目录（TypeScript 源码变化 → 触发 rolldown 重构建）
    - BP 的默认 include 列表 + `packs.bp.include` 中的文件/文件夹（不含 `scripts` 和 `manifest.json`）
    - RP 的 include 列表中的文件/文件夹（如果配置了 `copy.include.rp`），否则监视整个 RP 目录
- 可通过 `dev.watch.include` 添加额外监听路径。
- 忽略以下目录：
    - `node_modules`
    - `.git`
    - `pack.outDir`
- 每次更改时清空终端输出，显示每次更新的耗时。
- 构建锁：构建过程中来的其他文件变化会排队，构建结束后统一处理一次，不会并发构建。
- src 文件变化触发重建 + 复制，非 src 文件变化只触发复制。不涉及的文件不触发任何操作。

BP 的监听范围精确匹配 copy 的 include 规则，编辑不会被复制的文件不会触发重构建。
可通过 `dev.watch.include` 添加额外监听路径：

```ts
export default defineConfig({
    dev: {
        copy: true,
        watch: {
            include: ["docs", "tools/config.json"],
        },
    },
});
```

## 复制

`bepack copy` 将 BP/RP 复制到配置的目标路径。

**如果没有配置任何复制目标，`bepack copy` 会报错。** 复制前会验证目标目录是否存在，不存在则报错。

### 内置目标

- `win`
    - 新的 Windows Minecraft 基岩版路径：
    - `%USERPROFILE%\AppData\Roaming\Minecraft Bedrock\Users\Shared\games\com.mojang`
- `winold`
    - `%LOCALAPPDATA%\Packages\Microsoft.MinecraftUWP_8wekyb3d8bbwe` 下的旧 UWP Minecraft 路径

内置目标本质上是预设路径的 `gameRoot` 类型，会自动追加 `development_behavior_packs` / `development_resource_packs` 子目录。

### 目标类型

#### `custom` — 手动指定完整路径

```ts
copy: {
    defaultTarget: "server",
    targets: {
        server: {
            type: "custom",
            bp: "/server/world/development_behavior_packs",
            rp: "/server/world/development_resource_packs",
        },
    },
}
```

#### `gameRoot` — 指定游戏根目录，自动派生子目录

```ts
copy: {
    defaultTarget: "myServer",
    targets: {
        myServer: {
            type: "gameRoot",
            path: "/server/server1",
        },
    },
}
```

对于 `gameRoot` 类型，BePack 会自动拼接路径：

- BP → `<path>/development_behavior_packs`
- RP → `<path>/development_resource_packs`（仅当项目配置了 `packs.rp` 时）

### 路径验证

所有复制目标在复制前都会验证目录是否存在。如果目标目录不存在，命令会失败并返回 `COPY_FAILED`。这适用于所有目标类型（内置 `win`/`winold`、`custom`、`gameRoot`）。

### 自定义复制文件夹名称

复制到目标目录时，BP/RP 的文件夹名称默认为 `packs.bp.name` / `packs.rp.name`，即项目配置中的包名称。可以通过 `copy.name` 或目标级 `name` 覆盖：

`name` 可以是对象（分别指定 bp/rp），也可以是字符串（bp 和 rp 使用相同名称）：

```ts
copy: {
    defaultTarget: "server",

    // 全局名称覆盖（字符串：bp 和 rp 同名）
    name: "MyPack",

    targets: {
        server: {
            type: "gameRoot",
            path: "/server/server1",
            // 目标级名称覆盖（对象：分别指定 bp/rp）
            name: {
                bp: "behavior_packs_custom",
                // rp 未设置，则回退到全局 copy.name 或 packs.rp.name
            },
        },

        staging: {
            type: "custom",
            bp: "/staging/behavior_packs",
            name: "StagingPack", // 字符串，bp 和 rp 都叫 StagingPack
        },
    },
}
```

优先级：**目标级 `name` > 全局 `copy.name` > 包配置 `packs.bp.name` / `packs.rp.name`**。

各部分独立覆盖。例如只设置 `copy.name.bp`，则 RP 名称仍使用 `packs.rp.name` 的默认值。

### 选择性复制

复制 BP 时，默认只复制以下文件/文件夹：

```
scripts  manifest.json  animation_controllers  animations  biomes
blocks  entities  functions  items  loot_tables  pack_icon.png
recipes  spawn_rules  structures  texts  trading
feature_rules  features  worldgen
```

BP 的额外文件/文件夹通过 `packs.bp.include` 配置（不会替换默认列表）：

```ts
packs: {
    bp: {
        root: "bp",
        include: ["my_custom_data", "config.json"],  // 额外复制/打包
    },
}
```

RP 默认复制整个目录。可以通过 `copy.include.rp` 添加额外的文件/文件夹——一旦设置，RP 也变为选择性复制模式：

```ts
copy: {
    defaultTarget: "server",
    include: {
        rp: ["textures", "sounds", "models"],
    },
}
```

复制项不存在时会被静默跳过，不会报错。

Dev 模式使用相同的 include 规则来决定监听哪些文件，详见「开发模式」章节。

### 复制与构建/开发联动

```ts
build: {
    copy: true,          // 构建后复制到 copy.defaultTarget
    // 或
    copy: "myTarget",    // 构建后复制到指定目标
}

dev: {
    copy: true,          // 文件变更后复制到 copy.defaultTarget
    // 或
    copy: "myTarget",    // 文件变更后复制到指定目标
}
```

`build.copy` 和 `dev.copy` 默认为 `false`（不复制）。`true` 表示使用 `copy.defaultTarget`，字符串表示使用指定目标。

## 打包

`bepack pack` 创建：

- 仅配置 BP 时创建 `.mcpack`。
- 同时配置 BP 和 RP 时创建 `.mcaddon`。

**BP 始终使用选择性打包**：只打包默认 include 列表（`scripts`、`manifest.json`、`animation_controllers` 等）和 `packs.bp.include` 中配置的额外文件。即使 `bp.root = "."`（项目根目录即行为包），也不会将整个项目打包进去。

RP 默认打包整个目录；如果配置了 `copy.include.rp`，则改用选择性打包。

输出文件名默认为：

```txt
{name}-{version}
```

输出目录通过以下方式配置：

```ts
pack: {
    outDir: "dist",
}
```

打包输入配置必须显式指定，且输入路径必须存在。这可以防止意外打包猜测的默认目录。

## 钩子

支持的钩子：

```ts
hooks: {
    beforeInstall(ctx) {},
    afterInstall(ctx) {},
    beforeManifest(ctx) {},
    afterManifest(ctx) {},
    beforeBuild(ctx) {},
    afterBuild(ctx) {},
    beforeCopy(ctx) {},
    afterCopy(ctx) {},
    beforePack(ctx) {},
    afterPack(ctx) {},
}
```

钩子可以是同步或异步的。在钩子中抛出异常会导致命令失败，返回 `HOOK_FAILED`。

## 输出与错误

常规模式下，CLI 输出使用彩色阶段标签和时间戳。

示例：

```txt
[17:30:02] [Install] resolving dependencies for target 1.26.10
[17:30:05] [Manifest] manifest.json updated
[17:30:05] [TypeScript] typecheck complete
[17:30:06] [Rolldown] preserve modules build complete
```

`--json` 模式返回 JSON 并抑制常规日志。

错误使用稳定的错误码，例如：

```txt
CONFIG_NOT_FOUND
CONFIG_INVALID
TARGET_INVALID
UNSUPPORTED_DEPENDENCY
DEPENDENCY_VERSION_INVALID
DEPENDENCY_REQUIRES_INSTALL
SAPI_VERSION_NOT_FOUND
ACHIEVEMENT_REQUIRES_STABLE_API
TYPECHECK_FAILED
BUILD_FAILED
COPY_TARGET_NOT_FOUND
COPY_FAILED
PACK_FAILED
HOOK_FAILED
CLI_ARGUMENT_CONFLICT
```

## 初始化

`bepack init` 创建 `bepack.config.ts`。它不会创建项目目录。

### 默认脚手架

```bash
bepack init
```

生成标准配置模板，使用随机 UUID。

### 从已有 manifest 反推

```bash
# 只从 BP manifest 反推
bepack init --from-bp ./bp/manifest.json

# 只从 RP manifest 反推
bepack init --from-rp ./rp/manifest.json

# BP + RP 都传
bepack init --from-bp ./bp/manifest.json --from-rp ./rp/manifest.json
```

规则：

| 场景 | 行为 |
|---|---|
| 只传 BP | 顶层 `name`/`description` 设为 BP manifest 的值 |
| 只传 RP | 同上 |
| BP + RP 都传 | 顶层 `name`/`description` 从 BP 读取；同时分别设到 `packs.bp.name`/`packs.rp.name` |
| format_version | 自动检测原 manifest 的 `format_version`，写入生成的配置的 `manifestFormat` 字段 |
| pack root | 根据 manifest 路径相对当前目录自动推导 |
| UUID | 直接读取 manifest 中的值，不重新生成 |
| 版本 | 从 manifest header 读取（支持数组 `[1,0,0]` 和字符串 `"1.0.0"`）。两个包版本不同时取最高者，并给出警告 |
| 依赖 | manifest 中的 `module_name` 依赖如果在 BePack 内置 catalog 中，自动写入配置 |
| Windows | 自动添加 `copy: { defaultTarget: "win" }" |

manifest 路径必须在当前目录内，否则报错。

如果配置文件已存在，init 会报错提示使用 `--force` 覆盖。
