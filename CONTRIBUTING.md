# Releasing BePack

This document describes how to cut a release of BePack: publish to npm and create the matching GitHub Release.

It is written for maintainers. For user-facing usage, read the [README](./README.md) or the [reference guide](./reference.md).

## What ships

BePack publishes **two** npm packages from this repository:

| Package | Directory | Purpose |
| ------- | --------- | ------- |
| `@bepack/cli` | root | The `bepack` CLI and the public library entry (`src/index.ts`). |
| `create-mcbe` | `packages/create-mcbe` | The `npm create mcbe` project scaffolder. |

Both are published as public packages and share a version number. Their versions must stay in sync.

## Prerequisites

- Push access to `github.com/XiaoYangx666/BEPack`.
- npm publish rights on the `@bepack` scope (verify with `npm whoami`).
- A clean working tree on `master`, with `master` pushed.
- `gh` authenticated (`gh auth status`) — the release workflow uses it.

## Version numbers

BePack uses prerelease versions while it is pre-1.0. The version in `package.json` is the single source of truth; keep these in sync when bumping:

1. `package.json` (`@bepack/cli`)
2. `packages/create-mcbe/package.json`
3. The three templates under `packages/create-mcbe/templates/*/package.json`, which depend on `@bepack/cli` — update their range to the new version
4. `package-lock.json` (regenerate with `npm install`, do not hand-edit)

## Release steps

### 1. Verify the build is green

Every release must pass all three checks before tagging. Commit or discard any local changes first.

```bash
npm run check
npm run test
npm run build
```

`npm run check` is `tsc --noEmit`; `npm run test` is `vitest run`. Type checking is on by default for user projects too, so a broken typecheck here means a broken release.

### 2. Bump the version

Update the four locations listed above, then commit:

```bash
git add -A
git commit -m "chore: 版本号提升到 <version>"
```

### 3. Publish to npm

Root package — it has **no** `prepublishOnly` hook, so build it explicitly first:

```bash
npm run build
npm publish --access public --tag beta
```

`create-mcbe` package — its `prepublishOnly` runs `typecheck && test && build` on its own:

```bash
npm publish --workspace=create-mcbe --access public --tag beta
```

**Always pass `--tag beta` for prerelease versions.** A version containing a hyphen (`0.1.0-beta.2`) would otherwise become the `latest` dist-tag, so plain `npm install @bepack/cli` would resolve to a beta. With `--tag beta`:

- `npm install @bepack/cli` keeps resolving to the newest **stable** release
- `npm install @bepack/cli@beta` gets the new beta

For a stable release (no hyphen in the version), omit `--tag` so `latest` advances.

Verify what landed:

```bash
npm view @bepack/cli dist-tags
npm view create-mcbe dist-tags
```

### 4. Tag and push

Pushing a `v*` tag triggers the `Release` workflow (`.github/workflows/release.yml`), which creates the GitHub Release from the tag.

```bash
git push github master
git tag -a v0.1.0-beta.2 -m "v0.1.0-beta.2"
git push github v0.1.0-beta.2
```

`github` is the GitHub remote; `gitee` is a mirror. Pushing the tag to `gitee` does **not** create a GitHub Release.

### 5. Verify the Release

```bash
gh run list --repo XiaoYangx666/BEPack --limit 3
gh release view v0.1.0-beta.2 --repo XiaoYangx666/BEPack
```

The workflow only runs `gh release create --generate-notes`, which does **not** set the prerelease flag. For any version containing a hyphen, mark it manually:

```bash
gh release edit v0.1.0-beta.2 --repo XiaoYangx666/BEPack --prerelease
```

The workflow is intentionally minimal — it creates the Release but does not publish to npm. npm publishing stays a manual, explicit step so a mistyped tag cannot ship a package.

## Verify a published package

```bash
npm view @bepack/cli version
npm view @bepack/cli versions --json
```

Install it in a scratch directory and run the CLI to confirm the tarball is complete (the release ships `dist/`, so a missing build step produces an empty package):

```bash
npm install -g @bepack/cli@beta
bepack --help
```

## Troubleshooting

| Symptom | Cause and fix |
| ------- | ------------- |
| `gh release create` fails with "not a git repository" | The workflow needs `actions/checkout` before running `gh`. It is already present; do not remove it. |
| Release was created as a stable release | `--generate-notes` does not infer prerelease. Run `gh release edit <tag> --prerelease`. |
| `npm publish` rejects with 403 | The version already exists, or you lack publish rights. Bump the version; npm never allows republishing a version. |
| `latest` dist-tag points at a beta | You published without `--tag beta`. Fix with `npm dist-tag add @bepack/cli@<last-stable> latest`. |
| Published package is missing `dist/` | The root package has no `prepublishOnly` hook, so `npm publish` runs without building. Run `npm run build` first. |

## Related documentation

- [`AGENTS.md`](./AGENTS.md) — architecture and contributor guardrails.
- [`reference.md`](./reference.md) — full configuration reference.
