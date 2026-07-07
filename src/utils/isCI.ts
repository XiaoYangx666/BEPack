export function isCI(env: NodeJS.ProcessEnv = process.env): boolean {
    return env.CI === "true" || env.GITHUB_ACTIONS === "true" || env.TF_BUILD === "true";
}
