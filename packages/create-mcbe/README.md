# create-mcbe

An extensible Minecraft Bedrock project scaffold generator for both interactive users and coding agents.

## One-command setup for agents

Create an SAPI-Pro behavior-pack project, install its npm dependencies, install BePack locally, and resolve Script API dependencies:

```bash
npm create mcbe@latest my-addon -- --template sapi-pro --yes --install
```

Then build the project:

```bash
cd my-addon && npm run build
```

To use a globally installed BePack instead of installing it in the project:

```bash
npm create mcbe@latest my-addon -- --template sapi-pro --skip-bepack-install --yes
```

Then run:

```bash
cd my-addon && bepack install && npm run build
```

Use `--json` when an agent needs machine-readable output:

```bash
npm create mcbe@latest my-addon -- --template bepack-addon --yes --install --json
```

## Templates

| Template | Description |
| --- | --- |
| `sapi-pro` | SAPI-Pro behavior pack with the built-in `sapi-pro` BePack plugin |
| `bepack-behavior` | TypeScript behavior pack managed by BePack |
| `bepack-addon` | TypeScript behavior pack and resource pack managed by BePack |
| `behavior-pack` | Data-only behavior pack without scripts or build tools |
| `resource-pack` | Data-only resource pack without scripts or build tools |

List available templates:

```bash
npm create mcbe@latest -- --list-templates
```

## Common options

- `--template <id>`: Select a template.
- `--yes`: Use defaults and disable prompts; recommended for agents.
- `--install`: Install project dependencies after creation. For BePack templates, also run the BePack install script.
- If a template declares `skills`, `--install` also installs each source into the generated project with `npx skills add`.
- `--skip-skills-install`: Do not install skills declared by the template. This only skips skills; npm and BePack installation still run when `--install` is used.
- `--install-bepack`: Install BePack in the generated project.
- `--skip-bepack-install`: Do not install BePack locally; use the global `bepack` command.
- `--pm <npm|pnpm|yarn|bun>`: Select the package manager.
- `--git`: Initialize a Git repository.
- `--json`: Print machine-readable JSON output.
- `--cwd <path>`: Set the directory where the project is created.
- `--force`: Allow overwriting a non-empty target directory.

## Interactive mode

Run without arguments to choose the project name, template, and BePack installation mode interactively:

```bash
npm create mcbe
```

## Development

Run these commands from the BePack monorepo root:

```bash
npm run build:create-mcbe
npm run check:create-mcbe
npm run test:create-mcbe
```

To add a template, create a directory under `templates/` and register its definition in `src/templates/index.ts`.

Template authors can opt into skills by adding a URL (or URLs) to the template definition:

```ts
skills: 'https://github.com/example/agent-skills'
// or: skills: ['https://github.com/example/skills-a', 'https://github.com/example/skills-b']
```
