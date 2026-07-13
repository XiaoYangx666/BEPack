import { cac } from "cac";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { commandInit } from "./commands/init.js";
import { commandInstall } from "./commands/install.js";
import { commandManifest } from "./commands/manifest.js";
import { commandBuild } from "./commands/build.js";
import { commandCopy } from "./commands/copy.js";
import { commandPack } from "./commands/pack.js";
import { commandDev } from "./commands/dev.js";
import { commandConfig } from "./commands/config.js";
import { formatError } from "./errors/formatError.js";
import { writeJson } from "./logger/jsonOutput.js";
import { BePackError } from "./errors/BePackError.js";
import pc from "picocolors";

const colors = pc.createColors(
    process.env.NO_COLOR === undefined && process.env.FORCE_COLOR !== "0"
);

// Read version from package.json (single source of truth)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const pkgPath = join(__dirname, "../package.json");

let pkgVersion: string;
try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    if (typeof pkg.version !== "string" || !pkg.version) {
        console.error("ERROR: package.json missing valid 'version' field");
        process.exit(1);
    }
    pkgVersion = pkg.version;
} catch (err) {
    console.error(`ERROR: Failed to read package version: ${(err as Error).message}`);
    process.exit(1);
}

const cli = cac("bepack");

function common(command: any) {
    return command
        .option("--cwd <path>", "Working directory")
        .option("--config <path>", "Config path")
        .option("--json", "JSON output")
        .option("--dry-run", "Do not write files")
        .option("--silent", "Silent output")
        .option("--verbose", "Verbose output");
}

let _verbose = false;

function reportError(command: string, error: unknown, json: boolean) {
    const formatted = formatError(error);
    if (json) {
        writeJson({ ok: false, command, error: formatted });
    } else if (error instanceof BePackError) {
        console.error(`${colors.red(formatted.code)}: ${formatted.message}`);
        if (formatted.suggestions?.length) {
            for (const s of formatted.suggestions) console.error(`  ${colors.dim("→")} ${s}`);
        }
        if (_verbose && formatted.stack) {
            console.error(`${colors.dim(formatted.stack)}`);
        }
    } else if (error instanceof Error) {
        console.error(`${colors.red("ERROR")}: ${error.message}`);
        if (_verbose && formatted.stack) {
            console.error(`${colors.dim(formatted.stack)}`);
        }
    } else {
        console.error(`${colors.red("ERROR")}: ${String(error)}`);
    }
    process.exitCode = 1;
}

async function run(name: string, action: (options: any) => Promise<unknown>, options: any) {
    _verbose = Boolean(options.verbose);
    try {
        const result = await action(options);
        if (options.json) writeJson(result);
    } catch (error) {
        reportError(name, error, Boolean(options.json));
    }
}

common(cli.command("init", "Create BePack project"))
    .option("--format <format>", "ts/js/mjs")
    .option("--yes", "Use defaults")
    .option("--force", "Overwrite generated files")
    .option("--from-bp <path>", "Reverse-engineer config from existing BP manifest.json")
    .option("--from-rp <path>", "Reverse-engineer config from existing RP manifest.json")
    .action((options: any) => run("init", commandInit, options));
common(cli.command("install", "Sync dependencies"))
    .option("--target <target>", "Target MC version")
    .option("--registry <url>", "npm registry")
    .option("--pm <pm>", "Package manager")
    .option("--skip-pm", "Do not run package manager")
    .option("--skip-manifest", "Do not patch manifest")
    .option("--skip-package-json", "Do not patch package.json")
    .option("--save-to <field>", "dependencies/devDependencies")
    .action((options: any) => run("install", commandInstall, options));
common(cli.command("manifest", "Patch manifest files"))
    .option("--target <target>", "Target MC version")
    .action((options: any) => run("manifest", commandManifest, options));
common(cli.command("build", "Build project"))
    .alias("b")
    .option("--mode <value>", "Execution mode (passed to hooks)")
    .option("--target <target>", "Target MC version")
    .option("--install", "Run install")
    .option("--skip-install", "Skip install")
    .option("--copy", "Copy after build")
    .option("--copy-target <target>", "Copy target")
    .option("--skip-copy", "Skip copy")
    .option("--pack", "Pack after build")
    .option("--skip-pack", "Skip pack")
    .option("--typecheck", "Run typecheck")
    .option("--skip-typecheck", "Skip typecheck")
    .option("--preserve-modules", "Preserve module output")
    .option("--use-npx", "Use npx tsc for typecheck")
    .option("--minify", "Minify output")
    .option("--cache", "Enable incremental compilation cache (--no-cache to disable)")
    .option("--timing", "Show per-step timing")
    .action((options: any) => run("build", commandBuild, options));
common(cli.command("copy", "Copy packs"))
    .option("--target <target>", "Copy target")
    .option("--all", "Copy to all targets")
    .action((options: any) => run("copy", commandCopy, options));
common(cli.command("pack", "Pack mcpack/mcaddon"))
    .option("--name <name>", "Output name")
    .action((options: any) => run("pack", commandPack, options));
common(cli.command("dev", "Watch project"))
    .option("--mode <value>", "Execution mode (passed to hooks)")
    .option("--copy", "Copy on change")
    .option("--copy-target <target>", "Copy target")
    .option("--skip-copy", "Skip copy")
    .option("--typecheck", "Run typecheck")
    .option("--skip-typecheck", "Skip typecheck")
    .option("--timing", "Show per-step timing")
    .action((options: any) => run("dev", commandDev, options));
common(cli.command("config", "Show resolved config"))
    .option("--summary", "Show brief summary instead of full config")
    .action((options: any) => run("config", commandConfig, options));

cli.help();
cli.version(pkgVersion);

export async function runCLI(argv: string[]): Promise<void> {
    // Reset parse state so stale matchedCommand from a prior call doesn't leak.
    // cli.parse() only sets matchedCommand when a command matches; without a
    // reset, running tests sequentially inherits the previous match.
    cli.unsetMatchedCommand();
    cli.parse(argv, { run: false });

    // `--help` / `-h` — already output by CAC during parse
    if (cli.options.help) {
        return;
    }

    // `--version` / `-v` — already output by CAC during parse
    if (cli.options.version) {
        return;
    }

    // No command matched at all
    if (!cli.matchedCommand) {
        // User typed a positional arg that isn't a registered command.
        // When an option like --json is unknown at the global level, mri
        // consumes the next token as its value, so cli.args may be empty.
        // Fall back to raw argv to find non-option tokens.
        const unknown =
            cli.args[0] ??
            cli.rawArgs.slice(2).find((a) => a !== "--" && !a.startsWith("-"));
        if (unknown) {
            reportError(
                "cli",
                new BePackError(
                    "UNKNOWN_COMMAND",
                    `Unknown command: ${unknown}`,
                    {
                        suggestions: [
                            "Run `bepack --help` to see available commands.",
                        ],
                    }
                ),
                Boolean(cli.options.json)
            );
            return;
        }
        // No args — show help
        cli.outputHelp();
        return;
    }

    // Run the matched command's action (errors are caught by `run()` internally,
    // but CAC's own validation — unknown options, missing args — throws here).
    try {
        await cli.runMatchedCommand();
    } catch (error) {
        reportError("cli", error, Boolean(cli.options.json));
    }
}
