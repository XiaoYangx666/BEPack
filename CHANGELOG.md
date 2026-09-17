# 更新日志

BePack 的所有重要变更都会记录在此文件。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [未发布]

## [0.1.0-beta.2] - 2026-09-17

本次发布的核心是 **Pack 优化（`__brarchive`）**：BePack 现在能生成与 Minecraft 官方优化器一致的包结构，以及**自定义 Rolldown 配置**。

### 新增

- **Pack 优化（`__brarchive`）**：将包内散文件打包进 `__brarchive/` 归档，对齐 Minecraft 官方优化器（Bedrock 1.26.40+）。
  - 配置 `pack.optimize` / `copy.optimize`，或 CLI `--optimize`（`pack` / `copy` / `dev` / `build --pack|--copy`）。
  - 自研 brarchive v1 读写器，**不引入新依赖**；格式无压缩，目的是合并大量小文件以提升外层 `.mcpack` / `.mcaddon` 的压缩率。
  - 注册表型目录（`entities`/`items`/`blocks`/`recipes`/`shapes`/`models`/`ui` 等）完整归档并移除散文件；按路径引用的目录（BP `functions`/`loot_tables`/`structures`/`texts`，RP `font`/`materials`/`sounds`/`texts`/`textures`）保留散文件，归档内只写 0 字节存根。
  - 向产物 manifest 写入 `header.pack_optimization_version: "0.1.0"` —— 只有该字段能让引擎从归档读取内容，写成游戏版本号（如 `"1.26.40"`）无效。
  - `min_engine_version` 不参与判断（原版 vanilla 包为 `[1,13,0]` 却带归档），低于 1.26.40 仅告警，可用 `allowUnsupportedTarget: true` 静音。
  - 产物内的 JSON 默认压缩（`minifyJson`）；只影响输出，**磁盘上的包目录永不被修改**。
  - 选项：`keepLoose` / `keepLooseFiles` / `exclude` / `minifyJson` / `packOptimizationVersion` / `allowUnsupportedTarget`。
- **自定义 Rolldown 配置**：
  - `packs.bp.compile.rolldown`：对象，或 `(options, context) => options` 函数。
  - `packs.bp.compile.rolldownConfig`：用 Rolldown 自带 `loadConfig` 读取 `.ts`/`.mts`/`.js`/`.mjs` 配置文件。
  - CLI `--rolldown-config <path>`（`build` / `dev`），优先级：CLI > 配置文件 > 内联选项。
  - 受保护字段（`input` 与输出位置相关字段）被改动时抛 `CONFIG_INVALID` 并给出替代方案，保证 manifest script entry、复制、打包、dev 监听一致。
- BP 默认复制/打包/监听列表新增 `shapes`（voxel shape 定义目录）。

### 变更

- 依赖升级：rolldown 1.1.4→1.2.9、rolldown-plugin-dts 0.27.6→0.27.14、vitest 4.1.10→4.1.11、prettier 3.9.5→3.9.7、tsx 4.23.1→4.23.13、@types/node 26.1.0→26.6.1。

### 修复

- **保持 rolldown 子路径为 external**：`external` 仅为字符串 `"rolldown"` 时不匹配子路径，导致 `rolldown/plugins`、`rolldown/config` 被打进产物；改为正则匹配后 `index.js` 63→42 kB、`cli.js` 324→112 kB。
- **Pack 优化不再静默跳过无法压缩的 JSON**：压缩失败时通过 `logger.warn` 报出文件名与具体解析错误（行为不变，仍原样存储、绝不损坏文件）。
- **Pack 优化支持 UTF-16（含 BOM）编码的 JSON**：按 BOM 自动选择解码器，不再把非 UTF-8 文件当垃圾解码。

### 移除

- 移除 `packs.bp.achievement`、`metadata.product_type` 写入逻辑及 `ACHIEVEMENT_REQUIRES_STABLE_API` 校验与错误码 —— 新版已不需要成就元数据。
- 移除死代码：`src/pack/packMcaddon.ts`（从未被导入）、`zipAddon()`、`getIncludes()`、`isStableApiSpecifier()`。
- 移除 `CLAUDE.md`，内容已整体迁入 `AGENTS.md`。

### 文档

- `reference.md` 新增《Pack 优化》《复制时也做 Pack 优化》《自定义 Rolldown 配置》，并附实机验证记录。
- README（中/英）新增《自定义 Rolldown 构建》，明确 **`build` / `dev` 默认先跑 `tsc --noEmit`**，失败以 `TYPECHECK_FAILED` 终止；自定义 Rolldown 选项**不会**关闭类型检查。
- `AGENTS.md` 补充 pack 优化、类型检查默认开启等约定。

### 兼容性说明

- **Pack 优化默认关闭**，`pack.optimize` 与 `copy.optimize` 均需显式开启，行为不变。
- 启用 Pack 优化后，只有 1.26.40+ 的客户端能读取归档内容；更早的客户端只能看到保留为散文件的目录。
- `--optimize` / `--no-optimize` 为三态：不传则跟随配置，传 `--no-optimize` 可临时覆盖配置里的开启状态。

### 已知问题

- `scripts` 目录默认归档，不要在 `keepLoose` 中加入它 —— Mojang 自己的包（`behavior_packs/editor`）也是归档存放。
- 手写的 `data` module 若复用了 `packs.bp.moduleUuid`，会导致脚本模块在游戏内被静默丢弃，请确保模块 UUID 唯一。
- `structures` 的归档读取尚未通过 `/place structure` 正面验证（原版对照需要带引号的名称）。

[未发布]: https://github.com/XiaoYangx666/BEPack/compare/v0.1.0-beta.2...HEAD
[0.1.0-beta.2]: https://github.com/XiaoYangx666/BEPack/compare/v0.1.0-beta.1...v0.1.0-beta.2
