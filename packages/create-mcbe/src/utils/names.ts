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
