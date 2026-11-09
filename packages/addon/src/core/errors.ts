/**
 * Stable error codes for `@bepack/addon`.
 *
 * Messages are intentionally English so generators can map codes to their own
 * localized copy instead of parsing error text.
 */
export const ADDON_ERROR_CODES = [
    "ADDON_ARCHIVE_INVALID",
    "ADDON_ARCHIVE_TOO_LARGE",
    "ADDON_ARCHIVE_TOO_MANY_FILES",
    "ADDON_PATH_INVALID",
    "ADDON_DUPLICATE_PATH",
    "ADDON_MANIFEST_INVALID",
    "ADDON_MANIFEST_MISSING",
    "ADDON_PACK_KIND_UNKNOWN",
    "ADDON_PACK_DUPLICATE",
    "ADDON_IDENTITY_INVALID",
    "ADDON_SOURCE_LAZY",
    "ADDON_ABORTED",
] as const;

export type AddonErrorCode = (typeof ADDON_ERROR_CODES)[number];

export interface AddonErrorOptions {
    readonly details?: unknown;
    readonly suggestions?: readonly string[];
}

export class AddonError extends Error {
    readonly code: AddonErrorCode;
    readonly details: unknown | undefined;
    readonly suggestions: readonly string[] | undefined;

    public constructor(code: AddonErrorCode, message: string, options: AddonErrorOptions = {}) {
        super(message);
        this.name = "AddonError";
        this.code = code;
        this.details = options.details;
        this.suggestions = options.suggestions;
    }
}
