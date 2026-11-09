import { zipSync, type Zippable } from "fflate";
import type { Manifest, ManifestModule, ManifestVersion } from "../src/index.js";

export const BP_HEADER = "11111111-1111-4111-8111-111111111111";
export const BP_MODULE = "22222222-2222-4222-8222-222222222222";
export const RP_HEADER = "33333333-3333-4333-8333-333333333333";
export const RP_MODULE = "44444444-4444-4444-8444-444444444444";

export type TestFileContent = string | Uint8Array | object;

export function encode(value: unknown): Uint8Array {
    return new TextEncoder().encode(
        typeof value === "string" ? value : JSON.stringify(value, null, 2)
    );
}

export function toBytes(content: TestFileContent): Uint8Array {
    if (typeof content === "string") return encode(content);
    if (content instanceof Uint8Array) return content;
    return encode(content);
}

export function zip(files: Record<string, TestFileContent>): Uint8Array {
    const archive: Zippable = {};
    for (const [path, content] of Object.entries(files)) {
        archive[path] = toBytes(content);
    }
    return zipSync(archive);
}

export function makeManifest(
    kind: "bp" | "rp",
    overrides: Partial<Manifest> = {},
    formatVersion: 2 | 3 = 2
): Manifest {
    const version: ManifestVersion = formatVersion === 3 ? "1.0.0" : [1, 0, 0];
    const module: ManifestModule =
        kind === "bp"
            ? {
                  type: "script",
                  language: "javascript",
                  uuid: BP_MODULE,
                  version,
                  entry: "scripts/main.js",
              }
            : {
                  type: "resources",
                  uuid: RP_MODULE,
                  version,
              };
    const base: Manifest = {
        format_version: formatVersion,
        header: {
            name: kind === "bp" ? "Test BP" : "Test RP",
            description: `${kind} description`,
            uuid: kind === "bp" ? BP_HEADER : RP_HEADER,
            version,
            custom_header: "keep",
        },
        modules: [module],
        dependencies: [
            {
                uuid: kind === "bp" ? RP_HEADER : BP_HEADER,
                version,
            },
        ],
        metadata: { custom: true },
    };
    return {
        ...base,
        ...overrides,
        header: { ...base.header!, ...(overrides.header ?? {}) },
        modules: overrides.modules ?? base.modules!,
        dependencies: overrides.dependencies ?? base.dependencies!,
    };
}

export function makeAddon(
    options: {
        readonly bp?: Manifest | null;
        readonly rp?: Manifest | null;
        readonly files?: Record<string, TestFileContent>;
        readonly formatVersion?: 2 | 3;
    } = {}
): Uint8Array {
    const files: Record<string, TestFileContent> = {
        "bp/scripts/main.js": `export const PACK = "${BP_HEADER}";\n`,
        "rp/textures/test.png": new Uint8Array([1, 2, 3]),
    };
    if (options.bp !== null) {
        files["bp/manifest.json"] =
            options.bp ?? makeManifest("bp", {}, options.formatVersion ?? 2);
    }
    if (options.rp !== null) {
        files["rp/manifest.json"] =
            options.rp ?? makeManifest("rp", {}, options.formatVersion ?? 2);
    }
    Object.assign(files, options.files ?? {});
    return zip(files);
}

export function bytesMap(files: Record<string, TestFileContent>): Map<string, Uint8Array> {
    const map = new Map<string, Uint8Array>();
    for (const [path, content] of Object.entries(files)) {
        map.set(path, toBytes(content));
    }
    return map;
}
