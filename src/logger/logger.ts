import pc from "picocolors";

export type LoggerOptions = { silent?: boolean; verbose?: boolean };

const colors = pc.createColors(
    process.env.NO_COLOR === undefined && process.env.FORCE_COLOR !== "0"
);

export class Logger {
    constructor(private readonly options: LoggerOptions = {}) {}
    formatDuration(durationMs: number): string {
        return colors.green(`${(durationMs / 1000).toFixed(2)}s`);
    }
    info(message: string): void {
        if (!this.options.silent) console.log(message);
    }
    warn(message: string): void {
        if (!this.options.silent) console.warn(colors.yellow(message));
    }
    error(message: string): void {
        if (!this.options.silent) console.error(colors.red(message));
    }
    verbose(message: string): void {
        if (!this.options.silent && this.options.verbose) console.log(colors.gray(message));
    }
    clear(): void {
        if (!this.options.silent) console.clear();
    }
    step(
        label: string,
        message: string,
        color: keyof Pick<
            typeof colors,
            "blue" | "cyan" | "green" | "magenta" | "yellow" | "red" | "gray"
        > = "cyan"
    ): void {
        this.info(`${colors[color](label.padEnd(10))} ${message}`);
    }
    progress(label: string, message: string): void {
        this.step(label, message, "blue");
    }
    success(label: string, message: string): void {
        this.step(label, message, "green");
    }
    bepack(command: string, message: string): void {
        this.info(`${colors.green("bepack")} ${colors.bold(command)} ${colors.gray(message)}`);
    }
    manifest(message: string): void {
        this.step("manifest", message, "yellow");
    }
    typescript(message: string): void {
        this.step("TS", message, "blue");
    }
    rolldown(message: string): void {
        this.step("rolldown", message, "magenta");
    }
    install(message: string): void {
        this.step("install", message, "blue");
    }
    copy(message: string): void {
        this.step("copy", message, "cyan");
    }
    pack(message: string): void {
        this.step("pack", message, "magenta");
    }
    hook(name: string, message: string): void {
        this.step("hook", `${name}: ${message}`, "gray");
    }
    done(label: string, message: string): void {
        this.info(`${colors.green("\u221a")} ${colors.green(label)} ${message}`);
    }
}
