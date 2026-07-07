import { BePackError } from "./BePackError.js";

export function formatError(error: unknown): { code: string; message: string; details?: unknown; suggestions?: string[] } {
    if (error instanceof BePackError) {
        return {
            code: error.code,
            message: error.message,
            ...(error.details === undefined ? {} : { details: error.details }),
            ...(error.suggestions === undefined ? {} : { suggestions: error.suggestions }),
        };
    }
    if (error instanceof Error) {
        return { code: "UNKNOWN", message: error.message };
    }
    return { code: "UNKNOWN", message: String(error) };
}
