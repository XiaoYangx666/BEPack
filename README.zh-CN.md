<p align="center">
  <img src="./assets/bepack-logo-horizontal.png" alt="BePack" width="400" />
</p>

<p align="center">
  Minecraft Bedrock 附加包的现代化构建与发布工具链。
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@bepack/cli"><img src="https://img.shields.io/npm/v/@bepack/cli.svg?style=flat-square" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/@bepack/cli"><img src="https://img.shields.io/npm/dm/@bepack/cli.svg?style=flat-square" alt="npm downloads" /></a>
  <a href="https://github.com/XiaoYangx666/BEPack/blob/main/LICENSE"><img src="https://img.shields.io/github/license/XiaoYangx666/BEPack.svg?style=flat-square" alt="license" /></a>
  <a href="https://github.com/XiaoYangx666/BEPack"><img src="https://img.shields.io/github/stars/XiaoYangx666/BEPack.svg?style=flat-square" alt="GitHub stars" /></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/node/v/@bepack/cli.svg?style=flat-square" alt="Node.js version" /></a>
</p>

# BEPack

[English](./README.md) | 中文

BePack 用一套工作流管理附加包项目：manifest、Script API 依赖、TypeScript 构建、复制到 Minecraft，以及 `.mcpack` / `.mcaddon` 打包发布。

## 功能

- 支持从零创建配置，也可从现有 BP/RP manifest 导入。
- 同步 `manifest.json` 时保留 BePack 不管理的字段。
- 提供 `preserve`（增量）与 `clean`（按配置重建）两种合并策略。
- 类型检查通过后，将 Script API 源码构建到 `scripts/` 目录。
- 通过 `compile.define` 或 `replace` 注入编译期开关。
- 解析 `@minecraft/*` 依赖并写入具体版本。
- 可将包复制到游戏开发目录，或直接生成发布压缩包。
- 分析 `.cpuprofile` 时排除空闲 tick，只统计真实 CPU 时间。

## 环境要求

- Node.js 20 或更高版本。
- 行为包、资源包，或两者兼有。
- 使用 Script API 依赖时需要 `package.json`。

## 创建项目

新项目建议使用 [create-mcbe](https://www.npmjs.com/package/create-mcbe) 生成，交互选项见该项目文档：

```bash
npm create mcbe
```

也可以自行安装 BePack 后初始化：

```bash
npm install -D @bepack/cli
npx bepack init                                              # 全新配置
npx bepack init --from-bp bp/manifest.json                   # 从现有 BP 导入
npx bepack init --from-bp bp/manifest.json --from-rp rp/manifest.json
npx bepack build --install                                   # 首次构建
```

`--from-bp` / `--from-rp` 会读取 manifest 中的名称、UUID、版本、格式和 Script API 依赖，无需手动填写；仅在找到对应源文件时启用编译。`--dry-run` 只预览结果、不写入文件，`--format js|mjs` 生成 JavaScript 配置。使用 `npm i -g @bepack/cli` 全局安装后，可省略 `npx`。

## 配置

配置文件位于项目根目录，支持 `bepack.config.ts`、`bepack.config.mjs` 或 `bepack.config.js`：

```ts
import { defineConfig } from "@bepack/cli";

export default defineConfig({
    name: "my-addon",
    version: "1.0.0",
    target: "latest",

    packs: {
        bp: {
            root: "bp",
            uuid: "<behavior-pack-header-uuid>",
            moduleUuid: "<script-module-uuid>",
            compile: {
                entry: "src/main.ts",
            },
            dependencies: {
                "@minecraft/server": "stable",
                "@minecraft/server-ui": "stable",
            },
        },
    },

    pack: {
        outDir: "dist",
    },
});
```

新包请生成新的 UUID，不要与其他附加包重复。纯数据行为包无需 `moduleUuid` 和 `compile`；仅资源包项目配置 `packs.rp`，填写其 `root`、头部 `uuid` 和资源模块 `moduleUuid`。

目录名均可配置，上述配置对应以下结构：

```text
my-addon/
├── bepack.config.ts
├── package.json
├── tsconfig.json
├── src/
│   └── main.ts             # TypeScript 源码入口
├── bp/
│   ├── manifest.json
│   └── scripts/            # 生成的 JavaScript 输出
└── dist/                   # .mcpack / .mcaddon 输出
```

## 常用命令

```bash
bepack build --install   # 解析依赖、更新 manifest、构建
bepack build             # 依赖已就绪，仅构建
bepack dev               # 监听文件变化并重建
bepack pack              # 先构建，再打包
bepack build --pack      # 构建与打包一次完成
```

`bepack pack` 默认先构建，避免将过期的 `scripts/*.js` 打进包内；如需直接压缩磁盘上的目录，使用 `--no-build`。仅刷新依赖和 manifest 时，可单独运行 `bepack install`。需要临时切换 Minecraft 版本时，使用 `--target`：

```bash
bepack install --target 1.21.120
```

## 类型检查

`bepack build` 和 `bepack dev` 默认先运行 `tsc --noEmit`，通过后再交给 Rolldown；失败会以 `TYPECHECK_FAILED` 终止，不会产出不完整的包。如需跳过，使用 `--skip-typecheck` 或设置 `compile.typecheck: false`。添加自定义 Rolldown 选项不会关闭类型检查。

检查器可以是任意命令行工具：

```ts
compile: {
    entry: "src/main.ts",
    typecheckCommand: "bun check",   // 默认："tsc --noEmit"
}
```

```bash
bepack build --typecheck-command "tsc-rs --noEmit"
```

BePack 只为自带的 `tsc` 默认命令追加 `--project` 和缓存参数；自定义命令按原样执行。对象写法（`typecheck: { command, args }`）、优先级以及已废弃的 `useNpx` 参见[参考文档](./reference.md)。

## Script API 依赖

`@minecraft/*` 依赖支持 `stable`、`beta`、`preview` 和精确版本。`install`、`build --install` 会联网将选择器解析为具体版本，写入 `package.json` 和 BP manifest；`build`、`dev` 等离线命令沿用 manifest 中的值。配置中指定精确版本时，以配置为准。

## 自定义构建

需要插件、alias、sourcemap 等 Rolldown 能力时，可以内联选项、写成函数，或使用独立配置文件：

```ts
compile: {
    entry: "src/main.ts",
    rolldown: {
        resolve: { alias: { "@lib": "./src/lib" } },
        output: { sourcemap: true },
    },
    // rolldownConfig: "rolldown.bp.config.ts",
}
```

```bash
bepack build --rolldown-config rolldown.staging.mjs
```

自定义选项会合并到 BePack 生成的配置上：`plugins` 追加，`external` 取并集，`resolve` / `output` / `transform` 做一层深合并。`input` 和输出位置不允许改动。完整规则见参考文档。

## 复制到 Minecraft

配置复制目标后，为 `dev` 或 `build` 添加 `--copy`：

```ts
copy: {
    defaultTarget: "minecraft",
    targets: {
        minecraft: {
            type: "gameRoot",
            path: "C:/Users/you/AppData/Local/Packages/Microsoft.MinecraftUWP_8wekyb3d8bbwe/LocalState/games/com.mojang",
        },
    },
},
dev: { copy: true },
```

```bash
bepack dev            # 构建，之后每次文件变化都重建并复制
bepack build --copy   # 仅复制一次已完成的构建
bepack copy --target minecraft
```

`gameRoot` 会将行为包放入 `development_behavior_packs`，资源包放入 `development_resource_packs`。如需为 BP 和 RP 分别指定路径，可使用自定义目标，写法见参考文档。

## 分析 CPU profile

Bedrock 不采样空闲时间，tick 间隔会作为一条很大的 `timeDeltas` 记录在下一个采样点上。`bepack profile` 会忽略超过 `--gap`（默认 `5` ms）的 delta，并按真实累计时间对函数排序：

```bash
bepack profile summary bedrock.cpuprofile
bepack profile bursts  bedrock.cpuprofile
bepack profile top     bedrock.cpuprofile --from 2900 --to 2950 --by total
bepack profile diff    before.cpuprofile after.cpuprofile
```

`--json` 输出机器可读结果，`--root <目录>` 用于缩短路径。该命令不需要 `bepack.config`。

## 打包发布

在 `pack` 中设置产物名称和目录，`{name}`、`{version}` 会替换为顶层配置中的值：

```ts
pack: {
    name: "{name}-{version}",
    outDir: "releases",
}
```

```bash
bepack pack
bepack pack --name my-addon-preview
bepack pack --no-build
```

| 已配置的包 | 输出       |
| ---------- | ---------- |
| 仅 BP      | `.mcpack`  |
| 仅 RP      | `.mcpack`  |
| BP 和 RP   | `.mcaddon` |

当 include 列表遗漏文件时，BePack 会列出被遗漏的顶层条目，并提示添加到 `packs.bp.include` / `packs.rp.include`，不会静默丢弃。

### Pack 优化（`__brarchive`）

从 1.26.40 起，官方支持将包内的散文件收进 `__brarchive/` 归档。BePack 打包时也可生成相同结构：

```ts
pack: { outDir: "dist", optimize: true }
```

```bash
bepack pack --optimize            # --no-optimize 可关闭
```

BePack 会写入 `header.pack_optimization_version: "0.1.0"` —— 该字段才是引擎读取归档的开关。`entities/`、`items/` 等注册表目录整体进归档，并删除散文件；`functions/`、`textures/` 等按路径引用的目录保留散文件，归档中仅登记一个同名存根。磁盘上的包目录不会被修改。

> 只有 1.26.40+ 的客户端能读取归档内容，旧客户端只能看到保留的散文件。如需让开发目录也保持相同形态，启用 `copy.optimize` 即可。

## 命令速查

| 命令                      | 用途                                                              |
| ------------------------- | ----------------------------------------------------------------- |
| `bepack init`             | 创建配置，或通过 `--from-bp` / `--from-rp` 导入。                  |
| `bepack install`          | 解析托管依赖，更新 `package.json` 和 manifest。                    |
| `bepack manifest`         | 仅更新 manifest，不安装依赖。                                      |
| `bepack build`            | 修补 manifest、类型检查、编译 BP 源码。                            |
| `bepack dev`              | 构建一次后进入监听，文件变化时重建。                               |
| `bepack copy`             | 将配置的包复制到开发目标。                                         |
| `bepack pack`             | 构建后生成 `.mcpack` / `.mcaddon`（`--no-build` 跳过构建）。      |
| `bepack profile summary`  | 分析 `.cpuprofile`，定位慢 tick。                                  |
| `bepack config --summary` | 查看解析后的配置摘要。                                             |

所有项目命令均支持 `--cwd <目录>`、`--config <路径>`、`--dry-run` 和 `--json`；完整参数见 `bepack <命令> --help`。

## 文档

完整配置字段、自定义复制目标、include 规则、依赖解析器、插件、Hook 和替换标记，详见[参考文档](./reference.md)。

## 许可证

MIT
