import { DEFAULT_CONFIG, BP_COMPILE_DEFAULTS, CACHE_DEFAULTS } from "./defaultConfig.js";
import type {
    BpCompileResolved,
    CacheOptions,
    CacheResolved,
    ResolvedConfig,
    UserConfig,
    BpConfig,
    RpConfig,
} from "./configTypes.js";
import { BePackError } from "../errors/BePackError.js";

function stripUndefined<T extends Record<string, unknown>>(value: T | undefined): Partial<T> {
    if (!value) return {};
    return Object.fromEntries(
        Object.entries(value).filter(([, item]) => item !== undefined)
    ) as Partial<T>;
}

function mergeUserConfig(config: UserConfig, overrides: Partial<UserConfig>): UserConfig {
    const packs: UserConfig["packs"] = {};
    if (config.packs?.bp || overrides.packs?.bp) {
        packs.bp = {
            ...(config.packs?.bp ?? ({} as BpConfig)),
            ...stripUndefined(overrides.packs?.bp),
        } as BpConfig;
    }
    if (config.packs?.rp || overrides.packs?.rp) {
        packs.rp = {
            ...(config.packs?.rp ?? ({} as RpConfig)),
            ...stripUndefined(overrides.packs?.rp),
        } as RpConfig;
    }
    const copyTargets: NonNullable<NonNullable<UserConfig["copy"]>["targets"]> = {
        ...(config.copy?.targets ?? {}),
        ...(stripUndefined(overrides.copy?.targets) as NonNullable<
            NonNullable<UserConfig["copy"]>["targets"]
        >),
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

/**
 * Normalize compile options into a fully-resolved BpCompileResolved.
 * Falls back to BP_COMPILE_DEFAULTS for any missing field.
 */
function normalizeCompile(
    compile: NonNullable<NonNullable<UserConfig["packs"]>["bp"]>["compile"]
): BpCompileResolved {
    const defs = BP_COMPILE_DEFAULTS;
    return {
        entry: compile?.entry ?? defs.entry,
        tsconfig: compile?.tsconfig ?? defs.tsconfig,
        typecheck: compile?.typecheck ?? defs.typecheck,
        preserveModules: compile?.preserveModules ?? defs.preserveModules,
        external: compile?.external ?? defs.external,
        useNpx: compile?.useNpx ?? defs.useNpx,
        minify: compile?.minify ?? defs.minify,
        cache: normalizeCache(compile?.cache),
    };

function normalizeCache(cache: CacheOptions | undefined): CacheResolved {
    const defs = CACHE_DEFAULTS;
    return {
        dev: cache?.dev ?? defs.dev,
        build: cache?.build ?? defs.build,
        file: cache?.file ?? defs.file,
    };
}
}

export function normalizeConfig(
    config: UserConfig,
    overrides: Partial<UserConfig> = {}
): ResolvedConfig {
    const raw = mergeUserConfig(config, overrides);
    const target = raw.target ?? DEFAULT_CONFIG.target;
    if (target === "stable" || target === "beta") {
        throw new BePackError(
            "TARGET_INVALID",
            "target must be a Minecraft game version or latest, not a Script API channel.",
            { details: { target } }
        );
    }

    const hasBp = !!raw.packs?.bp;
    const hasRp = !!raw.packs?.rp;
    if (!hasBp && !hasRp) {
        throw new BePackError(
            "CONFIG_INVALID",
            "At least one pack (packs.bp or packs.rp) is required."
        );
    }

    if (!raw.name || raw.name.trim() === "") {
        throw new BePackError("CONFIG_INVALID", "name is required.");
    }
    const name = raw.name;
    const version = raw.version ?? DEFAULT_CONFIG.version;
    const description = raw.description;

    const packs = raw.packs!;
    let compile = packs.bp?.compile;
    const bp = packs.bp;
    const rp = packs.rp;

    if (bp) {
        if (!bp.uuid) {
            throw new BePackError("CONFIG_INVALID", "packs.bp.uuid is required.");
        }
        if (bp.compile && !bp.moduleUuid) {
            throw new BePackError(
                "CONFIG_INVALID",
                "packs.bp.moduleUuid is required when packs.bp.compile is configured."
            );
        }
        if (bp.root === undefined) {
            throw new BePackError(
                "CONFIG_INVALID",
                "packs.bp.root is required. Set the behavior pack directory in bepack.config.ts."
            );
        }
    }

    if (rp) {
        if (!rp.uuid || !rp.moduleUuid) {
            throw new BePackError(
                "CONFIG_INVALID",
                "packs.rp.uuid and packs.rp.moduleUuid are required."
            );
        }
        if (rp.root === undefined) {
            throw new BePackError(
                "CONFIG_INVALID",
                "packs.rp.root is required when packs.rp is configured."
            );
        }
    }

    const bpDescription = bp?.description ?? description;
    const rpDescription = rp?.description ?? description;

    return {
        root: raw.root ?? DEFAULT_CONFIG.root,
        configured: {
            root: raw.root !== undefined,
            packOutDir: raw.pack?.outDir !== undefined,
        },
        name,
        version,
        ...(description !== undefined ? { description } : {}),
        target,
        ...(raw.manifestFormat !== undefined ? { manifestFormat: raw.manifestFormat } : {}),
        packs: {
            ...(bp
                ? {
                      bp: {
                          root: bp.root!,
                          uuid: bp.uuid,
                          ...(bp.moduleUuid !== undefined ? { moduleUuid: bp.moduleUuid } : {}),
                          name: bp.name ?? name,
                          ...(bpDescription !== undefined ? { description: bpDescription } : {}),
                          ...(compile ? { compile: normalizeCompile(compile) } : {}),
                          dependencies: bp.dependencies ?? {},
                          ...(bp.achievement !== undefined ? { achievement: bp.achievement } : {}),
                          include: bp.include ?? [],
                      },
                  }
                : {}),
            ...(rp
                ? {
                      rp: {
                          root: rp.root!,
                          uuid: rp.uuid,
                          moduleUuid: rp.moduleUuid!,
                          name: rp.name ?? name,
                          ...(rpDescription !== undefined ? { description: rpDescription } : {}),
                          ...(rp.pbr !== undefined ? { pbr: rp.pbr } : {}),
                          include: rp.include ?? [],
                      },
                  }
                : {}),
        },
        install: {
            registry: raw.install?.registry ?? DEFAULT_CONFIG.install.registry,
            saveTo: raw.install?.saveTo ?? DEFAULT_CONFIG.install.saveTo,
            packageManager: raw.install?.packageManager ?? DEFAULT_CONFIG.install.packageManager,
            runPackageManager:
                raw.install?.runPackageManager ?? DEFAULT_CONFIG.install.runPackageManager,
            updatePackageJson:
                raw.install?.updatePackageJson ?? DEFAULT_CONFIG.install.updatePackageJson,
            updateManifest: raw.install?.updateManifest ?? DEFAULT_CONFIG.install.updateManifest,
            dependencyCatalog: raw.install?.dependencyCatalog ?? {},
            dependencyResolvers: raw.install?.dependencyResolvers ?? [],
        },
        build: {
            copy: raw.build?.copy ?? DEFAULT_CONFIG.build.copy,
            timing: raw.build?.timing ?? DEFAULT_CONFIG.build.timing,
        },
        dev: {
            copy: raw.dev?.copy ?? DEFAULT_CONFIG.dev.copy,
            ...(raw.dev?.watch ? { watch: raw.dev.watch } : {}),
        },
        copy: {
            defaultTarget: raw.copy?.defaultTarget ?? DEFAULT_CONFIG.copy.defaultTarget,
            ...(raw.copy?.name ? { name: raw.copy.name } : {}),
            ...(raw.copy?.include ? { include: raw.copy.include } : {}),
            targets: raw.copy?.targets ?? {},
        },
        pack: {
            name: raw.pack?.name ?? DEFAULT_CONFIG.pack.name,
            outDir: raw.pack?.outDir ?? DEFAULT_CONFIG.pack.outDir,
        },
        hooks: raw.hooks ?? {},
    };
}
