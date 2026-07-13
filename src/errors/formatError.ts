import { BePackError } from "./BePackError.js";

export type FormattedError = {
    code: string;
    message: string;
    details?: unknown;
    suggestions?: string[];
    stack?: string;
};

export function formatError(error: unknown): FormattedError {
    if (error instanceof BePackError) {
        return {
            code: error.code,
            message: error.message,
            ...(error.details === undefined ? {} : { details: error.details }),
            ...(error.suggestions === undefined ? {} : { suggestions: error.suggestions }),
            ...(error.stack ? { stack: error.stack } : {}),
        };
    }
    if (error instanceof Error) {
        return {
            code: "UNKNOWN",
            message: error.message,
            ...(error.stack ? { stack: error.stack } : {}),
        };
    }
    return { code: "UNKNOWN", message: String(error) };
}
