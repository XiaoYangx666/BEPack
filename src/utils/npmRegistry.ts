import { BePackError } from "../errors/BePackError.js";
import type { LoggerLike, NpmPackageMetadata } from "../config/configTypes.js";

function installLog(logger: LoggerLike | undefined, message: string): void {
    if (logger?.install) logger.install(message);
    else logger?.info(`[Install] ${message}`);
}

export class NpmRegistryClient {
    private readonly cache = new Map<string, NpmPackageMetadata>();

    constructor(
        private readonly registry: string,
        private readonly logger?: LoggerLike
    ) {}

    async metadata(packageName: string): Promise<NpmPackageMetadata> {
        const url = this.packageUrl(packageName);
        const cached = this.cache.get(url);
        if (cached) {
            this.logger?.verbose(`Using cached metadata for ${packageName}`);
            return cached;
        }
        installLog(this.logger, `fetching ${packageName} metadata from ${this.registry}`);
        const response = await fetch(url);
        if (!response.ok) {
            throw new BePackError(
                "SAPI_VERSION_NOT_FOUND",
                `Cannot fetch ${packageName} versions from registry.`,
                {
                    details: {
                        package: packageName,
                        registry: this.registry,
                        status: response.status,
                    },
                }
            );
        }
        const data = (await response.json()) as NpmPackageMetadata;
        this.cache.set(url, data);
        this.logger?.verbose(
            `Fetched ${packageName} metadata (${Object.keys(data.versions ?? {}).length} versions)`
        );
        return data;
    }

    versions(metadata: NpmPackageMetadata): string[] {
        return Object.keys(metadata.versions ?? {});
    }

    async versionsOf(packageName: string): Promise<string[]> {
        return this.versions(await this.metadata(packageName));
    }

    distTag(metadata: NpmPackageMetadata, tag: string): string | undefined {
        const version = metadata["dist-tags"]?.[tag];
        return version && metadata.versions?.[version] ? version : undefined;
    }

    private packageUrl(packageName: string): string {
        return `${this.registry.replace(/\/$/, "")}/${encodeURIComponent(packageName).replace(/^%40/, "@")}`;
    }
}
