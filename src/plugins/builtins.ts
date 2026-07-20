import type { BePackPlugin } from "../config/configTypes.js";
import { sapiPro } from "./sapiPro.js";

/** Factories for plugins that can be referenced by name in project configs. */
export const BUILTIN_PLUGINS: Record<string, () => BePackPlugin> = {
    "sapi-pro": sapiPro,
};
