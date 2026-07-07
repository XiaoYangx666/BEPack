import { DEFAULT_CONFIG } from "./defaultConfig.js";
import type { BpConfig, ResolvedConfig, RpConfig, UserConfig } from "./configTypes.js";
import { BePackError } from "../errors/BePackError.js";

function stripUndefined<T extends Record<string, unknown>>(value: T | undefined): Partial<T> {
    if (!value) return {};
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as Partial<T>;
}

function mergeUserConfig(config: UserConfig, overrides: Partial<UserConfig>): UserConfig {
    const packs: UserConfig["packs"] = {};
    if (config.packs?.bp || overrides.packs?.bp) {
        packs.bp = { ...config.packs?.bp, ...stripUndefined(overrides.packs?.bp) } as BpConfig;
    }
    if (config.packs?.rp || overrides.packs?.rp) {
        packs.rp = { ...config.packs?.rp, ...stripUndefined(overrides.packs?.rp) } as RpConfig;
    }
    const copyTargets: NonNullable<NonNullable<UserConfig["copy"]>["targets"]> = {
        ...(config.copy?.targets ?? {}),
        ...(stripUndefined(overrides.copy?.targets) as NonNullable<NonNullable<UserConfig["copy"]>["targets"]>),
    };
    const cleanOverrides = stripUndefined(overrides);
    return {
        ...config,
        ...cleanOverrides,
        packs,
        install: { ...config.install, ...stripUndefined(overrides.install) },
        build: { ...config.build, ...stripUndefined(overrides.build) },
        dev: { ...config.dev, ...stripUndefined(overrides.dev) },
        copy: {
            ...config.copy,
            ...stripUndefined(overrides.copy),
            targets: copyTargets,
        },
        pack: { ...config.pack, ...stripUndefined(overrides.pack) },
        hooks: { ...config.hooks, ...stripUndefined(overrides.hooks) },
    };
}

export function normalizeConfig(config: UserConfig, overrides: Partial<UserConfig> = {}): ResolvedConfig {
    const raw = mergeUserConfig(config, overrides);
    const target = raw.target ?? DEFAULT_CONFIG.target;
    if (target === "stable" || target === "beta") {
        throw new BePackError("TARGET_INVALID", "target must be a Minecraft game version or latest, not a Script API channel.", { details: { target } });
    }
    if (!raw.packs?.bp) {
        throw new BePackError("CONFIG_INVALID", "packs.bp is required.");
    }
    if (!raw.name || raw.name.trim() === "") {
        throw new BePackError("CONFIG_INVALID", "name is required.");
    }
    const name = raw.name;
    const version = raw.version ?? DEFAULT_CONFIG.version;
    const description = raw.description;
    const bp = raw.packs.bp;
    if (!bp.uuid || !bp.moduleUuid) {
        throw new BePackError("CONFIG_INVALID", "packs.bp.uuid and packs.bp.moduleUuid are required.");
    }
    const rp = raw.packs.rp;
    const bpDescription = bp.description ?? description;
    const rpDescription = rp?.description ?? description;
    return {
        root: raw.root ?? DEFAULT_CONFIG.root,
        configured: {
            root: raw.root !== undefined,
            buildEntry: raw.build?.entry !== undefined,
            bpRoot: bp.root !== undefined,
            rpRoot: rp?.root !== undefined,
            packOutDir: raw.pack?.outDir !== undefined,
        },
        name,
        version,
        ...(description !== undefined ? { description } : {}),
        target,
        packs: {
            bp: {
                root: bp.root ?? "bp",
                uuid: bp.uuid,
                moduleUuid: bp.moduleUuid,
                name: bp.name ?? name,
                ...(bpDescription !== undefined ? { description: bpDescription } : {}),
                dependencies: bp.dependencies ?? {},
                achievement: bp.achievement ?? false,
            },
            ...(rp
                ? {
                      rp: {
                          root: rp.root ?? "rp",
                          uuid: rp.uuid,
                          moduleUuid: rp.moduleUuid,
                          name: rp.name ?? name,
                          ...(rpDescription !== undefined ? { description: rpDescription } : {}),
                          pbr: rp.pbr ?? false,
                      },
                  }
                : {}),
        },
        install: {
            registry: raw.install?.registry ?? DEFAULT_CONFIG.install.registry,
            saveTo: raw.install?.saveTo ?? DEFAULT_CONFIG.install.saveTo,
            packageManager: raw.install?.packageManager ?? DEFAULT_CONFIG.install.packageManager,
            runPackageManager: raw.install?.runPackageManager ?? DEFAULT_CONFIG.install.runPackageManager,
            updatePackageJson: raw.install?.updatePackageJson ?? DEFAULT_CONFIG.install.updatePackageJson,
            updateManifest: raw.install?.updateManifest ?? DEFAULT_CONFIG.install.updateManifest,
            dependencies: raw.install?.dependencies ?? {},
            dependencyResolvers: raw.install?.dependencyResolvers ?? [],
        },
        build: {
            entry: raw.build?.entry ?? DEFAULT_CONFIG.build.entry,
            typecheck: raw.build?.typecheck ?? DEFAULT_CONFIG.build.typecheck,
            copy: raw.build?.copy ?? DEFAULT_CONFIG.build.copy,
            preserveModules: raw.build?.preserveModules ?? raw.build?.preserveModule ?? DEFAULT_CONFIG.build.preserveModules,
            useNpx: raw.build?.useNpx ?? DEFAULT_CONFIG.build.useNpx,
        },
        dev: {
            copy: raw.dev?.copy ?? DEFAULT_CONFIG.dev.copy,
        },
        copy: {
            defaultTarget: raw.copy?.defaultTarget ?? DEFAULT_CONFIG.copy.defaultTarget,
            targets: raw.copy?.targets ?? {},
        },
        pack: {
            name: raw.pack?.name ?? DEFAULT_CONFIG.pack.name,
            outDir: raw.pack?.outDir ?? DEFAULT_CONFIG.pack.outDir,
        },
        hooks: raw.hooks ?? {},
    };
}
