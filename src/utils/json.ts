export function parseJson<T>(text: string, file: string): T {
    try {
        return JSON.parse(text) as T;
    } catch (cause) {
        throw new Error(
            `Invalid JSON in ${file}: ${cause instanceof Error ? cause.message : String(cause)}`
        );
    }
}

export function stringifyJson(value: unknown): string {
    return `${JSON.stringify(value, null, 4)}\n`;
}
