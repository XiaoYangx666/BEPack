/** manifest.json 版本号格式：[主版本, 次版本, 修订号] */
export type ManifestVersion = [number, number, number];

/** 宽松但有约束的 manifest.json 对象类型。未知字段通过 [key: string] 保留。 */
export type Manifest = {
    format_version?: number;
    header?: ManifestHeader;
    modules?: ManifestModule[];
    dependencies?: ManifestDependency[];
    capabilities?: string[];
    metadata?: Record<string, unknown>;
    [key: string]: unknown;
};

export type ManifestHeader = {
    name?: string;
    description?: string;
    uuid?: string;
    version?: ManifestVersion;
    min_engine_version?: ManifestVersion;
    [key: string]: unknown;
};

export type ManifestModule = ManifestScriptModule | ManifestResourcesModule | ManifestUnknownModule;

/** BePack 管理的 BP Script 模块 */
export type ManifestScriptModule = {
    type: "script";
    language: "javascript";
    uuid: string;
    version: ManifestVersion;
    entry: string;
    [key: string]: unknown;
};

/** BePack 管理的 RP Resources 模块 */
export type ManifestResourcesModule = {
    type: "resources";
    uuid: string;
    version: ManifestVersion;
    [key: string]: unknown;
};

/** 用户手写或其他工具生成的未知模块，保留原样 */
export type ManifestUnknownModule = {
    type?: string;
    uuid?: string;
    version?: unknown;
    [key: string]: unknown;
};

export type ManifestDependency =
    /** module_name 依赖（Script API 包，如 @minecraft/server） */
    | {
          module_name: string;
          version: string;
      }
    /** uuid 依赖（包间引用，如 BP → RP） */
    | {
          uuid: string;
          version: ManifestVersion;
      }
    /** 用户手写的未知依赖格式 */
    | {
          [key: string]: unknown;
      };
