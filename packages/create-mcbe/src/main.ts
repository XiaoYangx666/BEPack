import * as p from '@clack/prompts';
import { bold, cyan, dim, green, red } from 'kolorist';
import { createRequire } from 'node:module';
import { createProject } from './createProject.js';
import { parseCliOptions } from './parseCliOptions.js';
import { templates } from './templates/index.js';
import type { CliOptions, CreateResult } from './types.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };

export async function main(argv = process.argv.slice(2)): Promise<void> {
  let cli: CliOptions | undefined;
  try {
    cli = parseCliOptions(argv);
    if (cli.help) return console.log(helpText());
    if (cli.version) return console.log(pkg.version);
    if (cli.listTemplates) return console.log(templates.map((t) => `${cyan(t.id.padEnd(18))} ${t.description}`).join('\n'));
    const result = await createProject(cli);
    if (cli.json) return console.log(JSON.stringify({ ok: true, result }, null, 2));
    printResult(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const cancelled = p.isCancel(error);
    if (cli?.json || argv.includes('--json')) console.log(JSON.stringify({ ok: false, error: cancelled ? 'cancelled' : message }, null, 2));
    else if (cancelled) p.cancel('Cancelled.');
    else console.error(red(`Error: ${message}`));
    process.exitCode = 1;
  }
}

function printResult(result: CreateResult): void {
  p.outro(`${green('Created')} ${bold(result.projectName)}`);
  console.log(dim(`\nTemplate: ${result.template}`));
  console.log('\nNext steps:');
  for (const step of result.nextSteps) console.log(`  ${step}`);
}

function helpText(): string {
  const text = [
    `${bold('create-mcbe')} ${dim(`v${pkg.version}`)}`,
    '', 'Usage:', '  npm create mcbe@latest [project-name] -- [options]', '', 'Options:',
    '  --template <id>       Template id', '  --pm <npm|pnpm|yarn|bun>',
    '  --yes                 Use defaults', '  --force               Overwrite a non-empty target directory',
    '  --install             Install dependencies after creation',
    '  --install-bepack      Install BEPack in the project',
    '  --skip-bepack-install Use global BEPack instead',
    '  --git                 Initialize git', '  --cwd <dir>           Working directory',
    '  --json                Machine-readable output', '  --list-templates      List templates',
    '  -h, --help            Show help', '  -v, --version         Show version', '', 'Templates:',
    ...templates.map((t) => `  ${t.id.padEnd(18)} ${t.description}`),
  ];
  return `\n${text.join('\n')}\n`;
}
