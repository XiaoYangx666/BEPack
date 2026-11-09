import {
    DEFAULT_MAX_ARCHIVE_BYTES,
    readAddonArchive,
    writeAddonArchive,
    writeAddonArchiveTo,
    writeAddonBlob,
    writeAddonBytes,
    type AddonArchiveSink,
    type ReadAddonArchiveOptions,
    type WriteAddonOptions,
} from "./archive.js";
import {
    applyIdentity,
    readIdentity,
    type AddonIdentity,
    type UpdateIdentityOptions,
    type UpdateIdentityResult,
} from "./core/identity.js";
import { AddonError } from "./core/errors.js";
import { isManifestPath, normalizeArchivePath } from "./core/path.js";
import { discoverPacks, type AddonPacks, type PackKind } from "./core/packs.js";
import { ManifestEditor } from "./manifestEditor.js";
import {
    addonFileSize,
    isAddonSource,
    readSource,
    type AddonEntry,
    type AddonFileData,
} from "./sources.js";

export interface ReadAddonOptions extends ReadAddonArchiveOptions {
    /** Explicit behavior pack root, e.g. `"bp"` or `"behavior_packs/my_bp"`. */
    readonly bpRoot?: string;
    /** Explicit resource pack root. */
    readonly rpRoot?: string;
    /** Name used for diagnostics and download filenames. */
    readonly sourceName?: string;
}

export interface ReplaceFilesOptions {
    /** Exact paths to replace. */
    readonly exactPaths?: readonly string[];
    /** Directory prefixes to replace, e.g. `"bp/scripts/music/"`. */
    readonly prefixes?: readonly string[];
    readonly files?: readonly AddonEntry[];
}

/**
 * In-memory editable view of one `.mcaddon` / `.mcpack`.
 *
 * The class owns archive paths and manifest identity, not domain-specific
 * generation. Generated files stay external until they are written.
 */
export class AddonTemplate {
    private readonly fileMap = new Map<string, AddonEntry>();
    private packsState: AddonPacks;
    public readonly sourceName: string;

    public constructor(sourceName: string, files: readonly AddonEntry[], packs?: AddonPacks) {
        this.sourceName = sourceName;
        for (const file of files) {
            const path = normalizeArchivePath(file.path);
            if (this.fileMap.has(path)) {
                throw new AddonError("ADDON_DUPLICATE_PATH", `Duplicate addon path: ${path}.`);
            }
            this.fileMap.set(
                path,
                isAddonSource(file) ? { ...file, path } : { path, bytes: file.bytes }
            );
        }
        this.packsState = packs ?? discoverPacks(this.bytesOnlyMap());
    }

    public static async read(
        input: Uint8Array | Blob,
        options: ReadAddonOptions = {}
    ): Promise<AddonTemplate> {
        let bytes: Uint8Array;
        if (isBlobInput(input)) {
            const maxArchiveBytes = options.maxArchiveBytes ?? DEFAULT_MAX_ARCHIVE_BYTES;
            if (input.size > maxArchiveBytes) {
                throw new AddonError(
                    "ADDON_ARCHIVE_TOO_LARGE",
                    `The addon archive is larger than ${maxArchiveBytes} bytes.`
                );
            }
            bytes = new Uint8Array(await input.arrayBuffer());
        } else {
            bytes = input;
        }

        const files = await readAddonArchive(bytes, options);
        const packs = discoverPacks(new Map(files.map((file) => [file.path, file.bytes])), {
            ...(options.bpRoot !== undefined ? { bpRoot: options.bpRoot } : {}),
            ...(options.rpRoot !== undefined ? { rpRoot: options.rpRoot } : {}),
        });
        return new AddonTemplate(options.sourceName ?? "addon.mcaddon", files, packs);
    }

    public get packs(): AddonPacks {
        return this.packsState;
    }

    public get fileCount(): number {
        return this.fileMap.size;
    }

    public get totalBytes(): number {
        let total = 0;
        for (const entry of this.fileMap.values()) total += addonFileSize(entry);
        return total;
    }

    public has(path: string): boolean {
        return this.fileMap.has(normalizeArchivePath(path));
    }

    /** Synchronous read for fully loaded files only. */
    public readSync(path: string): AddonFileData | undefined {
        const normalized = normalizeArchivePath(path);
        const entry = this.fileMap.get(normalized);
        if (!entry) return undefined;
        if (isAddonSource(entry)) {
            throw new AddonError(
                "ADDON_SOURCE_LAZY",
                `${normalized} is stored as a lazy source; use read() instead.`
            );
        }
        return { path: normalized, bytes: entry.bytes };
    }

    public async read(path: string): Promise<AddonFileData | undefined> {
        const normalized = normalizeArchivePath(path);
        const entry = this.fileMap.get(normalized);
        if (!entry) return undefined;
        if (!isAddonSource(entry)) return { path: normalized, bytes: entry.bytes };
        return { path: normalized, bytes: await readSource(entry) };
    }

    public readTextSync(path: string): string | undefined {
        const file = this.readSync(path);
        return file ? new TextDecoder().decode(file.bytes) : undefined;
    }

    public async readText(path: string): Promise<string | undefined> {
        const file = await this.read(path);
        return file ? new TextDecoder().decode(file.bytes) : undefined;
    }

    public write(path: string, bytes: Uint8Array): void {
        const normalized = normalizeArchivePath(path);
        this.fileMap.set(normalized, { path: normalized, bytes: bytes.slice() });
        if (isManifestPath(normalized)) this.refreshPacks();
    }

    public writeText(path: string, text: string): void {
        this.write(path, new TextEncoder().encode(text));
    }

    public remove(path: string): void {
        const normalized = normalizeArchivePath(path);
        this.fileMap.delete(normalized);
        if (isManifestPath(normalized)) this.refreshPacks();
    }

    public removeTree(prefix: string): void {
        const normalized = normalizeArchivePath(
            prefix.endsWith("/") ? prefix.slice(0, -1) : prefix
        );
        const directoryPrefix = `${normalized}/`;
        let manifestRemoved = false;
        for (const path of [...this.fileMap.keys()]) {
            if (path === normalized || path.startsWith(directoryPrefix)) {
                if (isManifestPath(path)) manifestRemoved = true;
                this.fileMap.delete(path);
            }
        }
        if (manifestRemoved) this.refreshPacks();
    }

    /** Replace exactly the managed paths, matching BePack's `replaceManaged` model. */
    public replace(options: ReplaceFilesOptions): void {
        const exactPaths = (options.exactPaths ?? []).map(normalizeArchivePath);
        const prefixes = (options.prefixes ?? []).map(normalizePrefix);
        const incoming = (options.files ?? []).map((file) => {
            const path = normalizeArchivePath(file.path);
            return isAddonSource(file) ? { ...file, path } : { path, bytes: file.bytes.slice() };
        });

        const incomingPaths = new Set<string>();
        for (const file of incoming) {
            if (incomingPaths.has(file.path)) {
                throw new AddonError(
                    "ADDON_DUPLICATE_PATH",
                    `Generated content contains duplicate path: ${file.path}.`
                );
            }
            incomingPaths.add(file.path);
        }

        let manifestAffected = false;
        for (const path of [...this.fileMap.keys()]) {
            if (exactPaths.includes(path) || prefixes.some((prefix) => path.startsWith(prefix))) {
                if (isManifestPath(path)) manifestAffected = true;
                this.fileMap.delete(path);
            }
        }
        for (const file of incoming) {
            if (isManifestPath(file.path)) manifestAffected = true;
            this.fileMap.set(file.path, file);
        }
        if (manifestAffected) this.refreshPacks();
    }

    public identity(): AddonIdentity {
        return readIdentity(this.packsState);
    }

    public updateIdentity(
        options: UpdateIdentityOptions = {},
        format: { readonly indent?: number } = {}
    ): UpdateIdentityResult {
        const result = applyIdentity(this.packsState, options);
        const encoder = new TextEncoder();
        const indent = format.indent ?? 2;
        for (const pack of [this.packsState.bp, this.packsState.rp]) {
            if (!pack) continue;
            const text = `${JSON.stringify(pack.manifest, null, indent)}\n`;
            this.fileMap.set(pack.manifestPath, {
                path: pack.manifestPath,
                bytes: encoder.encode(text),
            });
        }
        return result;
    }

    /**
     * Structured editor for one pack's manifest.
     *
     * ```ts
     * addon.manifest("bp")
     *     .setName("My Pack")
     *     .addDependency({ module_name: "@minecraft/server", version: "2.0.0" })
     *     .validate()
     *     .save();
     * ```
     */
    public manifest(kind: PackKind, options: { readonly indent?: number } = {}): ManifestEditor {
        const resolve = () => (kind === "bp" ? this.packsState.bp : this.packsState.rp);
        const pack = resolve();
        if (!pack) {
            throw new AddonError(
                "ADDON_MANIFEST_MISSING",
                `The addon has no ${kind === "bp" ? "behavior" : "resource"} pack.`
            );
        }
        const manifestPath = pack.manifestPath;
        return new ManifestEditor({
            kind,
            manifestPath,
            getManifest: () => {
                const current = resolve();
                if (!current) {
                    throw new AddonError(
                        "ADDON_MANIFEST_MISSING",
                        `The addon no longer has a ${kind === "bp" ? "behavior" : "resource"} pack.`
                    );
                }
                return current.manifest;
            },
            write: (text) => this.writeText(manifestPath, text),
            ...(options.indent !== undefined ? { indent: options.indent } : {}),
        });
    }

    public entries(): readonly AddonEntry[] {
        return [...this.fileMap.values()].sort((left, right) =>
            left.path.localeCompare(right.path)
        );
    }

    public toBytes(options: Omit<WriteAddonOptions, "type"> = {}): Promise<Uint8Array> {
        return writeAddonBytes(this.entries(), options);
    }

    public toBlob(options: Omit<WriteAddonOptions, "type"> = {}): Promise<Blob> {
        return writeAddonBlob(this.entries(), options);
    }

    public toArchive(options: WriteAddonOptions = {}): Promise<Blob | Uint8Array> {
        return writeAddonArchive(this.entries(), options);
    }

    public toSink(
        sink: AddonArchiveSink,
        options: Omit<WriteAddonOptions, "type"> = {}
    ): Promise<void> {
        return writeAddonArchiveTo(this.entries(), sink, options);
    }

    private bytesOnlyMap(): Map<string, Uint8Array> {
        const map = new Map<string, Uint8Array>();
        for (const [path, entry] of this.fileMap) {
            if (!isAddonSource(entry)) map.set(path, entry.bytes);
        }
        return map;
    }

    private refreshPacks(): void {
        const bpRoot = this.packsState.bp?.root;
        const rpRoot = this.packsState.rp?.root;
        this.packsState = discoverPacks(this.bytesOnlyMap(), {
            ...(bpRoot !== undefined ? { bpRoot } : {}),
            ...(rpRoot !== undefined ? { rpRoot } : {}),
            allowMissing: true,
        });
    }
}

export function readAddon(
    input: Uint8Array | Blob,
    options: ReadAddonOptions = {}
): Promise<AddonTemplate> {
    return AddonTemplate.read(input, options);
}

export function writeAddon(
    addon: AddonTemplate,
    options: WriteAddonOptions = {}
): Promise<Blob | Uint8Array> {
    return writeAddonArchive(addon.entries(), options);
}

export function writeAddonTo(
    addon: AddonTemplate,
    sink: AddonArchiveSink,
    options: Omit<WriteAddonOptions, "type"> = {}
): Promise<void> {
    return writeAddonArchiveTo(addon.entries(), sink, options);
}

function normalizePrefix(rawPrefix: string): string {
    const normalized = normalizeArchivePath(
        rawPrefix.endsWith("/") ? rawPrefix.slice(0, -1) : rawPrefix
    );
    return `${normalized}/`;
}

function isBlobInput(value: Uint8Array | Blob): value is Blob {
    return (
        typeof value === "object" &&
        value !== null &&
        typeof (value as Blob).arrayBuffer === "function" &&
        typeof (value as Blob).size === "number"
    );
}
