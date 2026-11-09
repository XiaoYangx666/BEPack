import { AddonError } from "./errors.js";

/**
 * Normalize an archive path to POSIX style and reject unsafe paths.
 *
 * Rejected: empty paths, absolute paths, drive letters, NUL bytes, trailing
 * slashes, empty segments, `.` and `..`.
 */
export function normalizeArchivePath(rawPath: string): string {
    const path = rawPath.replaceAll("\\", "/");
    if (
        !path ||
        path.startsWith("/") ||
        /^[a-zA-Z]:/.test(path) ||
        path.includes("\0") ||
        path.endsWith("/") ||
        path.split("/").some((segment) => !segment || segment === "." || segment === "..")
    ) {
        throw new AddonError("ADDON_PATH_INVALID", `Unsafe addon path: ${rawPath || "(empty)"}.`);
    }
    return path;
}

/** Normalize a pack root (`bp`, `bp/`, `./bp`) into `bp/` or `""`. */
export function normalizePackRoot(rawRoot: string): string {
    const root = rawRoot.replaceAll("\\", "/");
    if (root === "" || root === ".") return "";
    const trimmed = root.replace(/^\.\//, "").replace(/\/+$/, "");
    if (
        !trimmed ||
        trimmed.startsWith("/") ||
        /^[a-zA-Z]:/.test(trimmed) ||
        trimmed.includes("\0") ||
        trimmed.split("/").some((segment) => !segment || segment === "." || segment === "..")
    ) {
        throw new AddonError("ADDON_PATH_INVALID", `Unsafe pack root: ${rawRoot || "(empty)"}.`);
    }
    return `${trimmed}/`;
}

export function manifestPathForRoot(root: string): string {
    return root ? `${root}manifest.json` : "manifest.json";
}

export function isManifestPath(path: string): boolean {
    return path === "manifest.json" || path.endsWith("/manifest.json");
}

export function packRootOfManifest(manifestPath: string): string {
    const index = manifestPath.lastIndexOf("/");
    return index < 0 ? "" : manifestPath.slice(0, index + 1);
}
