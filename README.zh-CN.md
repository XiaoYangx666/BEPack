<p align="center">
  <img src="./assets/bepack-logo-horizontal.png" alt="BePack" width="400" />
</p>

<p align="center">
  Minecraft Bedrock 附加包的现代化构建与发布工具链。
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/bepack"><img src="https://img.shields.io/npm/v/bepack.svg?style=flat-square" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/bepack"><img src="https://img.shields.io/npm/dm/bepack.svg?style=flat-square" alt="npm downloads" /></a>
  <a href="https://github.com/XiaoYangx666/BEPack/blob/main/LICENSE"><img src="https://img.shields.io/github/license/XiaoYangx666/BEPack.svg?style=flat-square" alt="license" /></a>
  <a href="https://github.com/XiaoYangx666/BEPack"><img src="https://img.shields.io/github/stars/XiaoYangx666/BEPack.svg?style=flat-square" alt="GitHub stars" /></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/node/v/bepack.svg?style=flat-square" alt="Node.js version" /></a>
</p>

# BEPack

[English](./README.md) | 中文

BePack 是 Minecraft 基岩版附加包的构建工具。它将行为包和资源包的 `manifest.json`、Script API 依赖、TypeScript 构建、本地复制，以及 `.mcpack` / `.mcaddon` 发布包整合到同一套工作流中。

## 能做什么

- 从零创建 BePack 配置，或从已有 manifest 导入配置。
- 同步 `manifest.json`，同时保留不由 BePack 管理的字段。
- 将行为包的 TypeScript Script API 入口构建到 `scripts/` 目录。
- 解析受支持的 `@minecraft/*` 依赖，并将具体版本写入项目。
- 将包复制到 Minecraft 开发目录，并生成发布压缩包。

## 环境要求

- Node.js 20 或更高版本。
- 一个 Minecraft 基岩版行为包、资源包，或两者兼有。
- 使用受管理的 Script API 依赖时，需要 `package.json`。

## 创建新项目

创建新的行为包项目时，推荐先使用 [create-mcbe](https://www.npmjs.com/package/create-mcbe)：

```bash
npm create mcbe
```

具体交互选项和命令行参数请查看 create-mcbe 项目文档。可以全局安装 BePack：

```bash
npm install -g bepack
```

也可以使用 `npm install -D bepack` 安装到项目中；此时使用 `npx bepack` 或 package script。

如果需要新的 BePack 配置，执行以下命令后再按项目实际情况修改生成的内容：

```bash
bepack init
```

初始配置会包含一个 BP、位于 `src/main.ts` 的 TypeScript 入口和自动生成的 UUID。首次构建时安装依赖：

```bash
bepack build --install
```

## 接入已有项目

已有包的 manifest 时，不必手动重新填写 UUID 和版本号；直接从 manifest 导入配置最快：

```bash
# 仅行为包
bepack init --from-bp bp/manifest.json

# 同时有行为包和资源包
bepack init --from-bp bp/manifest.json --from-rp rp/manifest.json
```

该命令会根据读取到的包根目录、名称、UUID、版本、manifest 格式和受支持的 Script API 依赖创建 `bepack.config.ts`。如果 BP 存在脚本模块，也会在可行时生成对应的 TypeScript 构建配置。

常用变体：

```bash
# 生成 JavaScript 或 ESM JavaScript 配置，而非 TypeScript
bepack init --format js
bepack init --format mjs

# 在项目目录外执行
bepack init --cwd path/to/project --from-bp bp/manifest.json

# 明确覆盖已有的生成配置
bepack init --from-bp bp/manifest.json --force
```

## 最小配置

BePack 会从项目目录加载 `bepack.config.ts`、`bepack.config.mjs` 或 `bepack.config.js`。以下是常见的 Script API 行为包配置：

```ts
import { defineConfig } from "bepack";

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

新包请生成新的 UUID，不要复用其他附加包的 UUID。纯数据行为包可省略 `moduleUuid` 和 `compile`。仅资源包项目则配置 `packs.rp`，并提供它的 `root`、头部 `uuid` 和资源模块 `moduleUuid`。

## 推荐目录结构

目录名称都可通过配置调整；以下结构对应上面的示例：

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

如需资源包，添加 `rp/` 目录和 `packs.rp` 配置即可。BP 和 RP 同时配置时，BePack 会维护它们在 manifest 中的关联关系。

## 日常工作流

```bash
# 解析配置的 Script API 依赖、更新 manifest 并构建
bepack build --install

# 依赖已安装时，只构建一次
bepack build

# 开发时监听文件并自动重建
bepack dev

# 生成发布压缩包
bepack pack

# 一次完成构建和打包
bepack build --pack
```

如果只想更新受管理的依赖和 manifest，可单独执行 `bepack install`。可以在配置中设置 `target`，也可以在安装并构建时临时指定目标 Minecraft 版本：

```bash
bepack install --target 1.21.120
bepack build --install --target 1.21.120
```

受支持的 `@minecraft/*` 依赖可使用 `stable`、`beta`、`preview` 或精确版本。BePack 会先把如 `stable` 这样的选择器解析为具体包版本，再更新 `package.json` 和 BP manifest。

## 开发时复制到 Minecraft

配置一次复制目标，然后在 `dev` 或 `build` 中加 `--copy`：

```ts
export default defineConfig({
    // 此处省略 name、version 和 packs
    copy: {
        defaultTarget: "minecraft",
        targets: {
            minecraft: {
                type: "gameRoot",
                path: "C:/Users/you/AppData/Local/Packages/Microsoft.MinecraftUWP_8wekyb3d8bbwe/LocalState/games/com.mojang",
            },
        },
    },
    dev: {
        copy: true,
    },
});
```

```bash
# 首次构建；之后每次监听到文件变化都会重建并复制
bepack dev

# 或仅复制一次已完成的构建
bepack build --copy
bepack copy --target minecraft
```

`gameRoot` 会将行为包复制到 `development_behavior_packs`，将资源包复制到 `development_resource_packs`。如果 BP 和 RP 需要不同的目标路径，可使用自定义目标；完整写法请见参考文档。

## 打包发布

通过 `pack` 设置输出名称和目录。`{name}` 和 `{version}` 会替换为顶层配置中的值：

```ts
export default defineConfig({
    // name: "my-addon", version: "1.0.0", packs: ...
    pack: {
        name: "{name}-{version}",
        outDir: "releases",
    },
});
```

```bash
bepack pack
bepack pack --name my-addon-preview
```

| 已配置的包 | 输出       |
| ---------- | ---------- |
| 仅 BP      | `.mcpack`  |
| 仅 RP      | `.mcpack`  |
| BP 和 RP   | `.mcaddon` |

## 命令速查

| 命令                      | 用途                                                  |
| ------------------------- | ----------------------------------------------------- |
| `bepack init`             | 创建配置，或用 `--from-bp` / `--from-rp` 导入配置。   |
| `bepack install`          | 解析受管理的依赖，并更新 `package.json` 和 manifest。 |
| `bepack manifest`         | 不安装依赖，仅更新 manifest。                         |
| `bepack build`            | 修补 manifest 并编译已配置的 BP 源码。                |
| `bepack dev`              | 先构建一次，随后监听并重建。                          |
| `bepack copy`             | 复制已配置的包到开发目标。                            |
| `bepack pack`             | 生成 `.mcpack` 或 `.mcaddon`。                        |
| `bepack config --summary` | 查看解析后的配置摘要。                                |

所有命令都支持 `--cwd <项目目录>` 和 `--config <路径>`，可用于在非项目目录执行或使用不同的配置文件名。对于会写入文件的命令，可添加 `--dry-run` 预览；如需机器可读输出，可添加 `--json`。使用 `bepack <命令> --help` 查看每个命令的全部参数。

## 更多文档

本 README 覆盖最常见的路径：创建或导入项目、配置包、构建、复制与打包。完整配置字段、自定义复制目标、包含规则、依赖解析扩展、插件、Hook 和替换标记请阅读 [参考文档](./reference.md)。

## 许可证

MIT
