import { pathToFileURL } from "node:url";
import path from "node:path";
import { promises as fs } from "node:fs";
import { CONFIG_FILES } from "../constants/paths.js";
import { BePackError } from "../errors/BePackError.js";
import type { ConfigContext, LoadConfigOptions, UserConfig } from "./configTypes.js";
import { normalizeConfig } from "./normalizeConfig.js";
import { resolveFrom } from "../utils/path.js";

async function findConfig(cwd: string, configPath?: string): Promise<string> {
    if (configPath) {
        const resolved = resolveFrom(cwd, configPath);
        await fs.access(resolved).catch(() => {
            throw new BePackError("CONFIG_NOT_FOUND", `Config not found: ${configPath}`, {
                details: { configPath },
            });
        });
        return resolved;
    }
    for (const file of CONFIG_FILES) {
        const candidate = path.join(cwd, file);
        try {
            await fs.access(candidate);
            return candidate;
        } catch {
            // continue
        }
    }
    throw new BePackError(
        "CONFIG_NOT_FOUND",
        "No bepack.config.ts, bepack.config.mjs, or bepack.config.js found.",
        { details: { cwd } }
    );
}

async function importConfig(file: string): Promise<unknown> {
    try {
        if (file.endsWith(".ts")) {
            try {
                return await import(`${pathToFileURL(file).href}?t=${Date.now()}`);
            } catch {
                const source = await fs.readFile(file, "utf8");
                const jsLikeSource = stripConfigTypeSyntax(source);
                const dataUrl = `data:text/javascript;base64,${Buffer.from(jsLikeSource, "utf8").toString("base64")}`;
                return await import(dataUrl);
            }
        }
        return await import(`${pathToFileURL(file).href}?t=${Date.now()}`);
    } catch (cause) {
        throw new BePackError(
            "CONFIG_INVALID",
            `Failed to load config: ${cause instanceof Error ? cause.message : String(cause)}`,
            {
                details: { file },
                suggestions: [
                    "Use bepack.config.mjs/js for complex config logic.",
                    "Keep bepack.config.ts free of TypeScript-only runtime syntax.",
                ],
            }
        );
    }
}

function stripConfigTypeSyntax(source: string): string {
    return source
        .replace(/^\s*import\s+type\s+[^;]+;\s*$/gm, "")
        .replace(/\s+satisfies\s+[A-Za-z_$][\w$<>,\s.[\]|&{}]*/g, "")
        .replace(/\((\s*[A-Za-z_$][\w$]*)\s*:\s*[^)=]+?\)\s*=>/g, "($1) =>");
}

export async function loadConfig(options: LoadConfigOptions) {
    const cwd = path.resolve(options.cwd);
    const file = await findConfig(cwd, options.configPath);
    const mod = (await importConfig(file)) as {
        default?: UserConfig | ((ctx: ConfigContext) => UserConfig | Promise<UserConfig>);
    };
    if (mod.default === undefined) {
        throw new BePackError("CONFIG_INVALID", "Config must use default export.", {
            details: { file },
        });
    }
    const ctx: ConfigContext = {
        command: options.command,
        cwd,
        platform: process.platform,
        env: process.env,
        ...(options.mode === undefined ? {} : { mode: options.mode }),
    };
    const raw = typeof mod.default === "function" ? await mod.default(ctx) : mod.default;
    return { config: normalizeConfig(raw, options.overrides), path: file, cwd };
}
