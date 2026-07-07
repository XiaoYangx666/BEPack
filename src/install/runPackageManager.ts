import { spawn } from "node:child_process";
import type { PackageManager } from "../config/configTypes.js";
import { BePackError } from "../errors/BePackError.js";

function commandForPlatform(command: string, args: string[]): { command: string; args: string[] } {
    if (process.platform !== "win32") return { command, args };
    return {
        command: process.env.ComSpec ?? "cmd.exe",
        args: ["/d", "/s", "/c", command, ...args],
    };
}

function installArgs(manager: Exclude<PackageManager, "auto">, registry?: string): string[] {
    const args = ["install"];
    if (registry) {
        if (manager === "npm" || manager === "pnpm" || manager === "bun" || manager === "yarn") {
            args.push("--registry", registry);
        }
    }
    return args;
}

export async function runPackageManager(cwd: string, manager: Exclude<PackageManager, "auto">, registry?: string): Promise<number> {
    const { command, args } = commandForPlatform(manager, installArgs(manager, registry));
    return await new Promise((resolve, reject) => {
        let child;
        try {
            child = spawn(command, args, { cwd, stdio: "inherit" });
        } catch (cause) {
            reject(new BePackError("PACKAGE_MANAGER_NOT_FOUND", `${manager} is not available.`, { details: { manager, cause: cause instanceof Error ? cause.message : String(cause) } }));
            return;
        }
        child.on("error", (cause) => reject(new BePackError("PACKAGE_MANAGER_NOT_FOUND", `${manager} is not available.`, { details: { manager, cause: cause.message } })));
        child.on("exit", (code) => {
            if (code && code !== 0) reject(new BePackError("PACKAGE_MANAGER_FAILED", `${manager} install failed.`, { details: { manager, registry, exitCode: code } }));
            else resolve(code ?? 0);
        });
    });
}
