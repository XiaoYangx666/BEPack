import { BePackError } from "../errors/BePackError.js";

export function parseVersionTuple(version: string): [number, number, number] {
    const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
    if (!match) {
        throw new BePackError("VERSION_INVALID", "Manifest version requires x.y.z.", {
            details: { version },
        });
    }
    return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function isSpecificVersion(value: string): boolean {
    return /^\d+\.\d+\.\d+(?:[-.][0-9A-Za-z.-]+)?$/.test(value);
}

export function compareLooseSemver(a: string, b: string): number {
    const pa = a.split(/[^0-9A-Za-z]+/);
    const pb = b.split(/[^0-9A-Za-z]+/);
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i += 1) {
        const av = pa[i] ?? "";
        const bv = pb[i] ?? "";
        const an = /^\d+$/.test(av) ? Number(av) : Number.NaN;
        const bn = /^\d+$/.test(bv) ? Number(bv) : Number.NaN;
        const cmp = Number.isNaN(an) || Number.isNaN(bn) ? av.localeCompare(bv) : an - bn;
        if (cmp !== 0) return cmp;
    }
    return 0;
}

export function targetSupportsChannelDependency(target: string): boolean {
    if (target === "latest") return true;
    return compareLooseSemver(target, "1.21.120") >= 0;
}

export function isStableApiSpecifier(value: string): boolean {
    return (
        value === "stable" ||
        (isSpecificVersion(value) && !/(?:^|[-.])(beta|alpha|preview|rc)(?:[-.]|$)/i.test(value))
    );
}

type ParsedCompatibilityVersion = {
    major: number;
    minor: number;
    patch: number;
    minecraftTarget?: [number, number, number];
};

function parseCompatibilityVersion(version: string): ParsedCompatibilityVersion | undefined {
    const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(
        version.trim()
    );
    if (!match) return undefined;
    const target = /(?:^|[.-])(\d+)\.(\d+)\.(\d+)(?:[.-]|$)/.exec(match[4] ?? "");
    return {
        major: Number(match[1]),
        minor: Number(match[2]),
        patch: Number(match[3]),
        ...(target
            ? {
                  minecraftTarget: [
                      Number(target[1]),
                      Number(target[2]),
                      Number(target[3]),
                  ] as const,
              }
            : {}),
    };
}

function compareApiCore(a: ParsedCompatibilityVersion, b: ParsedCompatibilityVersion): number {
    for (const key of ["major", "minor", "patch"] as const) {
        if (a[key] !== b[key]) return a[key] - b[key];
    }
    return 0;
}

/**
 * Checks Minecraft Script API compatibility, intentionally differing from
 * standard npm semver. The actual version must have the same major and an API
 * core version no lower than the requirement. When the requirement contains a
 * Minecraft target inside a beta/preview suffix, the actual target must be no
 * lower as well (for example, `1.26.33-beta` satisfies `1.26.30-beta`).
 *
 * `requirement` may have a common npm range prefix such as `^` or `>=`; the
 * prefix is accepted for peer-dependency ergonomics but does not impose npm's
 * usual upper bound.
 */
export function satisfiesSemver(version: string, requirement: string): boolean {
    const actual = parseCompatibilityVersion(version);
    if (!actual) return false;
    return requirement.split("||").some((alternative) => {
        const match = /(?:\^|~|>=|<=|>|<|=)?\s*(v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/.exec(
            alternative.trim()
        );
        const required = match ? parseCompatibilityVersion(match[1]!) : undefined;
        if (!required || actual.major !== required.major || compareApiCore(actual, required) < 0) {
            return false;
        }
        if (!required.minecraftTarget) return true;
        if (!actual.minecraftTarget) return false;
        return (
            compareLooseSemver(
                actual.minecraftTarget.join("."),
                required.minecraftTarget.join(".")
            ) >= 0
        );
    });
}

/** @deprecated Use satisfiesSemver; retained for plugins using the earlier name. */
export const satisfiesSemverRange = satisfiesSemver;
