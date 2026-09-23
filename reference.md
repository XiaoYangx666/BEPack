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
bepack config
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
```

`defineConfig` 已导出并带有类型定义，以支持编辑器自动补全：

```ts
import { defineConfig } from "@bepack/cli";

export default defineConfig({
    root: ".",
    target: "latest",

    packs: {
        bp: {
            root: "bp",
            uuid: "00000000-0000-0000-0000-000000000001",
            moduleUuid: "00000000-0000-0000-0000-000000000002",
            compile: {
                entry: "src/main.ts",
            },
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

#### bepack.config.ts 支持的语法范围

`.ts` 配置文件通过 Node 原生 type-stripping 加载，**只支持"可擦除"的 TypeScript 语法**：

- ✅ `import type`、类型标注、`interface` / `type`、`satisfies`、as 断言
- ✅ 带类型的箭头函数参数（如 `(ctx: { cwd: string }) => ...`）
- ❌ 运行时产生代码的 TS 语法：`enum`（建议用 `as const` 对象）、带代码的 `namespace`、构造参数属性、legacy decorators

复杂 config（或依赖运行时逻辑的配置）建议把逻辑抽到独立的 `.mjs`/`.js` 模块再在 config 里 import，或直接使用 `bepack.config.mjs` / `bepack.config.js`。

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
     *  Format 3 requires ALL version fields to be strings — arrays are rejected.
     *  Not set = auto-preserve existing manifest's format_version. New manifests default to 2. */
    manifestFormat?: 2 | 3;

    /** 编译配置移至 packs.bp.compile。顶层 build 只保留命令行为配置。 */
    build?: {
        copy?: false | true | string;
        timing?: boolean;
    };

    packs?: {
        bp?: {
            root?: string;
            uuid: string;
            /** BP 的 moduleUuid 可选。只有配置了 compile 时才需要（用来管理 script 模块）。 */
            moduleUuid?: string;
            /** BP 编译配置（入口、TypeScript 检查、Rolldown 选项）。 */
            compile?: {
                entry: string;
                /**
                 * 标识符引用替换（条件编译，推荐）。
                 * 值为 JavaScript 表达式字符串（如 `{ __TARGET__: JSON.stringify("server") }`）。
                 * 只替换**表达式位置的标识符引用**——`declare` 类型声明、对象键、字符串字面量、注释均不受影响。
                 * 与顶层 `replace` 并存；同一 key 不能同时配在两者中。
                 */
                define?: Record<string, string>;
                tsconfig?: string;
                /** 打包前是否运行 tsc 类型检查。默认 true（即默认会跑）。 */
                typecheck?: boolean;
                preserveModules?: boolean;
                external?: (string | RegExp)[];
                useNpx?: boolean;
                minify?: boolean;
                cache?: {
                    dev?: boolean; // 默认 true
                    build?: boolean; // 默认 false
                    file?: string; // 默认 "node_modules/.cache/bepack/tsconfig.tsbuildinfo"
                };
                /** 编译脚本输出目录，相对于 BP root。默认 "scripts"。 */
                scriptOutputDir?: string;
                /**
                 * 额外的 Rolldown 选项（对象），或自定义函数 (options, context) => options。
                 * 在 BePack 生成的选项之上增量合并；input 与输出位置字段由 BePack 管理。
                 */
                rolldown?: RolldownOptions | RolldownCustomizeFunction;
                /** Rolldown 配置文件路径（相对项目根或绝对路径），支持 .ts/.mts/.js/.mjs。 */
                rolldownConfig?: string;
            };
            /** 所有 BP 依赖都在此声明——包括清单依赖和纯代码依赖。 */
            dependencies?: Record<string, "stable" | "beta" | "preview" | string>;
            /**
             * manifest 生成策略。
             * - `merge: "preserve"`（默认）：增量合并，保留用户手写字段。
             * - `merge: "clean"`：从配置全量重建，非 managed 条目丢弃，改用 `extra*` 字段显式声明。
             * - `minEngineVersion`：clean 模式下的 `header.min_engine_version`（format 2 自动转数组）。
             */
            manifest?: {
                merge?: "preserve" | "clean";
                minEngineVersion?: string;
                extraDependencies?: Record<string, unknown>[];
                extraModules?: Record<string, unknown>[];
                extraHeader?: Record<string, unknown>;
            };
            /** 额外的打包/复制文件列表（在默认 include 基础上追加）。 */
            include?: string[];
        };

        rp?: {
            root?: string;
            uuid: string;
            moduleUuid: string;
            pbr?: boolean;
            /** 资源包可应用范围，写入 manifest header 的 `pack_scope`。默认 "any"。 */
            packScope?: "world" | "global" | "any";
            /** manifest 生成策略，与 bp 同构。 */
            manifest?: {
                merge?: "preserve" | "clean";
                minEngineVersion?: string;
                extraDependencies?: Record<string, unknown>[];
                extraModules?: Record<string, unknown>[];
                extraHeader?: Record<string, unknown>;
            };
            /** 额外的打包/复制文件列表。 */
            include?: string[];
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
        targets?: Record<
            string,
            ({ type: "custom"; bp?: string; rp?: string } | { type: "gameRoot"; path: string }) & {
                name?: string | { bp?: string; rp?: string };
            }
        >;
        /**
         * 复制到开发目录时也生成 __brarchive 归档，方便实机验证"打包后的形态"。
         * 默认关闭；要求与 pack.optimize 相同的 min_engine_version >= 1.26.40。
         */
        optimize?: boolean | PackOptimizeOptions;
    };

    dev?: {
        copy?: false | true | string;
        watch?: {
            include?: string[];
        };
    };

    pack?: {
        name?: string;
        outDir?: string;
        /**
         * 把包内散文件打成 __brarchive 归档（Minecraft 官方 pack optimizer 的行为）。
         * 默认关闭。开启后 BePack 会往产物 manifest 写入
         * header.pack_optimization_version = "0.1.0"（这是让引擎读归档的开关）。
         * 只影响 pack 产物；复制到开发目录默认不优化，可用 copy.optimize 开启。
         */
        optimize?: boolean | {
            /** 额外保留"散文件 + 归档存根"的目录（默认按包类型内置列表）。传 false 表示全部只进归档。 */
            keepLoose?: string[] | false;
            /** 这些目录完全不归档，只留散文件。默认无。 */
            exclude?: string[];
            /** 是否压缩 JSON 条目。默认 true。 */
            minifyJson?: boolean;
            /** 产物 manifest 里 header.pack_optimization_version 的取值。默认 "0.1.0"。 */
            packOptimizationVersion?: string;
            /** 关闭 min_engine_version < 1.26.40 时的兼容性警告。默认 false（会警告但照常输出）。 */
            allowUnsupportedTarget?: boolean;
        };
    };
};
```

路径约定：

- `root` 为项目根目录。
- `packs.bp.compile.entry` 为 Script API TypeScript 入口文件（仅 BP 配置了 compile 时）。
- `packs.bp.root` 为行为包根目录。
- `packs.rp.root` 为资源包根目录。
- `pack.outDir` 为 `.mcpack` / `.mcaddon` 的输出目录。

对于 `bepack pack`，以下字段必须显式配置，且输入路径必须存在：

```txt
packs.bp.root（如果配置了 BP）
packs.rp.root（如果配置了 RP）
pack.outDir
```

> 注意：`bepack pack` 不再校验编译入口（`packs.bp.compile.entry`），
> 也不要求 BP 存在。仅 RP 项目也可以打包为 `.mcpack`。

## 依赖安装与解析

`bepack install` 解析受管理的依赖、修补 `package.json`、可选地修补 `manifest.json`，并可选择运行包管理器。

默认安装行为：

- 受管理的包写入 `dependencies`。
- 注册表默认为 `https://registry.npmjs.org/`。
- 包管理器默认为 `auto`。
- 默认会运行包管理器安装。
- 如果配置了 `install.registry`，包管理器安装会接收 `--registry <registry>`。

所有 BP 依赖在 `packs.bp.dependencies` 中声明。依赖目录控制每个包的行为：

| 包                           | 解析器                    | package.json | manifest.json | 打包方式 |
| ---------------------------- | ------------------------- | ------------ | ------------- | -------- |
| `@minecraft/server`          | `minecraft-script-api`    | ✅           | ✅            | 外部     |
| `@minecraft/server-ui`       | `minecraft-script-api`    | ✅           | ✅            | 外部     |
| `@minecraft/server-net`      | `minecraft-script-api-bp` | ✅           | ✅            | 外部     |
| `@minecraft/server-admin`    | `minecraft-script-api-bp` | ✅           | ✅            | 外部     |
| `@minecraft/server-gametest` | `minecraft-script-api-bp` | ✅           | ✅            | 外部     |
| `@minecraft/vanilla-data`    | `minecraft-vanilla-data`  | ✅           | ❌            | 内联     |

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

| 说明符    | 目标     | package.json                                                     | manifest.json                  |
| --------- | -------- | ---------------------------------------------------------------- | ------------------------------ |
| `stable`  | `latest` | 注册表中的最新稳定版                                             | 相同版本                       |
| `stable`  | 具体版本 | 查找匹配的 beta → 推断稳定版 `betaMajor.(betaMinor-1).betaPatch` | 相同版本                       |
| `beta`    | `latest` | 所有版本中最高的 beta 版（排除 preview）                         | `"beta"`                       |
| `beta`    | 具体版本 | 匹配 `*-beta.*<target>-stable` 或 `*-beta-*<target>-stable`      | `"beta"`（频道依赖）或具体版本 |
| `preview` | `latest` | 最高的 preview 版本（rc 或 beta）                                | 完整版本字符串                 |
| `preview` | 具体版本 | 匹配 `*-{rc\|beta}.<target>-preview.*`                           | 完整版本字符串                 |

#### `minecraft-script-api-bp` — `@minecraft/server-net`、`@minecraft/server-admin`、`@minecraft/server-gametest`

这些包没有稳定版本。只接受 `beta` 和 `preview`。

| 说明符    | 行为                                          |
| --------- | --------------------------------------------- |
| `beta`    | 同 `minecraft-script-api` 的 beta 解析方式    |
| `preview` | 同 `minecraft-script-api` 的 preview 解析方式 |
| `stable`  | **拒绝** — `DEPENDENCY_VERSION_INVALID`       |

#### `minecraft-vanilla-data` — `@minecraft/vanilla-data`

| 说明符    | 目标        | 行为                                          |
| --------- | ----------- | --------------------------------------------- |
| `stable`  | `latest`    | 最新稳定版（dist-tag `latest` 或最高 semver） |
| `stable`  | `"1.26.32"` | 如果注册表中存在，则精确使用 `1.26.32`        |
| `preview` | `latest`    | 最高 `X.X.X-preview.N` 版本                   |
| `preview` | `"1.26.40"` | 最高 `1.26.40-preview.N` 版本                 |
| `beta`    | —           | **拒绝** — `DEPENDENCY_VERSION_INVALID`       |

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

### manifest 依赖版本的权威来源与日志

写入 `manifest.json` 的受管依赖版本按以下优先级决定（高 → 低）：

1. **配置里的精确版本**：`packs.bp.dependencies` 写成 `"2.10.0"` 时，它就是最终值。`bepack install` 的结果（包括注册表解析结果）与现有 manifest 里的旧值都**不会**覆盖它。
2. **`bepack install` / `build --install` 解析出的版本**：仅用于 `stable` / `beta` / `preview` 这类频道说明符。
3. **现有 manifest 中已写入的版本**：`bepack build` / `bepack manifest` / `bepack dev` **不访问网络**，频道说明符在离线时会复用 manifest 里已有的具体版本。

第 3 条曾经是最大的排查陷阱：`build` 会静默沿用旧版本，看起来像是"版本被写死"。现在每条受管依赖的最终版本都会打印出来：

```txt
manifest   @minecraft/server: 2.0.0 -> 2.10.0 (specifier "stable", install)
manifest   @minecraft/server-ui 2.0.0 kept from manifest (specifier "stable") — run `bepack install` to refresh
```

`bepack manifest --json` / `bepack build --json` 的 `files.bpManifest.dependencies` 也会返回 `{ module_name, specifier, version, source, previous }`，其中 `source` 是 `"config"`、`"install"` 或 `"manifest"`，可直接用于判断版本是谁写的。

所以：**要刷新频道依赖的具体版本，必须联网执行 `bepack install`（或 `bepack build --install`）**；只想固定某个版本，就在配置里写精确版本号。

### 安装日志

常规安装日志显示简洁的进度：

```txt
[Install] resolving dependencies for target 1.26.10
[Install] fetching @minecraft/server metadata from https://registry.npmjs.org/
[Install] @minecraft/server: stable -> package 2.6.0, manifest 2.6.0
```

使用 `--verbose` 可查看更底层的详细信息，如缓存命中、版本数量和推断过程。

### npm 12 与 `--allow-scripts`

npm 12 会把 `--allow-scripts` 当作 CLI 层策略，并**拒绝在项目级安装中使用**：

```txt
npm error code EALLOWSCRIPTS
npm error --allow-scripts is not allowed in project-scoped installs.
```

`npm run <script>` 会把解析出的 npm 配置导出成 `npm_config_*` 环境变量，所以只要用户级/全局 `.npmrc` 里写了 `allow-scripts=...`，这个值就会泄漏到 `bepack install` 子进程里，让它调用的 `npm install` 直接失败。BePack 在启动包管理器前会剔除继承来的 `npm_config_allow_scripts` 并打印一条提示；允许列表本身仍然通过 `.npmrc` 或 `package.json` 的 `allowScripts` 字段生效（这正是 npm 报错里建议的做法）。其它 npm 配置（registry、认证等）不受影响，仍会传给子进程。

需要完全跳过包管理器时用 `install.runPackageManager: false`，或 CLI `bepack install --skip-pm`。

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

### 依赖错误排查

`UNSUPPORTED_DEPENDENCY` 报错会附带**当前可用的 catalog 包列表**与扩展指引：

```txt
[Error] foo-pkg is not a managed dependency.
  → Managed packages: @minecraft/server, @minecraft/server-ui, ...
  → Add a missing package to install.dependencyCatalog, or remove it from packs.bp.dependencies.
```

执行 `bepack config --summary`（或 `bepack config --json`）可查看当前生效的完整依赖目录（内置 + 插件 + 自定义 `install.dependencyCatalog`）与解析器注册顺序。

## 清单管理

`bepack manifest` 和 `bepack install` 可以创建和修补清单。

### format_version 支持

BePack 同时支持 `format_version 2` 和 `format_version 3`（Minecraft 1.21.110+ preview）：

| 特性           | format 2         | format 3                                  |
| -------------- | ---------------- | ----------------------------------------- |
| 版本格式       | 数组 `[1, 0, 0]` | SemVer 字符串 `"1.0.0"`（**不接受数组**） |
| 自定义设置面板 | 不支持           | 支持（预览）                              |
| 兼容性         | 高               | **不兼容** format 2 的数组版本            |

版本字段适用范围：`header.version`、`header.min_engine_version`、`modules[].version`、dependencies 中 uuid 依赖的 `version`。Script API 的 `module_name` 依赖始终为字符串，不受影响。

**format 选择优先级**：

1. 配置中显式设置 `manifestFormat: 2 | 3` → 强制使用
2. 未设置时保留 existing manifest 的 `format_version`
3. 全新 manifest 默认 `2`

**注意**：

- format 2 不兼容 format 3 的字符串版本。如果配置强制使用 format 2 但 existing manifest 是 format 3，BePack 会给出降级警告。
- `bepack init --from-bp/--from-rp` 会自动检测 manifest 的 `format_version` 和 `header.version` 实际格式是否一致。如果不一致（如 format=3 但 version 是数组），会按照 format 2 处理并给出警告。

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

RP 清单受控字段：

- `format_version`
- `header.name`
- `header.description`（仅在配置时）
- `header.uuid`
- `header.version`
- `header.min_engine_version`
- `header.pack_scope`（当 `packs.rp.packScope` 配置时）
- 资源模块
- RP/BP 相互依赖
- `capabilities: ["pbr"]`（当 `pbr: true` 时）

用户定义的清单字段会被保留。

当同时配置了 BP 和 RP 时，BePack 会维护它们 header UUID 之间的相互依赖。

### manifest 生成策略

`packs.bp.manifest` / `packs.rp.manifest` 控制清单如何与已有文件合并：

| 条目来源 | `merge: "preserve"`（默认） | `merge: "clean"` |
| -------- | --------------------------- | ---------------- |
| `header.name` / `description` / `uuid` / `version` | config | config |
| `header.min_engine_version` | 保留旧文件值；配置了 `minEngineVersion` 时以配置为准 | config（缺省用默认值，可用 `minEngineVersion` 显式指定） |
| managed 依赖 / module | 重建 | 重建 |
| 非 managed 条目（手写依赖、额外 module、capabilities 等） | **保留** | **丢弃**，改用 `extra*` 字段显式声明 |
| 其他 config 的残留（双配置交替构建） | 保留 → 污染 | **清除** |

`minEngineVersion` 在两种模式下都生效：`preserve` 下它覆盖 manifest 里已有的值（不改配置就继续保留旧值），`clean` 下它就是生成值。

`clean` 模式下可用的补充字段：

- `minEngineVersion`：写 `header.min_engine_version`。SemVer 字符串（如 `"1.21.80"`），format 2 自动转 `[1, 21, 80]`。两种 merge 模式都可用。
- `extraDependencies`：原样追加到 `dependencies`（非 catalog 依赖）。
- `extraModules`：原样追加到 `modules`（如自定义 script 模块）。
- `extraHeader`：合并进 `header`（如 `pack_scope`）。

推荐用法——双配置交替构建时，用 `clean` 的一侧从配置全量生成，杜绝另一侧 config 的残留：

```ts
// bepack.server.config.ts
export default defineConfig({
    packs: {
        bp: {
            root: "bp",
            manifest: { merge: "clean", minEngineVersion: "1.21.80" },
        },
    },
});
```

client 侧保持默认 `preserve`（尊重手写 manifest），server 侧 `clean`（从配置全量生成），无需再写外部清理脚本。

## 构建

`bepack build` 执行以下步骤：

```txt
清单修补（hooks.beforeManifest / afterManifest）
hooks.beforeBuild
类型检查（tsc --noEmit，默认开启）
Rolldown 构建
hooks.afterBuild
可选复制（hooks.beforeCopy / afterCopy）
可选打包（hooks.beforePack / afterPack）
```

> **默认会运行 TypeScript 类型检查。** 只要配置了 `packs.bp.compile`，`bepack build` 与 `bepack dev` 都会在 Rolldown 打包**之前**执行 `tsc --noEmit`；检查失败会以 `TYPECHECK_FAILED` 终止本次构建，不会产出残缺脚本。跳过方式：CLI `--skip-typecheck`，或 `packs.bp.compile.typecheck: false`。注意类型检查与打包是两件独立的事——自定义 Rolldown 选项、替换 `rolldown` 配置都不会关闭它，要关只能显式配置。

CLI 选项：

- `--mode <value>`：执行模式，透传给 Hook 上下文（`HookContext.mode`）。不设则为 `undefined`。Hook 内自行判断是否执行特定逻辑。
- `--rolldown-config <path>`：临时指定 Rolldown 配置文件，覆盖 `packs.bp.compile.rolldownConfig`（`bepack dev` 同样支持）。
- `--optimize`：与 `--pack` / `--copy` 一起使用时，把产物（或开发目录）优化为 `__brarchive/` 归档（`--no-optimize` 可覆盖配置）。详见《打包》一节的 Pack 优化。

类型检查行为：

- **默认：系统 `tsc --noEmit`（`packs.bp.compile.typecheck` 默认为 `true`）。** 只有显式设置 `typecheck: false` 或传 `--skip-typecheck` 才会跳过。
- `build.useNpx: true` 或 `--use-npx`：`npx tsc --noEmit`。
- `packs.bp.compile.cache`：增量编译缓存配置。`cache.dev`（默认 `true`）控制 dev 模式；`cache.build`（默认 `false`）控制 build 模式。`cache.file` 指定 `.tsbuildinfo` 路径。`bepack build --cache` / `--no-cache` 可覆盖 build 模式。`dev` 命令默认启用缓存。
- 缺少 `tsconfig.json` 会提前失败，返回 `TYPECHECK_FAILED`。
- 类型检查在 `hooks.beforeBuild` 之后、Rolldown 之前运行；`--dry-run` 会跳过它。

Rolldown 行为：

- 默认 `preserveModules: true`（在 `packs.bp.compile.preserveModules` 中配置）。
- 输出到 `<packs.bp.root>/scripts`。
- 每次构建前会清空 `<packs.bp.root>/scripts` 目录。
- `packs.bp.compile.entry` 控制输入文件。
- `packs.bp.compile.scriptOutputDir` 控制编译脚本输出目录（相对于 BP root），默认 `"scripts"`。manifest 中的 script 模块 `entry` 路径也会随之更新为 `<scriptOutputDir>/<entry文件名>.js`。
- 外部包来自 `packs.bp.compile.external`，默认情况下也来自受管理的依赖目录。
- `packs.bp.compile.minify: true` 或 `--minify` 启用 Rolldown 代码压缩，输出更小的 JS 文件。
- 字符串替换通过顶层 `replace` 配置：`replace.values` 支持字面量或接收已解析 config 的函数；`replace.builtins` 可开启 `**VERSION**`、`**NAME**`、`**UUID**`、`**DESCRIPTION**`。未配置替换时不会创建 replace plugin。所有替换 key 都按**字面精确匹配**（不做单词边界匹配），因此自定义值可以放心使用 `**自定义标记**` 这类被非单词字符包围的 token，例如 `replace.values: { "**AUTHOR**": "Your Name" }`。`**DESCRIPTION**` 优先使用 `packs.bp.description`，再回退到根 `description`。**feature flag / 条件编译请优先用 `packs.bp.compile.define`**（详见《构建注入与条件编译》），`replace` 保留给模板 token 等文本级替换。
- 构建完成后显示输出文件的大小统计（单文件显示路径和体积，多文件显示总文件数和总体积）。

> 注意：构建命令（`build` / `dev`）不再要求 BP 必须存在。如果项目只有 RP 或 BP 没有配置 `compile`，则跳过编译流程，只执行 manifest 修补和可选的文件复制/打包。

`manifest: true` 的受管理包（例如 `@minecraft/server`、`@minecraft/server-ui`、`@minecraft/server-net`）**始终**作为 external 写入 rolldown，不会被内联打包；`manifest: false` 的包（例如 `@minecraft/vanilla-data`）可以被打包进产物。需要额外的 external 时，通过 `packs.bp.compile.external` 追加字符串或正则。

`build.timing: true` 或 `--timing` 可在构建时显示各步骤的耗时明细，便于排查性能瓶颈：

```txt
timing    manifest        12 ms
timing    typecheck      856 ms
timing    rolldown        45 ms
```

`--timing` 同样支持 `bepack dev` 命令。

## 自定义 Rolldown 配置

`packs.bp.compile` 覆盖了常见场景，Rolldown 的完整能力通过三个入口开放：

- `packs.bp.compile.rolldown`：内联选项对象，或自定义函数；
- `packs.bp.compile.rolldownConfig`：Rolldown 配置文件路径（相对项目根或绝对路径）；
- CLI：`bepack build --rolldown-config <path>` / `bepack dev --rolldown-config <path>`，临时替换配置文件。

> 自定义 Rolldown 配置**不会**关闭类型检查：`bepack build` / `bepack dev` 依然会先执行 `tsc --noEmit`（默认开启，详见《构建》一节）。

### 对象形式

```ts
packs: {
    bp: {
        compile: {
            entry: "src/main.ts",
            rolldown: {
                resolve: { alias: { "@lib": "./src/lib" } },
                treeshake: { moduleSideEffects: false },
                output: { sourcemap: true },
            },
        },
    },
}
```

### 函数形式

函数接收当前已合并的选项与上下文，返回值再按同样的规则合并一次；返回空则不做改动：

```ts
packs: {
    bp: {
        compile: {
            rolldown(options, context) {
                if (context.command === "dev") return { output: { sourcemap: true } };
                return {};
            },
        },
    },
}
```

上下文 `RolldownCustomizeContext` 字段：`command`（`"build"` / `"dev"`）、`mode`（CLI `--mode`）、`target`、`entry`、`outDir`、`outFile`、`preserveModules`，路径均为绝对路径。

### 配置文件

配置文件由 Rolldown 自带的加载器读取，因此 `.ts` / `.mts` / `.js` / `.mjs` 都支持，默认导出可以是选项对象、单元素数组或函数（与 `rolldown.config.ts` 用法一致）：

```ts
// rolldown.bp.config.ts
import { defineConfig } from "rolldown";

export default defineConfig({
    resolve: { alias: { "@lib": "./src/lib" } },
});
```

- 只支持**单个**配置：导出多元素数组会报 `CONFIG_INVALID`（BePack 每次只构建一个 BP）。
- `.ts` 配置文件会先被 Rolldown 打包成 `rolldown.config.<hash>.js` 再导入，随后删除；`dev` watcher 已忽略该临时文件。
- 优先级：`--rolldown-config` > `compile.rolldownConfig` > `compile.rolldown`。

### 合并规则

BePack 先生成基础选项，再把自定义选项合并上去：

| 字段 | 规则 |
| --- | --- |
| `plugins` | 追加在 BePack 插件（replace / define）之后 |
| `external` | 取并集（字符串去重，`RegExp` 原样保留） |
| `transform`、`resolve`、`experimental`、`checks`、`optimization`、`watch`、`moduleTypes`、`output` | 一层深合并；其中 `transform.define` 按 key 合并，不会清掉 `compile.define` |
| 其它字段 | 用户值直接覆盖 |

函数返回值按同一规则合并——因此只能追加，不能移除 BePack 的插件或受管理的外部依赖。

### 受保护字段

以下字段由 BePack 管理，配成其它值会报 `CONFIG_INVALID`（manifest 的 script entry、复制、打包、dev 监听都依赖它们）：

| 字段 | 替代方式 |
| --- | --- |
| `input` | `packs.bp.compile.entry` |
| `output.file` / `output.dir` | `packs.bp.compile.scriptOutputDir` |
| `output.preserveModules` / `output.preserveModulesRoot` | `packs.bp.compile.preserveModules` |
| `output.entryFileNames` | manifest script entry 假定"每个源模块一个 `.js`" |
| `output.format` | Script API 只支持 ESM |
| `output` 数组（多输出） | 不支持，BePack 只写一个输出 |

## 构建注入与条件编译

BePack 提供两种编译期注入机制，**建议按用途选择**：

| 对比 | `replace`（顶层） | `define`（`packs.bp.compile.define`） |
| ---- | ---------------- | ------------------------------------- |
| 替换目标 | 所有出现位置（声明、注释、字符串内也换） | **仅标识符引用**（表达式位置） |
| `declare const __T__: ...` | 被破坏（`declare const "client"`） | **保留**（typecheck 正常） |
| `if (__T__ === "server")` | 可折叠 | 可折叠 |
| 典型用途 | 模板 token、历史兼容 | **feature flag / 条件编译（推荐）** |
| 冲突规则 | — | 与 `replace.values` 同一 key 同时配置会报错 |

### define 用法

`define` 的值是 **JavaScript 表达式字符串**，写入前 BePack 会做语法校验并定位报错：

```ts
export default defineConfig({
    packs: {
        bp: {
            compile: {
                entry: "src/main.ts",
                define: {
                    __TARGET__: JSON.stringify("server"), // → '"server"'
                    __FLAG__: "true",                     // → true
                },
            },
        },
    },
});
```

`declare` 声明可以留在源码里，typecheck 与运行时都正常：

```ts
declare const __TARGET__: "server" | "client";

if (__TARGET__ === "server") {
    console.log("server-only path");
}
```

编译产物只替换引用：对象键、字符串字面量、注释中的同名 token 均不受影响。

### 双产物示例（一次构建产出 server / client 两份脚本）

利用两套 config + 共享的 `declare` 声明：

```ts
// src/main.ts
declare const __TARGET__: "server" | "client";
export const target = __TARGET__;
```

```ts
// bepack.server.config.ts
export default defineConfig({
    name: "my-addon-server",
    packs: {
        bp: {
            root: "bp",
            compile: { entry: "src/main.ts", define: { __TARGET__: JSON.stringify("server") } },
        },
    },
});
```

```ts
// bepack.client.config.ts —— 同上，仅 define 值改为 JSON.stringify("client")
```

```bash
bepack build --config bepack.server.config.ts
bepack build --config bepack.client.config.ts
```

## Tree-shaking 与产物裁剪

BePack 默认 `preserveModules: true`，Rolldown 仍会做 tree-shaking：

- **未引用的模块**（import 了但没有任何导出被使用）不会出现在输出目录。
- **死代码导出**（同模块内未被引用的导出）被剔除。
- **动态 `import()`** 会拆分为独立 chunk 输出（如 `dynamic.js`），并按需加载。
- 结果：输出目录 = 仅存活模块 + 动态 import chunk。

验证方法：构建后检查 `<packs.bp.root>/<scriptOutputDir>`（默认 `bp/scripts`）下的文件列表，对比源码模块数。

## 开发模式

`bepack dev`：

- 在监视前先执行一次初始构建（manifest + 若有 compile 则编译）。
- 支持 `--skip-typecheck` 跳过类型检查（与 `build` 命令一致）。
- 支持 `--mode <value>`，用法与 `build` 命令相同，透传给 Hook 上下文。初始构建和后续增量重建均会传入该值。
- 支持 `--optimize`：每次自动复制都生成 `__brarchive/` 归档（等价于 `copy.optimize: true`，`--no-optimize` 可覆盖配置）。
- 默认监视的路径：
    - `packs.bp.compile.entry` 所在目录（仅在 BP 配置了 compile 时，TypeScript 源码变化 → 触发编译）
    - BP 的默认 include 列表 + `packs.bp.include` 中的文件/文件夹（不含 `scripts` 和 `manifest.json`）
    - RP 的 include 列表中的文件/文件夹（如果配置了 `packs.rp.include`），否则监视整个 RP 目录
- 可通过 `dev.watch.include` 添加额外监听路径。
- 忽略以下目录：
    - `node_modules`
    - `.git`
    - `pack.outDir`
- 每次更改时清空终端输出，显示每次更新的耗时。
- 构建锁：构建过程中来的其他文件变化会排队，构建结束后统一处理一次，不会并发构建。
- src 文件变化触发重建 + 复制，非 src 文件变化只触发复制。不涉及的文件不触发任何操作。
- 自动复制同样会触发 `beforeCopy` / `afterCopy`，重建会触发 `beforeManifest` / `afterManifest` / `beforeBuild` / `afterBuild`（`ctx.command === "dev"`）。
- 如果最终没有任何可监听路径（没配 compile、复制关闭、`dev.watch.include` 为空），`bepack dev` 会直接以 `DEV_NO_WATCH_TARGETS` 报错，而不是打印一行空的 "watching" 后静默退出。

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

CLI 选项：

- `--target <target>`：指定复制目标。
- `--all`：复制到所有目标。
- `--optimize`：复制时生成 `__brarchive/` 归档（`--no-optimize` 覆盖配置），详见下文《复制时也做 Pack 优化》。

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

```txt
scripts  manifest.json  animation_controllers  animations  biomes
blocks  cameras  dialogue  entities  functions  items  loot_tables
pack_icon.png  recipes  shapes  spawn_rules  structures  texts  trading
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

RP 的额外文件/文件夹通过 `packs.rp.include` 配置——一旦设置，RP 也变为选择性复制模式：

```ts
packs: {
    rp: {
        root: "rp",
        include: ["textures", "sounds", "models"],  // 额外复制/打包
    },
}
```

复制项不存在时会被静默跳过，不会报错。

**不在 include 列表里的顶层条目会被跳过，并且现在会打印警告**（复制和打包都会）：

```txt
behavior pack pack only includes 20 configured item(s); 2 entries in "bp" are skipped:
README_中文.md, custom_data. Add them to packs.bp.include to include them.
```

BP 与 RP 的默认行为不对称（BP 是白名单收，RP 默认整目录），但只要有条目被跳过就会有上面这条警告，不会再无声丢文件。隐藏条目（`.` 开头）和 `node_modules` 不计入警告，避免噪音。

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

### 复制时也做 Pack 优化

复制到开发目录默认是"散文件"形态，与发布产物（可能带 `__brarchive/`）不同。为了让开发者能在实机里提前验证**打包后的形态**，可以单独开启 `copy.optimize`：

```ts
copy: {
    defaultTarget: "minecraft",
    optimize: true,          // 或与 pack.optimize 相同的选项对象
},
```

```bash
bepack copy --optimize               # 临时开启（--no-optimize 覆盖配置）
bepack build --copy --optimize       # build 的 --optimize 同时作用于 pack 与 copy
bepack dev --optimize                # dev 的每次自动复制也生成归档
```

行为与 `pack.optimize` 完全一致（同一套镜像规则、排除表、JSON 压缩、1.26.40 门槛），区别只是输出到开发目录而不是 `.mcpack`。默认不保留散文件，因此开发目录里的形态与发布产物一致；需要同时保留散文件时用 `optimize: { keepLooseFiles: true }`。

## 打包

`bepack pack` 创建：

- 仅配置 BP 时创建 `.mcpack`。
- 同时配置 BP 和 RP 时创建 `.mcaddon`。

**`bepack pack` 默认先构建再打包**：打包只是把磁盘上的文件收进压缩包，不重新编译，所以单独执行 `pack` 曾经可能把旧的 `scripts/*.js` 打进产物。现在它会先跑一次完整的构建（manifest 修补、类型检查、Rolldown），再打包，因此下面两条命令等价：

```bash
bepack pack
bepack build --pack
```

需要"只压缩当前目录、不要构建"时用 `--no-build`（或 `--skip-build`）：

```bash
bepack pack --no-build
```

因为多了一次构建，`pack` 也会触发构建与清单钩子：`beforeManifest` / `afterManifest` / `beforeBuild` / `afterBuild`（`ctx.command === "build"`），随后是 `beforePack` / `afterPack`（`ctx.command === "pack"`）。`--no-build` 时只触发打包钩子。

`--dry-run` 只汇报将要产出的文件，不写盘：

```txt
√ pack dry-run: would pack dist/my-addon-1.0.0.mcpack (no file written)
```

**BP 始终使用选择性打包**：只打包默认 include 列表（`scripts`、`manifest.json`、`animation_controllers` 等）和 `packs.bp.include` 中配置的额外文件。即使 `bp.root = "."`（项目根目录即行为包），也不会将整个项目打包进去。

RP 默认打包整个目录；如果配置了 `packs.rp.include`，则改用选择性打包。

两种模式下被跳过的顶层条目都会打印警告，详见「选择性复制」一节。

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

### Pack 优化（`__brarchive`）

Minecraft 1.26.40 起官方提供 **Pack Optimization**：把包里的散文件装进 `__brarchive/` 归档，并对 JSON 做压缩。BePack 可以在打包时做同样的事：

```ts
pack: {
    outDir: "dist",
    optimize: true,               // 或传入下面的选项对象
}
```

```bash
bepack pack --optimize            # 临时开启（--no-optimize 可覆盖配置里的开启状态）
bepack build --pack --optimize    # 构建后打包并优化
```

产物结构（只影响 `.mcpack` / `.mcaddon` 内部，磁盘上的包目录**不会被修改**）：

```txt
manifest.json                     # 包根散文件保持原样，并写入 pack_optimization_version
functions/diag_fn.mcfunction      # 按路径引用的目录：散文件保留（归档里只登记文件名）
texts/en_US.lang
__brarchive/entities.brarchive    # 注册表型目录：完整内容进归档，散文件删除
__brarchive/entities/sub.brarchive   # 每个目录一个归档，镜像目录树
```

规则：

- **开关是产物 `manifest.json` 里的 `header.pack_optimization_version`**，BePack 默认写入 `"0.1.0"`。只有这个字段能让引擎从 `__brarchive/` 读取注册表；写成游戏版本号（如 `"1.26.40"`）无效。它只写进产物，磁盘上的 `manifest.json` 不受影响。
- `header.min_engine_version` **不参与判断**（原版 `vanilla` 行为包是 `[1,13,0]` 且带归档）。低于 1.26.40 时只是打印一条警告：旧客户端没有归档支持，只能看到保留散文件的那部分。
- 每个目录（递归）生成 `<包根>/__brarchive/<相对目录>.brarchive`，条目名是**裸文件名**（如 `entities.brarchive` 里是 `zombie.json`），按名称排序；文件名最多 247 字节。
- 包根散文件（`manifest.json`、`pack_icon.png` 等）不归档；已存在的 `__brarchive/` 内容原样保留。
- **按路径引用**的目录会把散文件留在原处，归档里只写一条 **0 字节存根**（登记文件名）——这是原版 `structures/**`、`sounds/**`、`texts` 的做法。默认列表：
    - 行为包：`functions`、`loot_tables`、`structures`、`texts`
    - 资源包：`font`、`materials`、`sounds`、`texts`、`textures`
- 其余目录（`entities`、`items`、`blocks`、`recipes`、`shapes`、`spawn_rules`、`trading`、`models`、`ui`、`particles`、`render_controllers` 等）归档**完整内容并删除散文件**。
- JSON 条目会被压缩（`{ "a": 1 }` → `{"a":1}`），非 JSON（`.lang`、二进制、`MCB`）原样存储；JSON 解析失败时也原样存储，不会损坏文件。

想调整时用这些选项：

| 选项 | 作用 |
| --- | --- |
| `keepLoose: ["blocks"]` | 额外把某些目录改成"散文件 + 存根" |
| `keepLoose: false` | 不保留任何散文件（产物最小，全部只进归档） |
| `exclude: ["blocks"]` | 这些目录完全不归档，只留散文件 |
| `keepLooseFiles: true` | 归档 + 完整散文件都写（体积最大，兼容 1.26.40 之前的旧客户端） |
| `minifyJson: false` | 不压缩 JSON 条目（排查问题用） |
| `packOptimizationVersion: "0.2.0"` | 改用其它优化版本号 |

**实机验证（1.26.40 客户端，内置 `@minecraft/server` 探针脚本）**：

| 内容 | 存放方式 | 结果 |
| --- | --- | --- |
| `blocks/`、`items/`、`entities/`、`recipes/` | 归档完整内容、删除散文件 | ✅ `BlockTypes/ItemTypes/EntityTypes.get()` 与 `spawnEntity()` 全部通过；配方也从归档正常解析 |
| `functions/`、`loot_tables/` | 散文件 + 归档存根 | ✅ `/function`、`/loot spawn … loot …` 均返回 success=1 |
| `structures/` | 散文件 + 归档存根 | ⚠️ `/place structure` 在本机返回 success=0（原版对照名称带 `/` 需要加引号，未能取得正向对照），建议自行用结构方块验证 |
| `texts/` | 散文件 + 归档存根 | ✅ 散文件 `.lang` 正常（中文客户端需自带 `zh_CN.lang`，否则显示 key） |

> **`scripts/` 默认也会归档**（官方 `behavior_packs/editor` 就是这样，且实测脚本模块可从归档加载）；上面的探针为了确保一定输出，用的是 `keepLoose: ["scripts"]`。如果你的脚本在归档后不执行，加 `keepLoose: ["scripts"]` 即可。
>
> **注意模块 UUID 不能重复**：手写 `manifest.json` 里的 `data`/`resources` 模块 UUID 必须和 `packs.bp.moduleUuid`（脚本模块）不同，否则引擎会丢掉脚本模块且没有明显报错。

> **兼容性**：能读 `__brarchive/` 的客户端才有完整内容；1.26.40 之前的客户端只能看到"保留散文件"的目录。设 `allowUnsupportedTarget: true` 可关闭 min_engine_version 警告。
>
> 同一套选项也适用于复制：见《复制》一节的[复制时也做 Pack 优化](#复制时也做-pack-优化)。

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

### 每个命令实际触发哪些钩子

钩子不是"配置了就一定会在每条命令里跑"，而是挂在具体的步骤上。当前实现（`ctx.command` 标明是谁触发的）：

| 命令 | 触发的钩子（按顺序） |
| --- | --- |
| `manifest` | beforeManifest, afterManifest |
| `install` | beforeInstall, afterInstall；`install.updateManifest` 为真时中间还有 beforeManifest, afterManifest |
| `copy` | beforeCopy, afterCopy |
| `pack` | beforeManifest, afterManifest, beforeBuild, afterBuild（来自先构建的步骤）→ beforePack, afterPack |
| `pack --no-build` | beforePack, afterPack |
| `build` | beforeManifest, afterManifest, beforeBuild, afterBuild |
| `build --copy` | 上面 4 个 + beforeCopy, afterCopy |
| `build --pack` | 上面 4 个 + beforePack, afterPack |
| `build --copy --pack` | 上面 4 个 + beforeCopy, afterCopy + beforePack, afterPack |
| `build --install` | beforeInstall, afterInstall（含 manifest 钩子）→ 再走 build 的完整流程 |
| `dev`（首次构建、src 变化重建） | beforeManifest, afterManifest, beforeBuild, afterBuild；自动复制时还有 beforeCopy, afterCopy |
| `dev`（非 src 变化，仅刷新包） | beforeManifest, afterManifest；自动复制时还有 beforeCopy, afterCopy |

规则总结：

- **任何会改写 `manifest.json` 的命令都会触发 `beforeManifest` / `afterManifest`**，包括 `build`、`dev`、`install` 和先构建的 `pack`——不再是只有 `manifest` 命令。
- **`build --copy` 与 `dev` 的自动复制都会触发 `beforeCopy` / `afterCopy`**，因此"复制前改文件"的钩子对所有复制路径都有效。
- 打包钩子只由 `runPack` 触发，所以 `build --pack`、`pack` 都会走。

钩子上下文类型：

```ts
type HookContext = {
    command: CommandName; // "build" | "dev" | "install" | "pack" | ...
    cwd: string;
    mode?: string; // 通过 --mode <value> 传入的执行模式
    target: string;
    dryRun: boolean; // 本次命令是否 --dry-run（此时不会写任何文件）
    config: ResolvedConfig;
    paths: {
        dist: string;
        bpRoot?: string;
        rpRoot?: string;
        bpManifest?: string;
        rpManifest?: string;
        srcEntry?: string;
        scriptOutFile?: string; // 编译输出文件路径
        scriptOutDir?: string; // 编译输出目录路径
    };
    logger: LoggerLike;
};
```

`dryRun` 由命令的 `--dry-run` 决定，钩子内可直接 `if (ctx.dryRun) return;`，不必再读 `process.argv`。

钩子可以是同步或异步的。在钩子中抛出异常会导致命令失败，返回 `HOOK_FAILED`。

`mode` 来自 CLI `--mode <value>` 选项（目前 `build` 和 `dev` 命令支持），BEPack 不做语义判断，由用户在钩子内自行决定是否执行特定逻辑：

```ts
hooks: {
    async afterBuild({ mode }) {
        if (mode === "template") return;       // 模板构建跳过复制
        await copyFilesToOutput();
    },
}
```

未传入 `--mode` 时，`mode` 为 `undefined`，保持完全向后兼容。

#### `--mode` 取值约定

BePack 对 `mode` 的取值**不做语义判断**，以下只是社区推荐约定（可自定义）：

| mode | 语义 |
| ---- | ---- |
| `development` | 开发构建（默认不传时的常见取值），跳过发布相关动作 |
| `release` / `template` | 发布 / 模板构建，可跳过复制、跳过打包 |
| 自定义任意字符串 | 由钩子内自行判断 |

要点：

- `mode` 透传给**同一命令的所有相关钩子**（如 `build` 的 `beforeBuild` / `afterBuild`；`dev` 的初始构建与增量重建）。
- 判断用 `===` 精确匹配；未传 `--mode` 时 `mode === undefined`，可当作默认分支。
- 不要依赖 `mode` 来区分命令——命令用 `ctx.command`（`"build"` / `"dev"` / ...）判断。

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
TYPECHECK_FAILED
BUILD_FAILED
DEV_NO_WATCH_TARGETS
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

| 场景           | 行为                                                                                                                                                                                                     |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 只传 BP        | 顶层 `name`/`description` 设为 BP manifest 的值                                                                                                                                                          |
| 只传 RP        | 同上                                                                                                                                                                                                     |
| BP + RP 都传   | 顶层 `name`/`description` 从 BP 读取；同时分别设到 `packs.bp.name`/`packs.rp.name`                                                                                                                       |
| format_version | 自动检测原 manifest 的 `format_version`，写入生成的配置的 `manifestFormat` 字段。如果 `format_version` 与 `header.version` 的实际格式不符（如 format=3 但 version 是数组），降级为 format 2 并警告       |
| pack root      | 根据 manifest 路径相对当前目录自动推导                                                                                                                                                                   |
| UUID           | 直接读取 manifest 中的值，不重新生成                                                                                                                                                                     |
| 版本           | 从 manifest header 读取（支持数组 `[1,0,0]` 和字符串 `"1.0.0"`）。两个包版本不同时取最高者，并给出警告                                                                                                   |
| 依赖           | manifest 中的 `module_name` 依赖如果在 BePack 内置 catalog 中，自动写入配置                                                                                                                              |
| 编译脚本       | 只有在磁盘上确实存在匹配源文件（`src/<入口>.ts` / `.mts` / `.js` / `.mjs`）时才开启 compile，并根据模块 `entry` 推断输出目录：`"scripts/main.js"` → `entry: "src/main.ts"`, `scriptOutputDir: "scripts"`；`"custom/app.js"` → `entry: "src/app.ts"`, `scriptOutputDir: "custom"`。源文件存在但没有 `tsconfig.json` 时生成 `typecheck: false` 并警告；脚本已在包内且没有源文件时不生成 `compile`（包内 `scripts/` 原样复制/打包），避免生成首次构建就失败的配置 |
| Windows        | 自动添加 `copy: { defaultTarget: "win" }"                                                                                                                                                                |

manifest 路径必须在当前目录内，否则报错。

如果配置文件已存在，init 会报错提示使用 `--force` 覆盖。

`--dry-run` 只打印将要创建的文件（`init dry-run: would create …`），既不写文件也不创建目录。
