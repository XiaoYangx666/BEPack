import crypto from 'node:crypto';

export function toPackageName(input: string): string {
  return input
    .trim()
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/\s+/g, '-')
    .replace(/_/g, '-')
    .toLowerCase()
    .replace(/[^a-z0-9@/.-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'mcbe-addon';
}

export function toTitle(input: string): string {
  return input
    .trim()
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase()) || 'MCBE Addon';
}

/** Derive a unique Minecraft namespace (snake_case) with a random suffix. */
export function toNamespace(input: string): string {
  const trimmed = input.trim();
  const base =
    trimmed
      .toLowerCase()
      .replace(/([a-z])([A-Z])/g, '$1_$2')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || `mcbe_${namespaceHash(trimmed)}`;
  const safeBase = /^[a-z]/.test(base) ? base : `mcbe_${base}`;
  return `${safeBase}_${crypto.randomBytes(3).toString('hex')}`;
}

/** Stable short hash so non-ASCII project names still get a distinct base. */
function namespaceHash(input: string): string {
  return crypto.createHash('sha1').update(input, 'utf8').digest('hex').slice(0, 8);
}
