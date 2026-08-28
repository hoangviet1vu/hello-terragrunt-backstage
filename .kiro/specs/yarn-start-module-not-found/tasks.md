# Implementation Plan

- [x] 1. Reproduce the bug and confirm the missing-artifact root cause (exploration, BEFORE the fix)
  - **Property 1: Bug Condition** - Frontend build resolves all requested modules
  - **CRITICAL**: This step MUST reproduce the failure on the unfixed install state - the failure confirms the bug exists
  - **DO NOT attempt to fix the code/config while reproducing - only observe and record**
  - **NOTE**: This check encodes the expected behavior - it will validate the fix when it passes after the install repair
  - **GOAL**: Surface counterexamples that demonstrate the bug and tie them to missing PnP artifacts
  - **Scoped approach (deterministic bug)**: This is a deterministic install-state failure, so scope the "property" to the concrete failing specifiers from the design rather than random inputs
  - Confirm the artifact gap: verify `.yarn/cache/` and `.yarn/__virtual__/` are absent while `.pnp.cjs`, `.pnp.loader.mjs`, `yarn.lock`, and `.yarn/install-state.gz` are present (from Bug Condition: `resolverBackingArtifactMissing`)
  - Run the frontend build non-blocking to capture output: `yarn workspace app build` (or `backstage-cli package build` in `packages/app`) - use a one-shot build, NOT the long-running `yarn start` dev server (per AGENTS.md)
  - Confirm the CLI virtual entrypoints fail: `__backstage-autodetected-plugins__` and `__backstage-module-federation-runtime-shared-dependencies__` report "Module not found"
  - Confirm the `@backstage/plugin-app` virtual-package deps fail: `@backstage/config`, `@backstage/core-app-api`, `i18next`, `prop-types`, `lodash/mapValues`, `use-sync-external-store/shim`
  - Confirm the `material-ui-popup-state` transitives fail: `@mui/material/Popover` and `@mui/material/version`, and the build ends with "compiled with 26 errors"
  - **EXPECTED OUTCOME**: Build FAILS with module-resolution errors whose paths reference `.yarn/__virtual__/...` and Berry cache zips (this is correct - it proves the bug exists)
  - Document the counterexamples found (the 26 failing specifiers) to confirm the missing `cache/` + `__virtual__/` root cause; if failures do NOT trace to missing artifacts, treat the primary hypothesis as refuted and re-hypothesize before proceeding
  - Mark task complete when the failure is reproduced, tied to missing artifacts, and documented
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

- [x] 2. Capture the preservation baseline on the UNFIXED state (BEFORE the fix)
  - **Property 2: Preservation** - Toolchain and dependency contract unchanged
  - **IMPORTANT**: Follow observation-first methodology - record the current contract so it can be diffed after the install
  - Observe and record `packageManager` in the root `package.json` (expected `yarn@4.13.0`) and confirm no `nodeLinker` override exists in `.yarnrc.yml`
  - Observe and record `.yarnrc.yml` `packageExtensions` (including the `@backstage/backend-plugin-api` migration-resolution extension, the `@backstage/plugin-permission-react` peer, and the `@backstage/cli-module-test-jest` jest deps) and the root `resolutions` (`@types/react`, `@types/react-dom`)
  - Observe and record the declared dependency versions in every workspace `package.json` (notably `packages/app/package.json`)
  - Capture a clean baseline for diffing: ensure the working tree is committed or snapshot `git status`/`git stash` state so a post-install `git diff` is meaningful, especially under `packages/app/src`
  - Write these observed values down (from Preservation Requirements in design) as the baseline to assert against after the fix
  - **EXPECTED OUTCOME**: Baseline captured; these values represent the contract that MUST remain unchanged
  - Mark task complete when the toolchain, config, dependency-version, and source-tree baseline are recorded
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [ ] 3. Fix for incomplete/stale Yarn PnP install state (missing `.yarn/cache/` and `.yarn/__virtual__/`)

  - [x] 3.1 Run a clean, complete `yarn install` to regenerate the PnP install state
    - Run `yarn install` from the repo root (`/home/vvu/WS/projects/terragrunt/hello-terragrunt-backstage`) with Yarn v4 to regenerate `.yarn/cache/` zips, the `.yarn/__virtual__/` tree, and refresh `.pnp.cjs`/`.pnp.loader.mjs`/`.yarn/install-state.gz` to match `yarn.lock`
    - Do NOT pass `--immutable` (the state must be rebuilt); do NOT edit any `package.json` or `.yarn/` contents by hand (per AGENTS.md - use standard Yarn workflow, no hand edits)
    - Do NOT add, remove, or bump any dependency - the install must satisfy the existing lockfile, not resolve to new versions
    - If the environment blocks network access, note that the Berry cache must be provided out-of-band and stop for user input rather than changing config
    - After install, verify PnP artifacts materialized: `.yarn/cache/` is populated and `.yarn/__virtual__/` exists (specifically the `@backstage/plugin-app` virtual folder referenced in the error paths)
    - _Bug_Condition: isBugCondition(input) where resolverBackingArtifactMissing(input) is true (cache zip or `__virtual__` entry absent) from design_
    - _Expected_Behavior: expectedBehavior(result) — every requested module resolves and the frontend compiles with 0 module-resolution errors, from design_
    - _Preservation: Preservation Requirements from design (Yarn v4, PnP linker, resolutions, packageExtensions, dependency versions, source, backend startup)_
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [x] 3.2 Verify the bug reproduction from task 1 now resolves cleanly
    - **Property 1: Expected Behavior** - Frontend build resolves all requested modules
    - **IMPORTANT**: Re-run the SAME frontend build from task 1 - do NOT write a new check
    - Re-run the one-shot frontend build (`yarn workspace app build`) - NOT the long-running `yarn start` dev server (per AGENTS.md); if a full `yarn start` smoke test is wanted, ask the user to run it manually
    - Confirm all previously-failing specifiers now resolve: the two CLI virtual entrypoints, the six `@backstage/plugin-app` virtual-package deps, and the two `material-ui-popup-state` transitives
    - **EXPECTED OUTCOME**: Build PASSES with 0 module-resolution errors (confirms the bug is fixed)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [~] 3.3 Verify the preservation baseline from task 2 is unchanged
    - **Property 2: Preservation** - Toolchain and dependency contract unchanged
    - **IMPORTANT**: Re-check the SAME baseline captured in task 2 - do NOT invent new assertions
    - Assert `packageManager` is still `yarn@4.13.0` and no `nodeLinker` was introduced in `.yarnrc.yml`
    - Assert `.yarnrc.yml` `packageExtensions` (incl. `@backstage/backend-plugin-api`) and root `resolutions` are unchanged after install
    - Assert no `package.json` dependency versions changed and `yarn.lock` was not rewritten to different versions
    - Assert `git diff` shows no changes under `packages/app/src` (only install artifacts under `.yarn/` and `.pnp.*` should differ)
    - **EXPECTED OUTCOME**: All preservation assertions PASS (confirms no regressions to the toolchain/dependency contract or source)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [~] 4. Checkpoint - Ensure the build is clean and nothing regressed
  - Confirm the frontend one-shot build compiles with 0 module-resolution errors (task 3.2) and all preservation assertions hold (task 3.3)
  - Run `yarn tsc` for a broader consistency check against the restored install state
  - As a backend regression guard, confirm the backend has no new module-resolution errors introduced by the fix (a one-shot `yarn workspace backend build` or `yarn tsc`; do NOT launch the long-running dev server)
  - Ask the user to run `yarn start` manually for a final end-to-end smoke test (frontend compiles and the dev server serves the app), since it is a long-running process per AGENTS.md
  - Ensure all checks pass; ask the user if questions arise.
  - _Requirements: 2.5, 3.3_
