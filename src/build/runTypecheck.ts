import path from "node:path";
import { exec } from "node:child_process";
import { BePackError } from "../errors/BePackError.js";
import { pathExists } from "../utils/fs.js";

type TypecheckOptions = {
    quiet?: boolean;
    useNpx?: boolean;
};

function resolveCommand(useNpx: boolean): string {
    return useNpx ? "npx tsc --noEmit" : "tsc --noEmit";
}

export async function runTypecheck(cwd: string, options: TypecheckOptions = {}): Promise<void> {
    const tsconfigPath = path.join(cwd, "tsconfig.json");
    if (!(await pathExists(tsconfigPath))) {
        throw new BePackError(
            "TYPECHECK_FAILED",
            "tsconfig.json not found. Create tsconfig.json or run build with --skip-typecheck.",
            { details: { path: "tsconfig.json" } }
        );
    }

    const command = resolveCommand(Boolean(options.useNpx));
    await new Promise<void>((resolve, reject) => {
        let stdout = "";
        let stderr = "";
        let child;
        try {
            child = exec(
                command,
                { cwd, windowsHide: true, maxBuffer: 1024 * 1024 * 10 },
                (error) => {
                    if (!error) {
                        resolve();
                        return;
                    }

                    const diagnostics = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");
                    const commandMissing =
                        diagnostics.includes("not recognized") ||
                        diagnostics.includes("not found") ||
                        diagnostics.includes("ENOENT") ||
                        diagnostics.includes("不是内部或外部命令");
                    const suggestions = commandMissing
                        ? options.useNpx
                            ? ["Install npm/npx or set build.useNpx to false."]
                            : [
                                  "Install TypeScript globally so `tsc` is available.",
                                  "Set build.useNpx: true to use the project local TypeScript.",
                              ]
                        : undefined;
                    reject(
                        new BePackError(
                            "TYPECHECK_FAILED",
                            commandMissing
                                ? `Cannot find ${options.useNpx ? "npx" : "tsc"}.`
                                : `${command} failed.`,
                            {
                                details: {
                                    command,
                                    exitCode: typeof error.code === "number" ? error.code : null,
                                    ...(diagnostics ? { diagnostics } : {}),
                                },
                                ...(suggestions ? { suggestions } : {}),
                            }
                        )
                    );
                }
            );
        } catch (cause) {
            reject(
                new BePackError("TYPECHECK_FAILED", `Cannot start ${command}.`, {
                    details: {
                        command,
                        cause: cause instanceof Error ? cause.message : String(cause),
                    },
                    suggestions: options.useNpx
                        ? ["Install npm/npx or set build.useNpx to false."]
                        : [
                              "Install TypeScript globally so `tsc` is available.",
                              "Set build.useNpx: true to use the project local TypeScript.",
                          ],
                })
            );
            return;
        }
        child.on("error", (cause) => {
            reject(
                new BePackError("TYPECHECK_FAILED", `Cannot start ${command}.`, {
                    details: { command, cause: cause.message },
                    suggestions: options.useNpx
                        ? ["Install npm/npx or set build.useNpx to false."]
                        : [
                              "Install TypeScript globally so `tsc` is available.",
                              "Set build.useNpx: true to use the project local TypeScript.",
                          ],
                })
            );
        });
        child.stdout?.on("data", (chunk) => {
            stdout += String(chunk);
            if (!options.quiet) process.stdout.write(chunk);
        });
        child.stderr?.on("data", (chunk) => {
            stderr += String(chunk);
            if (!options.quiet) process.stderr.write(chunk);
        });
    });
}
