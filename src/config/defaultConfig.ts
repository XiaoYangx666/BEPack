import type { ConfigContext, ResolvedConfig, UserConfig } from "./configTypes.js";

export const DEFAULT_CONFIG: Omit<ResolvedConfig, "packs"> = {
    root: ".",
    configured: {
        root: false,
        buildEntry: false,
        bpRoot: false,
        rpRoot: false,
        packOutDir: false,
    },
    name: "minecraft-addon",
    version: "1.0.0",
    description: "",
    target: "latest",
    install: {
        registry: "https://registry.npmjs.org/",
        saveTo: "dependencies",
        packageManager: "auto",
        runPackageManager: true,
        updatePackageJson: true,
        updateManifest: true,
        dependencies: {},
        dependencyCatalog: {},
        dependencyResolvers: [],
    },
    build: {
        entry: "src/main.ts",
        typecheck: true,
        copy: false,
        preserveModules: true,
        external: [
            /^@minecraft\/server.*/,
            "@minecraft/common",
            "@minecraft/debug-utilities",
            "@minecraft/diagnostics",
        ],
        externalDependencies: true,
        useNpx: false,
    },
    dev: {
        copy: false,
    },
    copy: {
        defaultTarget: "win",
        targets: {},
    },
    pack: {
        name: "{name}-{version}",
        outDir: "dist",
    },
    hooks: {},
};

export function defineConfig(config: UserConfig): UserConfig;
export function defineConfig<T extends (ctx: ConfigContext) => UserConfig | Promise<UserConfig>>(
    config: T
): T;
export function defineConfig(
    config: UserConfig | ((ctx: ConfigContext) => UserConfig | Promise<UserConfig>)
): UserConfig | ((ctx: ConfigContext) => UserConfig | Promise<UserConfig>) {
    return config;
}
