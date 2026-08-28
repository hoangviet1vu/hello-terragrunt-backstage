# Implementation Plan

## Overview

This plan renames the `examples/` directory to `templates/` and updates all path references
across config, build, and documentation files. Work proceeds from the directory move, through
config and build updates, then documentation, and finishes with a verification pass. All tasks
are complete; this document records the change that was applied.

## Task Dependency Graph

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1"] },
    { "wave": 2, "tasks": ["2.1", "2.2", "3", "4.1", "4.2"] },
    { "wave": 3, "tasks": ["5"] }
  ],
  "dependencies": {
    "1": [],
    "2.1": ["1"],
    "2.2": ["1"],
    "3": ["1"],
    "4.1": ["1"],
    "4.2": ["1"],
    "5": ["1", "2.1", "2.2", "3", "4.1", "4.2"]
  }
}
```

- Task 1 must complete first (the folder must exist at its new path).
- Tasks 2.1, 2.2, 3, 4.1, 4.2 are independent of each other and can run in parallel after 1.
- Task 5 (verification) depends on all preceding tasks.

## Tasks

- [x] 1. Move the directory preserving history
  - Run `git mv examples templates`
  - Confirm `templates/` contains `entities.yaml`, `org.yaml`, and the `template/` subtree
  - _Requirements: 1.1, 1.2, 1.3_

- [x] 2. Update catalog configuration paths
  - [x] 2.1 Update `app-config.yaml` `catalog.locations` targets to `../../templates/...`
    - _Requirements: 2.1_
  - [x] 2.2 Update `app-config.production.yaml` `catalog.locations` targets to `./templates/...`
    - _Requirements: 2.2_

- [x] 3. Update the backend Dockerfile
  - Change the `COPY` line to `COPY --chown=node:node templates ./templates`
  - Update the accompanying comment to reference `templates`
  - _Requirements: 3.1, 3.2_

- [x] 4. Update documentation references
  - [x] 4.1 Update `README.md` structure tree entry and quick-start link to `templates/`
    - _Requirements: 4.1_
  - [x] 4.2 Update `AGENTS.md` folder-path references to `templates/`
    - _Requirements: 4.2_

- [x] 5. Verify scope was preserved and no stray references remain
  - Confirm `templates/entities.yaml` keeps `name: examples` / `system: examples`
  - Confirm upstream `examples/` URLs in `app-config.yaml` comments are untouched
  - Run a repo-wide `grep` for `examples` and confirm only intended residuals remain
  - Confirm `git status` reports moved files as renames (R)
  - _Requirements: 1.3, 5.1, 5.2, 5.3_

## Notes

- `name: examples` / `system: examples` in `entities.yaml` are catalog identifiers, not paths,
  and are intentionally left unchanged.
- Commented-out upstream Backstage `examples/` URLs in `app-config.yaml` are external references
  and are intentionally left unchanged.
- No build/typecheck is strictly required since only paths, config, and docs changed; a
  `yarn start` smoke test is optional.
