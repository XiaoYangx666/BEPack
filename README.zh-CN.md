# BePack

BePack 是一个面向 Minecraft Bedrock Edition Script API 项目的轻量构建工具。

它负责处理基岩版附加包开发里那些重复但容易出错的流程：读取配置、修补 manifest、解析 Script API 依赖、运行 TypeScript 检查、Rolldown 构建、复制到游戏目录，以及打包 `.mcpack` / `.mcaddon`。

## 功能

- 将 TypeScript Script API 入口构建到 `bp/scripts`。
- 修补行为包/资源包 manifest，同时保留用户自定义字段。
- 从 npm 解析托管的 `@minecraft/*` 依赖。
- 通过可配置的依赖 catalog 和自定义 resolver 扩展依赖解析。
- 复制 BP/RP 到 Minecraft Bedrock 目录或自定义目录。
- 只有 BP 时打包为 `.mcpack`。
- 同时有 BP 和 RP 时打包为一个 `.mcaddon`。
- 支持 install、manifest、build、copy、pack 生命周期 hook。

## 安装

```bash
npm install -D bepack
```

## 快速开始

```bash
npx bepack init
npx bepack install
npx bepack build --pack
```

示例 `bepack.config.ts`：

```ts
import { defineConfig } from "bepack";

export default defineConfig({
    name: "my-addon",
    version: "1.0.0",
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
        rp: {
            root: "rp",
            uuid: "00000000-0000-0000-0000-000000000003",
            moduleUuid: "00000000-0000-0000-0000-000000000004",
        },
    },
    pack: {
        outDir: "dist",
    },
});
```

## 命令

```bash
bepack init
bepack install
bepack manifest
bepack build
bepack dev
bepack copy
bepack pack
```

常用示例：

```bash
bepack build --install
bepack build --copy
bepack build --pack
bepack dev --copy
bepack copy --target win
bepack pack --name release
```

## 配置说明

- `name` 必填，用于输出文件名和 manifest 默认名称。
- `description` 可选；不写时 BePack 不会覆盖已有 manifest 的 description。
- 至少配置一个 Pack（`packs.bp` 或 `packs.rp`），支持仅 BP、仅 RP、BP+RP 三种项目形态。
- BP 编译配置（入口、类型检查、打包选项）放在 `packs.bp.compile` 中；未配置时 `build` 和 `dev` 跳过 TypeScript 编译。
- `packs.bp.moduleUuid` 可选——仅在配置了 `compile` 时需要（用来管理 script 模块）。纯数据 BP 可省略。
- `packs.rp.moduleUuid` 必填（始终需要 resources 模块）。
- `build` 仅在配置了 compile 时，会清空 `<packs.bp.root>/scripts` 后写入新文件。
- **所有 BP 依赖统一声明在 `packs.bp.dependencies`**，包括写入 manifest 的（如 `@minecraft/server`）和仅代码使用的（如 `@minecraft/vanilla-data`）。catalog 控制每个包是否写入 manifest 和/或 package.json。
- 托管包中 `manifest: true` 的默认会在构建时 external，`manifest: false`（如 `@minecraft/vanilla-data`）可以被打进 bundle。可通过 `packs.bp.compile.external` 和 `packs.bp.compile.externalDependencies` 调整。
- 使用 `stable`、`beta` 或 `preview` 作为 specifier 时，请先运行 `bepack install` 或使用 `bepack build --install` 解析为具体 npm 版本。
- `manifestFormat: 2 | 3` 控制 manifest 输出格式。`2` 使用数组版本 `[1,0,0]`；`3` 使用 SemVer 字符串 `"1.0.0"`（Minecraft 1.21.110+）。不设置时自动保留现有 manifest 的格式，新项目默认 2。
- `packs.bp.include` / `packs.rp.include` 配置各自 Pack 的额外打包/复制文件列表。BP 始终选择性打包；RP 配置了 include 时选择性打包，否则全目录。
- `bepack dev --skip-typecheck` 可在开发模式跳过类型检查。

完整配置参考和实现说明见 [README.reference.md](./README.reference.md)。

## 打包输出

只有 BP 时输出：

```txt
dist/{name}-{version}.mcpack
```

同时有 BP 和 RP 时输出：

```txt
dist/{name}-{version}.mcaddon
```

`.mcaddon` 内会同时包含 BP 和 RP 文件夹，例如：

```txt
bp/manifest.json
rp/manifest.json
```

## License

MIT
