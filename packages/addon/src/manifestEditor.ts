import {
    addDependency,
    addModule,
    dependencyList,
    findDependency,
    findModule,
    formatVersionOf,
    moduleList,
    patchHeader,
    patchManifest,
    removeDependency,
    removeModule,
    setCapability,
    setFormatVersion,
    setMetadata,
    validateManifest,
    type DependencyMatcher,
    type HeaderPatch,
    type Manifest,
    type ManifestDependency,
    type ManifestModule,
    type ManifestPatch,
    type ManifestVersion,
    type ModuleMatcher,
    type PackKind,
    type UpsertOptions,
} from "./core/index.js";

export interface ManifestEditorOptions {
    readonly kind: PackKind;
    readonly manifestPath: string;
    /** Resolve the live manifest; it is replaced when the addon re-parses. */
    getManifest(): Manifest;
    write(text: string): void;
    /** Indentation used by `save()`/`toText()`. Defaults to 2. */
    readonly indent?: number;
}

/**
 * Structured editor for one pack's `manifest.json`.
 *
 * It edits the manifest object in place and writes it back through the owning
 * `AddonTemplate`, so `addon.packs` stays consistent after `save()`. It knows
 * nothing about npm versions or BePack's dependency policy: callers pass exact
 * entries.
 */
export class ManifestEditor {
    public readonly kind: PackKind;
    public readonly manifestPath: string;
    private readonly resolve: () => Manifest;
    private readonly writeText: (text: string) => void;
    private readonly defaultIndent: number;

    public constructor(options: ManifestEditorOptions) {
        this.kind = options.kind;
        this.manifestPath = options.manifestPath;
        this.resolve = options.getManifest;
        this.writeText = options.write;
        this.defaultIndent = options.indent ?? 2;
    }

    public get manifest(): Manifest {
        return this.resolve();
    }

    public get formatVersion(): number {
        return formatVersionOf(this.manifest);
    }

    public setName(name: string): this {
        patchHeader(this.manifest, { name });
        return this;
    }

    public setDescription(description: string): this {
        patchHeader(this.manifest, { description });
        return this;
    }

    public setVersion(version: ManifestVersion): this {
        patchHeader(this.manifest, { version });
        return this;
    }

    public setHeaderUuid(uuid: string): this {
        patchHeader(this.manifest, { uuid });
        return this;
    }

    public setMinEngineVersion(version: ManifestVersion): this {
        patchHeader(this.manifest, { min_engine_version: version });
        return this;
    }

    public setPackScope(scope: string): this {
        patchHeader(this.manifest, { pack_scope: scope });
        return this;
    }

    public setHeader(patch: HeaderPatch): this {
        patchHeader(this.manifest, patch);
        return this;
    }

    /** Rewrite all version fields; useful for format 2 <-> 3 conversion. */
    public setFormatVersion(version: 2 | 3): this {
        setFormatVersion(this.manifest, version);
        return this;
    }

    public dependencies(): readonly ManifestDependency[] {
        return dependencyList(this.manifest);
    }

    public dependency(matcher: DependencyMatcher): ManifestDependency | undefined {
        return findDependency(this.manifest, matcher);
    }

    public addDependency(dependency: ManifestDependency, options?: UpsertOptions): this {
        addDependency(this.manifest, dependency, options ?? {});
        return this;
    }

    public removeDependency(matcher: DependencyMatcher): number {
        return removeDependency(this.manifest, matcher);
    }

    public modules(): readonly ManifestModule[] {
        return moduleList(this.manifest);
    }

    public module(matcher: ModuleMatcher): ManifestModule | undefined {
        return findModule(this.manifest, matcher);
    }

    public addModule(module: ManifestModule, options?: UpsertOptions): this {
        addModule(this.manifest, module, options ?? {});
        return this;
    }

    public removeModule(matcher: ModuleMatcher): number {
        return removeModule(this.manifest, matcher);
    }

    public capabilities(): readonly string[] {
        return this.manifest.capabilities ?? [];
    }

    public hasCapability(capability: string): boolean {
        return this.capabilities().includes(capability);
    }

    public setCapability(capability: string, enabled = true): this {
        setCapability(this.manifest, capability, enabled);
        return this;
    }

    public metadata(): Readonly<Record<string, unknown>> {
        return this.manifest.metadata ?? {};
    }

    /** Set one metadata key; `null` or `undefined` deletes it. */
    public setMetadata(key: string, value: unknown): this {
        setMetadata(this.manifest, key, value);
        return this;
    }

    public deleteMetadata(key: string): this {
        setMetadata(this.manifest, key, null);
        return this;
    }

    public patch(patch: ManifestPatch): this {
        patchManifest(this.manifest, patch);
        return this;
    }

    /** Validate with the shared BePack rules; throws `AddonError`. */
    public validate(): this {
        validateManifest(this.manifest, this.kind);
        return this;
    }

    public toText(indent = this.defaultIndent): string {
        return `${JSON.stringify(this.manifest, null, indent)}\n`;
    }

    /**
     * Write the manifest back into the addon archive.
     *
     * The editor keeps pointing at the refreshed manifest, so later edits keep
     * working after a save.
     */
    public save(options: { readonly indent?: number } = {}): this {
        this.writeText(this.toText(options.indent ?? this.defaultIndent));
        return this;
    }
}
