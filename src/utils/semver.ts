import { BePackError } from "../errors/BePackError.js";

export function parseVersionTuple(version: string): [number, number, number] {
    const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
    if (!match) {
        throw new BePackError("VERSION_INVALID", "Manifest version requires x.y.z.", { details: { version } });
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
    return value === "stable" || (isSpecificVersion(value) && !/(?:^|[-.])(beta|alpha|preview|rc)(?:[-.]|$)/i.test(value));
}
