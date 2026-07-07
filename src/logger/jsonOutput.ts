export function writeJson(value: unknown): void {
    console.log(JSON.stringify(value, null, 4));
}
