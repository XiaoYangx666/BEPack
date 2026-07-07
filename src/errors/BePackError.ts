import type { ErrorCode } from "./codes.js";

export class BePackError extends Error {
    readonly code: ErrorCode;
    readonly details: unknown | undefined;
    readonly suggestions: string[] | undefined;

    constructor(
        code: ErrorCode,
        message: string,
        options: { details?: unknown; suggestions?: string[] } = {}
    ) {
        super(message);
        this.name = "BePackError";
        this.code = code;
        this.details = options.details;
        this.suggestions = options.suggestions;
    }
}
