import { describe, expect, it } from 'vitest';
import { parseCliOptions } from '../src/parseCliOptions.js';

describe('parseCliOptions', () => {
  it('parses template and project name', () => {
    const cli = parseCliOptions(['demo', '--template', 'bepack-behavior', '--pm', 'pnpm', '--yes']);
    expect(cli.projectName).toBe('demo');
    expect(cli.template).toBe('bepack-behavior');
    expect(cli.packageManager).toBe('pnpm');
    expect(cli.yes).toBe(true);
  });

  it('rejects unknown package managers', () => {
    expect(() => parseCliOptions(['demo', '--pm', 'bad'])).toThrow('Unknown package manager');
  });
});
