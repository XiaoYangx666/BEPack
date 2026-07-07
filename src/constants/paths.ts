export const FIXED_PATHS = {
    srcEntry: "src/main.ts",
    bpRoot: "bp",
    rpRoot: "rp",
    scriptOutFile: "bp/scripts/main.js",
    bpManifest: "bp/manifest.json",
    rpManifest: "rp/manifest.json",
    dist: "dist",
} as const;

export const CONFIG_FILES = ["bepack.config.ts", "bepack.config.mjs", "bepack.config.js"] as const;
