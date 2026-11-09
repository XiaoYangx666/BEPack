# @bepack/addon

Isomorphic `.mcaddon` / `.mcpack` archive and manifest utilities for BePack projects.

This package is **not** a compiler and does not run Rolldown or TypeScript. It handles the
part every web generator repeats:

```txt
read template archive -> edit manifest identity -> replace generated files -> write archive
```

It works in browsers, Node.js 20+, Bun, and workers. The only runtime dependency is `fflate`.

| Entry                | Runtime            | Contents                                                      |
| -------------------- | ------------------ | ------------------------------------------------------------- |
| `@bepack/addon`      | browser, Node, Bun | archive writing, `AddonTemplate`, `ManifestEditor`            |
| `@bepack/addon/core` | any                | manifest, pack, UUID, and validation primitives (no `fflate`) |
| `@bepack/addon/node` | Node 20+           | `readAddonFile` / `writeAddonFile` file-system helpers        |

> **Status: 0.1.0-beta.** The API is usable but may change before 1.0. The package is validated
> against Pianobe's format 3 template and BedrockBeats' format 2 addon, including generation,
> timbre merging, and round-trip parsing under both Node.js and Bun.

## Install

```bash
npm install @bepack/addon
```

## Browser / generator usage

```ts
import { readAddon, sourceFromBlob, type AddonEntry } from "@bepack/addon";

const addon = await readAddon(templateBlob);

// Read the current pack identity. Versions are read according to format_version.
const identity = addon.identity();

// Rename the addon, bump the version, and give it fresh UUIDs.
const { uuidMap } = addon.updateIdentity({
    name: "My Generated Pack",
    description: "Built in the browser",
    version: [1, 2, 0],
    randomizeUuids: true,
    resourceName: "My Generated Pack (RP)", // optional per-pack override
});

// Replace generated folders without touching the rest of the template.
const files: AddonEntry[] = [
    { path: "bp/scripts/data/library.js", bytes: generatedLibrary },
    sourceFromBlob("rp/sounds/large.ogg", audioBlob),
];

addon.replace({
    exactPaths: ["rp/sounds/sound_definitions.json"],
    prefixes: ["bp/scripts/data/", "rp/sounds/music/"],
    files,
});

// uuidMap can be used to patch generated script text:
// old header UUID -> new header UUID
const blob = await addon.toBlob({
    signal,
    onProgress(processed, total) {
        console.log(`${processed}/${total}`);
    },
});
```

`writeAddonBytes`, `writeAddonBlob`, and `addon.toSink()` avoid creating a Blob when the host
writes straight to a file or HTTP response.

## Node / Bun backend usage

```ts
import { readAddonFile, writeAddonFile } from "@bepack/addon/node";

const addon = await readAddonFile("template.mcaddon");
addon.updateIdentity({ name: "Generated", version: [2, 0, 0] });

// Atomic write, parent directories created, progress and AbortSignal supported.
const { bytes } = await writeAddonFile("out.mcaddon", addon, {
    onProgress(processed, total) {
        console.log(`${processed}/${total}`);
    },
});
```

The adapters stream archive chunks straight to the file descriptor, so large
templates do not become a `Blob`. Write to a custom destination with the
lower-level sink API:

```ts
import { readAddon, writeAddonTo, sourceFromBlob } from "@bepack/addon";

const addon = await readAddon(templateBytes);
addon.replace({
    prefixes: ["bp/scripts/music/"],
    files: [sourceFromBlob("rp/sounds/track.ogg", await Bun.file(audioPath).blob())],
});

await writeAddonTo(addon, {
    write(chunk) {
        sink.write(chunk);
    },
    async end() {
        await sink.end();
    },
});
```

The sink's `write` must be synchronous. Use the host's buffered writer (`Bun.file().writer()`,
a Node `Writable`, etc.) when the destination is asynchronous.

## API

### Reading

- `readAddon(input: Uint8Array | Blob, options?)` -> `AddonTemplate`
- `readAddonArchive(bytes, options?)` -> `AddonFileData[]`
- `AddonTemplate.read(input, options?)`

`readAddon` discovers behavior/resource packs by `modules[].type` (`script` / `resources`).
Data-only packs fall back to folder names (`bp`, `behavior_pack`, `rp`, `resource_pack`). Use
`bpRoot` / `rpRoot` when the template uses unusual folder names.

### Identity

- `addon.identity()` / `readIdentity(packs)`
- `addon.updateIdentity(options, { indent? })` / `applyIdentity(packs, options)`
- `readPackIdentity(pack)`

`updateIdentity` updates `header.name`, `header.description`, `header.version`, header/module
UUIDs, and cross-pack dependency UUIDs. It keeps the manifest's `format_version` representation:
format 2 writes `[major, minor, patch]`, format 3 writes `"major.minor.patch"`.

### Manifest editing

`addon.manifest("bp" | "rp")` returns a `ManifestEditor` bound to that pack:

```ts
addon
    .manifest("bp")
    .setName("My Pack")
    .setVersion([1, 2, 0])
    .setMinEngineVersion([1, 21, 0])
    .addDependency({ module_name: "@minecraft/server", version: "2.0.0" })
    .removeDependency({ module_name: "@minecraft/server-ui" })
    .addModule({ type: "script", uuid, version: [1, 0, 0], entry: "scripts/main.js" })
    .setCapability("pbr")
    .setMetadata("product_type", "addon")
    .validate()
    .save();
```

- `addDependency` upserts by `module_name` or `uuid`; `{ keepExisting: true }` keeps the old entry.
- `removeDependency` / `removeModule` accept a string, a `{ module_name, uuid }`-style object, or a
  predicate, and return the removed count.
- `patch()` applies a structured patch: `header` and `metadata` merge, arrays replace.
- `setFormatVersion(2 | 3)` rewrites every version field; new versions always follow the manifest's
  `format_version` (`module_name` dependencies stay SemVer strings).
- `validate()` uses the same rules as the CLI; `save()` writes back into the archive and the editor
  keeps pointing at the refreshed manifest.
- Unknown header, module, dependency, and top-level fields are preserved.

The same edits exist as pure functions in `@bepack/addon/core` (`patchManifest`, `patchHeader`,
`addDependency`, `removeDependency`, `addModule`, `removeModule`, `setCapability`, `setMetadata`,
`setFormatVersion`, `normalizeDependency`, `normalizeModule`) for hosts that work on manifest JSON
without an archive.

### Files

- `addon.entries()` / `addon.read(path)` / `addon.readText(path)`
- `addon.readSync(path)` / `addon.readTextSync(path)` (fully loaded files only)
- `addon.write(path, bytes)` / `addon.writeText(path, text)`
- `addon.remove(path)` / `addon.removeTree(prefix)`
- `addon.replace({ exactPaths, prefixes, files })`

### Writing

- `addon.toBlob(options?)` / `addon.toBytes(options?)` / `addon.toArchive(options?)`
- `addon.toSink(sink, options?)`
- `writeAddon(addon, options?)`
- `writeAddonTo(addon, sink, options?)`

Writing is chunked (256 KiB by default), reports progress, supports `AbortSignal`, and stores
already-compressed files (`.ogg`, `.png`, `.zip`, ...) without deflating them again.

### Core-only usage

Build tools that only need the stable primitives can import the lighter entry:

```ts
import { generateUuid, readIdentity, validateManifest, type Manifest } from "@bepack/addon/core";
```

`@bepack/addon/core` does not import `fflate`; only the root entry's archive helpers do.

### Node file helpers

`@bepack/addon/node` is a separate entry, so browser bundles never pull in `node:fs`:

- `readAddonFile(path, options?)` -> `AddonTemplate` (`sourceName` defaults to the file name)
- `readAddonArchiveFile(path, options?)` -> `AddonFileData[]`
- `writeAddonFile(path, addon, options?)` / `writeAddonArchiveFile(path, entries, options?)`

Writes are atomic by default (temporary file + rename), create parent directories, stream chunks
straight to a file descriptor, and resolve to `{ path, bytes }`. `onProgress`, `signal`, `level`,
`storedExtensions`, `mtime`, and the size limits pass through from the archive writer.

## CLI integration

`@bepack/cli` depends on `@bepack/addon/core` for manifest types, `validateManifest`, and
UUID generation. `src/manifest/validate.ts` is a thin adapter that maps `AddonError` to the
CLI's `BePackError("MANIFEST_INVALID")`; the validation rules themselves live here so the CLI
and generators cannot drift apart.

The high-level `AddonTemplate`, `ManifestEditor`, and streaming archive writer are intentionally
not used by the CLI: the CLI builds manifests from configuration and packs an in-memory `FileMap`
with `zipSync`, while generators edit an existing template and stream large generated assets.
`@bepack/addon/node` targets repository scripts and backends, not CLI packaging.

## What stays out of this package

Domain generation belongs to the host project:

- audio/MIDI conversion and preview;
- sound definition or timbre merging;
- project file formats and IndexedDB stores;
- UI, routing, and deployment.

The package also does not perform `__brarchive` optimization. That remains a BePack CLI build
feature.

## Publishing

`npm publish` runs `prepublishOnly` (typecheck + tests) and `prepack` (build), so the published
tarball always contains a fresh `dist/`. `npm pack --dry-run` shows exactly what will be
published (`dist/`, `README.md`, `LICENSE`, `package.json`).

## Errors

All failures are `AddonError` with a stable `code`:

```ts
import { AddonError } from "@bepack/addon";

try {
    await readAddon(bytes);
} catch (error) {
    if (error instanceof AddonError && error.code === "ADDON_MANIFEST_MISSING") {
        // show localized copy
    }
}
```

Messages are English on purpose; generators should map codes to their own user-facing text.
