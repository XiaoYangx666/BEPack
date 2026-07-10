/** Default files/folders included when copying a behavior pack. */
export const DEFAULT_BP_INCLUDES = [
    "scripts",
    "manifest.json",
    "animation_controllers",
    "animations",
    "biomes",
    "blocks",
    "entities",
    "functions",
    "items",
    "loot_tables",
    "pack_icon.png",
    "recipes",
    "spawn_rules",
    "structures",
    "texts",
    "trading",
    "feature_rules",
    "features",
    "worldgen",
];

/** Default files/folders included when copying a resource pack. */
export const DEFAULT_RP_INCLUDES: string[] = [];

/**
 * Merge default includes with user-configured additions.
 *
 * When the merged result is empty (e.g. RP with no user includes),
 * callers should fall back to copying the full directory.
 */
export function getIncludes(
    defaults: string[],
    userAdditions: string[] | undefined
): string[] {
    return userAdditions?.length ? [...defaults, ...userAdditions] : defaults;
}
