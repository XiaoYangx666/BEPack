import { BePackError } from "../errors/BePackError.js";

/**
 * 校验并规范化 `packs.bp.compile.define` 的值。
 *
 * 值必须是合法的 JavaScript 表达式字符串（如 `JSON.stringify("server")`、`"true"`）。
 * 这里只做语法检查，绝不执行。
 */
export function normalizeDefine(
    define: Record<string, string> | undefined
): Record<string, string> {
    const values = { ...(define ?? {}) };
    for (const [name, value] of Object.entries(values)) {
        try {
            new Function(`return (${value});`); // syntax check only — never executed
        } catch {
            throw new BePackError(
                "CONFIG_INVALID",
                `packs.bp.compile.define["${name}"] is not a valid JavaScript expression: ${value}. ` +
                    'Define values must be expression strings, e.g. JSON.stringify("server") or "true".',
                { details: { defineKey: name, defineValue: value } }
            );
        }
    }
    return values;
}

/** Rolldown 顶层 `transform.define` 选项。未配置时返回 undefined，调用方跳过。 */
export function createDefineTransform(
    define: Record<string, string>
): { transform: { define: Record<string, string> } } | undefined {
    return Object.keys(define).length > 0 ? { transform: { define } } : undefined;
}
