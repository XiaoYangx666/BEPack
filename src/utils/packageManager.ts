import { spawn } from "node:child_process";
import path from "node:path";
import type { PackageManager as PackageManagerType } from "../config/configTypes.js";
import { BePackError } from "../errors/BePackError.js";
import { pathExists, readJsonFile } from "./fs.js";

export class PackageManager {
    constructor(
        private readonly cwd: string,
        private readonly registry?: string
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
        return await new Promise((resolve, reject) => {
            let child;
            try {
                child = spawn(command, args, { cwd: this.cwd, stdio: "inherit" });
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
