import { AddonError, validateManifest as validateAddonManifest } from "@bepack/addon/core";
import { BePackError } from "../errors/BePackError.js";
import type { Manifest } from "./types.js";

/**
 * CLI-facing manifest validation.
 *
 * The rules live in `@bepack/addon/core` so generators and the CLI share one
 * implementation. The CLI only maps the structured error to its public
 * `MANIFEST_INVALID` code.
 */
export function validateManifest(manifest: Manifest, kind: "bp" | "rp"): void {
    try {
        validateAddonManifest(manifest, kind);
    } catch (error) {
        if (error instanceof AddonError) {
            throw new BePackError("MANIFEST_INVALID", error.message, {
                details: error.details,
            });
        }
        throw error;
    }
}
