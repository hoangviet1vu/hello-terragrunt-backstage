# Design Document

## Overview

Rename the top-level `examples/` directory to `templates/` and update every path reference in a
targeted, mechanical way. The change is limited to (a) a history-preserving directory move and
(b) string updates in config, build, and documentation files. No application code, catalog
entity identities, or upstream references are altered.

## Architecture

There is no architectural change. The affected surface is:

```
examples/                      ->  templates/
├── entities.yaml                  ├── entities.yaml
├── org.yaml                       ├── org.yaml
└── template/                      └── template/
    ├── template.yaml                  ├── template.yaml
    └── content/...                    └── content/...
```

Path references flow one direction: config/build/docs files point at the folder. Renaming the
folder therefore requires updating each referencing file, but nothing in the folder needs to
change.

## Components and Interfaces

### 1. Directory move
- Use `git mv examples templates` so Git records renames and preserves history/blame.

### 2. Catalog configuration (`app-config.yaml`, `app-config.production.yaml`)
- These use different relative bases:
  - `app-config.yaml` resolves relative to the backend process (`packages/backend`), so it uses
    `../../templates/...`.
  - `app-config.production.yaml` resolves relative to the deployed root (container), so it uses
    `./templates/...`.
- Only the three `catalog.locations` file targets change in each file.

### 3. Backend image (`packages/backend/Dockerfile`)
- Update the `COPY --chown=node:node examples ./examples` line to `templates ./templates` and the
  adjacent explanatory comment.

### 4. Documentation (`README.md`, `AGENTS.md`)
- Update folder-path references only: the README structure tree and quick-start link, and the
  three AGENTS.md path mentions.

## Data Models

Not applicable — no data model changes.

## Error Handling

- Each string replacement is asserted to exist before being applied; a missing expected string
  aborts the edit so a silent no-op cannot occur.
- Post-change, a repo-wide search for `examples` confirms only intended residual references
  remain (catalog identifiers and upstream URLs).

## Decisions and Rationale

- **Preserve `name: examples` / `system: examples` in `entities.yaml`.** These are entity and
  system identifiers, not paths. Renaming them would change the demo System's identity and break
  the `system: examples` links between the demo entities — out of scope for a folder rename.
- **Preserve upstream `examples/` URLs in `app-config.yaml` comments.** They reference the
  Backstage project's own repository layout and are unrelated to this repo's folder.
- **Use `git mv` rather than delete/recreate.** Keeps history and blame intact.

## Testing Strategy

- `git status --short` shows all moved files as renames (R), not delete/add pairs.
- A `grep` for `examples` returns only the intentional residuals (entity/system names and
  upstream URLs).
- Optional runtime check: `yarn start` and confirm the backend loads catalog locations from
  `templates/` without errors. Not required for a path/doc-only change.

## Correctness Properties

### Property 1: Path integrity
Every referenced catalog location resolves to an existing file under `templates/` after the
rename; no active config, build, or doc file contains a dangling `examples/` path.

**Validates: Requirements 2.1, 2.2, 3.1, 4.1, 4.2**

### Property 2: Identity invariance
Catalog entity/system identifiers (`name: examples`, `system: examples`) are unchanged, and the
demo entity descriptors are identical in content to before the rename.

**Validates: Requirements 1.2, 5.1**

### Property 3: External-reference invariance
Commented-out upstream Backstage `examples/` URLs in `app-config.yaml` remain unchanged.

**Validates: Requirements 5.2**

### Property 4: History preservation
All moved files are tracked by Git as renames rather than delete/add pairs.

**Validates: Requirements 1.1, 1.3**

### Property 5: Behavioral invariance
No runtime behavior changes except the on-disk location of the demo catalog data.

**Validates: Requirements 5.3**
