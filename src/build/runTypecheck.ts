import path from "node:path";
import { exec } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { BePackError } from "../errors/BePackError.js";
import { pathExists } from "../utils/fs.js";

type TypecheckOptions = {
    quiet?: boolean;
    useNpx?: boolean;
    /** Path to tsconfig, relative to cwd unless absolute. */
    tsconfigPath?: string;
    incremental?: boolean;
    tsBuildInfoFile?: string;
};

export function resolveTypecheckCommand(
    useNpx: boolean,
    tsconfigPath: string,
    incremental: boolean,
    tsBuildInfoFile?: string
): string {
    let cmd = useNpx ? "npx tsc --noEmit" : "tsc --noEmit";
    cmd += ` --project "${tsconfigPath}"`;
    if (incremental && tsBuildInfoFile) {
        cmd += ` --incremental --tsBuildInfoFile "${tsBuildInfoFile}"`;
    }
    return cmd;
}

export async function runTypecheck(cwd: string, options: TypecheckOptions = {}): Promise<void> {
    const configuredTsconfig = options.tsconfigPath ?? "tsconfig.json";
    const tsconfigPath = path.resolve(cwd, configuredTsconfig);
    if (!(await pathExists(tsconfigPath))) {
        throw new BePackError(
            "TYPECHECK_FAILED",
            `TypeScript config not found: ${configuredTsconfig}. Create it or run build with --skip-typecheck.`,
            { details: { path: configuredTsconfig } }
        );
    }

    // Ensure cache directory exists for incremental builds
    if (options.incremental && options.tsBuildInfoFile) {
        await mkdir(path.dirname(options.tsBuildInfoFile), { recursive: true });
    }

    const command = resolveTypecheckCommand(
        Boolean(options.useNpx),
        tsconfigPath,
        Boolean(options.incremental),
        options.tsBuildInfoFile
    );
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
                            ? ["Install npm/npx or set packs.bp.compile.entry to skip typecheck."]
                            : [
                                  "Install TypeScript globally so `tsc` is available.",
                                  "Set packs.bp.compile.useNpx: true to use the project local TypeScript.",
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
