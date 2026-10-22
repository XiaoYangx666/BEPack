import path from "node:path";
import { spawn } from "node:child_process";
import { access, mkdir } from "node:fs/promises";
import { constants as fsConstants, readFileSync } from "node:fs";
import type { TypecheckCommandSetting } from "../config/configTypes.js";
import { BePackError } from "../errors/BePackError.js";
import { pathExists } from "../utils/fs.js";
import {
    formatTypecheckCommand,
    resolveTypecheck,
    type ResolvedTypecheck,
} from "./typecheckers.js";

const MAX_DIAGNOSTIC_BYTES = 10 * 1024 * 1024;

export type TypecheckOptions = {
    quiet?: boolean;
    /**
     * Command line to run. Defaults to `"tsc --noEmit"`; this default and deprecated
     * `useNpx` compatibility mode receive BePack's tsconfig/cache flags. A custom command
     * is run exactly as configured.
     */
    command?: TypecheckCommandSetting;
    /** Additional arguments appended to `command`. */
    args?: string[];
    /** @deprecated Use `command: "npx tsc --noEmit"`. */
    useNpx?: boolean;
    /**
     * Path to tsconfig, relative to cwd unless absolute. Applied to the default checker
     * and deprecated `useNpx` compatibility mode; a custom command must pass its own
     * tsconfig flag through `args`.
     */
    tsconfigPath?: string;
    incremental?: boolean;
    tsBuildInfoFile?: string;
    /** Logger used for the non-fatal "no tsconfig" notice. */
    warn?: (message: string) => void;
};

/**
 * Run the configured type checker before Rolldown.
 *
 * Returns the resolved checker so the caller can report it. A missing tsconfig is fatal
 * for the default `tsc` and a warning for everything else: a custom command may not need
 * one at all (a formatter-style checker, a wrapper script, a tool with its own defaults).
 */
export async function runTypecheck(
    cwd: string,
    options: TypecheckOptions = {}
): Promise<ResolvedTypecheck & { commandLine: string }> {
    // `useNpx` predates `command`; it keeps the old default flags but routes through npx.
    // Only an *unset* command is the implicit default; anything the user wrote owns its
    // whole command line, so it never receives `--project` or the cache flags.
    const isDefaultCommand = typecheckIsDefault(options.command);
    const configuredTsconfig = options.tsconfigPath ?? "tsconfig.json";
    const tsconfigPath = path.resolve(cwd, configuredTsconfig);
    const tsconfigExists = await pathExists(tsconfigPath);

    const typecheck = resolveTypecheck(
        options.command,
        options.args ?? [],
        isDefaultCommand
            ? {
                  tsconfigPath,
                  incremental: Boolean(options.incremental),
                  useNpx: Boolean(options.useNpx),
                  ...(options.tsBuildInfoFile ? { tsBuildInfoFile: options.tsBuildInfoFile } : {}),
              }
            : {}
    );

    if (!tsconfigExists) {
        if (isDefaultCommand) {
            throw new BePackError(
                "TYPECHECK_FAILED",
                `TypeScript config not found: ${configuredTsconfig}. Create it or run build with --skip-typecheck.`,
                { details: { path: configuredTsconfig, command: typecheck.label } }
            );
        }
        options.warn?.(
            `TypeScript config not found: ${configuredTsconfig} — running \`${typecheck.label}\` anyway.`
        );
    }

    // Ensure cache directory exists for incremental builds.
    if (options.incremental && options.tsBuildInfoFile && isDefaultCommand) {
        await mkdir(path.dirname(options.tsBuildInfoFile), { recursive: true });
    }

    const commandLine = formatTypecheckCommand(typecheck);

    // Resolve the executable up front so a missing checker is reported as such on every
    // platform instead of surfacing as a generic non-zero exit (Windows `cmd.exe` exits 1).
    const executable = await findExecutable(typecheck.command, cwd);
    if (!executable) {
        throw new BePackError("TYPECHECK_FAILED", `Cannot find ${typecheck.command}.`, {
            details: { command: commandLine, label: typecheck.label },
            suggestions: missingCommandSuggestions(typecheck),
        });
    }

    // `.cmd`/`.bat` shims (`tsc.cmd`, `npx`, `pnpm`, `yarn`, ...) can only run through a
    // shell on Windows — spawning them directly fails with EINVAL. Everything else is
    // spawned with an argument array so arguments are never re-parsed or split.
    //
    // When a shell *is* required the whole command line is built and quoted by BePack:
    // Node does not escape an argument array for `cmd.exe` (that is the DEP0190 warning),
    // which silently splits `--project <path with spaces>` and breaks any project under a
    // path like `C:\Users\First Last\...`.
    const useShell = process.platform === "win32" && /\.(cmd|bat)$/i.test(executable);
    const spawnedCommand = useShell
        ? buildShellCommandLine(executable, typecheck.args)
        : executable;
    const spawnedArgs = useShell ? [] : typecheck.args;

    // Windows can reject a real-but-not-executable file synchronously (`EFTYPE` for a
    // `.mjs` entry point, for example). That throws out of the Promise executor, so the
    // spawn is guarded and mapped to the same TYPECHECK_FAILED error as an async failure.
    let child: ReturnType<typeof spawn>;
    try {
        child = spawn(spawnedCommand, spawnedArgs, {
            cwd,
            windowsHide: true,
            shell: useShell,
            stdio: ["ignore", "pipe", "pipe"],
        });
    } catch (cause) {
        throw new BePackError("TYPECHECK_FAILED", `Cannot start ${commandLine}.`, {
            details: {
                command: commandLine,
                label: typecheck.label,
                cause: cause instanceof Error ? cause.message : String(cause),
            },
            suggestions: missingCommandSuggestions(typecheck),
        });
    }

    await new Promise<void>((resolve, reject) => {
        let stdout = "";
        let stderr = "";
        let capturedBytes = 0;

        const capture = (chunk: unknown): string => {
            const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
            const remaining = MAX_DIAGNOSTIC_BYTES - capturedBytes;
            if (remaining <= 0) return "";
            if (bytes.length <= remaining) {
                capturedBytes += bytes.length;
                return bytes.toString("utf8");
            }
            capturedBytes = MAX_DIAGNOSTIC_BYTES;
            return bytes.subarray(0, remaining).toString("utf8");
        };

        child.stdout?.on("data", (chunk) => {
            stdout += capture(chunk);
            if (!options.quiet) process.stdout.write(chunk);
        });
        child.stderr?.on("data", (chunk) => {
            stderr += capture(chunk);
            if (!options.quiet) process.stderr.write(chunk);
        });

        child.on("error", (cause) => {
            reject(
                new BePackError("TYPECHECK_FAILED", `Cannot start ${commandLine}.`, {
                    details: { command: commandLine, label: typecheck.label, cause: cause.message },
                    suggestions: missingCommandSuggestions(typecheck),
                })
            );
        });

        child.on("close", (code) => {
            if (code === 0) {
                resolve();
                return;
            }
            const diagnostics = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");
            const commandMissing = isCommandMissing(diagnostics);
            reject(
                new BePackError(
                    "TYPECHECK_FAILED",
                    commandMissing ? `Cannot find ${typecheck.command}.` : `${commandLine} failed.`,
                    {
                        details: {
                            command: commandLine,
                            label: typecheck.label,
                            exitCode: typeof code === "number" ? code : null,
                            ...(diagnostics ? { diagnostics } : {}),
                        },
                        ...(commandMissing
                            ? { suggestions: missingCommandSuggestions(typecheck) }
                            : {}),
                    }
                )
            );
        });
    });

    return { ...typecheck, commandLine };
}

/**
 * Build a complete, correctly quoted command line for a shell spawn.
 *
 * Windows goes to `cmd.exe` (`.cmd`/`.bat` shims), POSIX to `/bin/sh`, and each has its
 * own quoting rules — hence the platform split.
 */
export function buildShellCommandLine(executable: string, args: string[]): string {
    const quote = process.platform === "win32" ? quoteForCmd : quoteForPosixShell;
    return [executable, ...args].map(quote).join(" ");
}

/**
 * Quote one argument for `cmd.exe`, following the MSVC/`CommandLineToArgvW` rules that
 * the `.cmd` shims themselves rely on: wrap in double quotes when the value is empty or
 * contains whitespace/special characters, and escape inner quotes and the backslashes
 * that precede them.
 */
export function quoteForCmd(value: string): string {
    if (value === "") return '""';
    // `%` expands even inside cmd.exe quotes. If it is the only character that needs
    // escaping, a caret is enough; otherwise split the quoted argument around each `%`
    // so the caret is outside quotes and cmd.exe passes the percent literally.
    if (!/[\s"&|<>^()!,;=]/.test(value)) return value.replace(/%/g, "^%");

    let quoted = '"';
    let backslashes = 0;
    for (const char of value) {
        if (char === "\\") {
            backslashes += 1;
            continue;
        }
        if (char === "%") {
            quoted += "\\".repeat(backslashes * 2) + '"^%"';
            backslashes = 0;
            continue;
        }
        if (char === '"') {
            // Double the pending backslashes, then escape the quote itself.
            quoted += "\\".repeat(backslashes * 2 + 1) + '"';
            backslashes = 0;
            continue;
        }
        quoted += "\\".repeat(backslashes) + char;
        backslashes = 0;
    }
    // Backslashes directly before the closing quote must be doubled as well.
    quoted += "\\".repeat(backslashes * 2) + '"';
    return quoted;
}

/** Quote one argument for `/bin/sh` (also covers `bash`/`dash`). */
export function quoteForPosixShell(value: string): string {
    if (value === "") return "''";
    if (!/[\s"'\\$`!*?[\]{}();&|<>~#]/.test(value)) return value;
    return `'${value.replace(/'/g, "'\\''")}'`;
}

/**
 * Recognize a "the executable does not exist" failure reported in the checker's output.
 * Used as a fallback for the unlikely case where the pre-spawn lookup succeeded but the
 * process still could not be started.
 */
function isCommandMissing(diagnostics: string): boolean {
    return (
        diagnostics.includes("ENOENT") ||
        diagnostics.includes("is not recognized") ||
        diagnostics.includes("不是内部或外部命令") ||
        diagnostics.includes("command not found")
    );
}

/**
 * Locate `command` the way a shell would: absolute/relative paths are checked directly,
 * otherwise every `PATH` entry is probed and, on Windows, every `PATHEXT` suffix.
 */
async function findExecutable(command: string, cwd: string): Promise<string | undefined> {
    const hasPathSeparator = command.includes("/") || command.includes("\\");
    if (path.isAbsolute(command) || hasPathSeparator) {
        const candidate = path.resolve(cwd, command);
        if (await isExecutableFile(candidate)) {
            // Windows: npm's `node_modules/.bin/` ships a path-qualified command in three
            // flavors (`tsc` as a POSIX sh script, `tsc.cmd`, `tsc.ps1`). Resolving the
            // extensionless sh script and spawning it directly fails with ENOENT, so when
            // the exact file is not directly launchable, prefer a launchable sibling
            // (`.cmd`/`.bat`/`.exe`) next to it — the same completion `cmd.exe` performs.
            if (process.platform === "win32" && !isDirectlyLaunchable(candidate)) {
                const sibling = await findLaunchableSibling(candidate);
                if (sibling) return sibling;
            }
            return candidate;
        }
        return undefined;
    }

    const pathValue = process.env.PATH ?? "";
    const extensions =
        process.platform === "win32"
            ? (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)
            : [""];

    for (const entry of pathValue.split(path.delimiter)) {
        // An empty PATH element means the current working directory.
        const dir = entry ? path.resolve(cwd, entry) : cwd;
        const exactCandidate = path.join(dir, command);
        // On Windows an extensionless command must not resolve to a bare file: npm's
        // `bin` directory ships both `npx` (a POSIX sh script) and `npx.cmd`, and
        // `access(X_OK)` accepts any readable file there. Picking the sh script and
        // spawning it directly fails with ENOENT — the `PATHEXT` candidates below are
        // the ones a Windows shell would actually run. A command spelled with an
        // explicit extension is still taken literally.
        const tryExact =
            process.platform !== "win32" || Boolean(path.extname(command));
        if (tryExact && (await isExecutableFile(exactCandidate))) return exactCandidate;
        for (const extension of extensions) {
            if (extension && path.extname(command)) continue;
            const candidate = path.join(dir, command + extension);
            if (await isExecutableFile(candidate)) return candidate;
        }
    }
    return undefined;
}

async function isExecutableFile(candidate: string): Promise<boolean> {
    try {
        await access(candidate, fsConstants.X_OK);
        return true;
    } catch {
        return false;
    }
}

/**
 * True when the file can be spawned by Node on this platform without a shell:
 * executables and scripts a shebang-aware interpreter claims. A POSIX sh script
 * (`#!/bin/sh`) is *not* one of them on Windows.
 */
function isDirectlyLaunchable(file: string): boolean {
    const extension = path.extname(file).toLowerCase();
    if (extension === ".cmd" || extension === ".bat") return false; // needs cmd.exe
    if (extension !== "") return true; // .exe, .ps1 handled elsewhere, custom...
    // Extensionless: could be a POSIX sh script — sniff for a shebang naming a shell.
    return !isShellShebangFile(file);
}

/** Read the first line and check for a `#!/bin/sh`-style shebang. */
function isShellShebangFile(file: string): boolean {
    try {
        const buffer = readFileSync(file);
        const firstLine = buffer.subarray(0, buffer.indexOf(0x0a)).toString("utf8");
        return firstLine.startsWith("#!");
    } catch {
        return false;
    }
}

/**
 * On Windows, find a launchable shim for a command whose exact file cannot be spawned
 * (`tsc` → `tsc.cmd` next to it), mirroring `cmd.exe`'s PATHEXT completion.
 */
async function findLaunchableSibling(candidate: string): Promise<string | undefined> {
    const directory = path.dirname(candidate);
    const base = path.basename(candidate);
    for (const extension of LAUNCHABLE_EXTENSIONS) {
        const sibling = path.join(directory, base + extension);
        if (await isExecutableFile(sibling)) return sibling;
    }
    return undefined;
}

const LAUNCHABLE_EXTENSIONS = [".cmd", ".bat", ".exe"];

function missingCommandSuggestions(typecheck: ResolvedTypecheck): string[] {
    return [
        `Install the checker so \`${typecheck.command}\` is available, or point ` +
            "packs.bp.compile.typecheck.command at a command you do have " +
            '(for example "bun check", "tsc-rs --noEmit", "npx tsc --noEmit").',
        "Run with --skip-typecheck to build without checking (the bundle is still produced).",
    ];
}

/**
 * True only when the caller left the command unset, which is the one case where BePack
 * contributes `--project` and the cache flags. An explicitly written command owns its
 * whole command line, even if it happens to spell the default.
 */
function typecheckIsDefault(command: TypecheckCommandSetting | undefined): boolean {
    return typeof command !== "string" || command.trim() === "";
}
