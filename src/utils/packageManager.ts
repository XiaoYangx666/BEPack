import { spawn } from "node:child_process";
import path from "node:path";
import type { LoggerLike, PackageManager as PackageManagerType } from "../config/configTypes.js";
import { BePackError } from "../errors/BePackError.js";
import { pathExists, readJsonFile } from "./fs.js";

/**
 * npm 12 resolves `--allow-scripts` from a *CLI/env* layer and rejects it for
 * project-scoped installs with `EALLOWSCRIPTS`.
 *
 * `npm run <script>` exports every resolved npm config value as `npm_config_*`,
 * so a user/global `.npmrc` containing `allow-scripts=...` leaks into the child
 * environment of `bepack install` and makes the nested `npm install` fail:
 *
 *   npm error code EALLOWSCRIPTS
 *   npm error --allow-scripts is not allowed in project-scoped installs.
 *
 * The value is honoured anyway through `.npmrc` / `package.json#allowScripts`,
 * so the inherited env var is dropped before spawning the package manager.
 */
export function sanitizePackageManagerEnv(env: NodeJS.ProcessEnv): {
    env: NodeJS.ProcessEnv;
    removed: string[];
} {
    const removed: string[] = [];
    const next: NodeJS.ProcessEnv = {};
    for (const [key, value] of Object.entries(env)) {
        // npm config keys are case-insensitive (`npm_config_allow_scripts`).
        if (key.toLowerCase() === "npm_config_allow_scripts") {
            removed.push(key);
            continue;
        }
        next[key] = value;
    }
    return { env: next, removed };
}

export class PackageManager {
    constructor(
        private readonly cwd: string,
        private readonly registry?: string,
        private readonly logger?: LoggerLike
    ) {}

    async detect(configured: PackageManagerType): Promise<Exclude<PackageManagerType, "auto">> {
        if (configured !== "auto") return configured;
        const pkgPath = path.join(this.cwd, "package.json");
        if (await pathExists(pkgPath)) {
            const pkg = await readJsonFile<{ packageManager?: string }>(pkgPath);
            const name = pkg.packageManager?.split("@")[0];
            if (name === "npm" || name === "pnpm" || name === "yarn" || name === "bun") return name;
        }
        if (await pathExists(path.join(this.cwd, "pnpm-lock.yaml"))) return "pnpm";
        if (await pathExists(path.join(this.cwd, "yarn.lock"))) return "yarn";
        if (await pathExists(path.join(this.cwd, "bun.lock"))) return "bun";
        if (await pathExists(path.join(this.cwd, "bun.lockb"))) return "bun";
        return "npm";
    }

    async install(manager: Exclude<PackageManagerType, "auto">): Promise<number> {
        const { command, args } = this.commandForPlatform(manager, this.installArgs(manager));
        const { env, removed } = sanitizePackageManagerEnv(process.env);
        if (removed.length > 0) {
            this.logger?.warn(
                `Ignoring inherited ${removed.join(", ")}: npm rejects --allow-scripts for ` +
                    `project-scoped installs. Declare allowed packages in package.json "allowScripts" ` +
                    `or in .npmrc instead.`
            );
        }
        return await new Promise((resolve, reject) => {
            let child;
            try {
                child = spawn(command, args, { cwd: this.cwd, stdio: "inherit", env });
            } catch (cause) {
                reject(
                    new BePackError("PACKAGE_MANAGER_NOT_FOUND", `${manager} is not available.`, {
                        details: {
                            manager,
                            cause: cause instanceof Error ? cause.message : String(cause),
                        },
                    })
                );
                return;
            }
            child.on("error", (cause) =>
                reject(
                    new BePackError("PACKAGE_MANAGER_NOT_FOUND", `${manager} is not available.`, {
                        details: { manager, cause: cause.message },
                    })
                )
            );
            child.on("exit", (code) => {
                if (code && code !== 0)
                    reject(
                        new BePackError("PACKAGE_MANAGER_FAILED", `${manager} install failed.`, {
                            details: { manager, registry: this.registry, exitCode: code },
                        })
                    );
                else resolve(code ?? 0);
            });
        });
    }

    private commandForPlatform(
        command: string,
        args: string[]
    ): { command: string; args: string[] } {
        if (process.platform !== "win32") return { command, args };
        return {
            command: process.env.ComSpec ?? "cmd.exe",
            args: ["/d", "/s", "/c", command, ...args],
        };
    }

    private installArgs(manager: Exclude<PackageManagerType, "auto">): string[] {
        const args = ["install"];
        if (this.registry) {
            if (
                manager === "npm" ||
                manager === "pnpm" ||
                manager === "bun" ||
                manager === "yarn"
            ) {
                args.push("--registry", this.registry);
            }
        }
        return args;
    }
}
