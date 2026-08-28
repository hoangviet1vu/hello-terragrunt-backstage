# yarn-start-module-not-found Bugfix Design

## Overview

`yarn start` fails to compile the frontend because the Rspack bundler in `packages/app` cannot resolve 26 modules. The failing paths point at Yarn Berry PnP virtual packages (`.yarn/__virtual__/...`) and Berry cache zips, alongside two Backstage CLI-injected virtual entrypoints (`__backstage-autodetected-plugins__`, `__backstage-module-federation-runtime-shared-dependencies__`).

Repository inspection confirms the install/PnP state is incomplete: the project uses Yarn v4 PnP (`.pnp.cjs`, `.pnp.loader.mjs`, `.yarnrc.yml` with no `nodeLinker` override, `yarn.lock` all present), but `.yarn/` contains only `install-state.gz` and `unplugged/` — there is **no `.yarn/cache/` and no `.yarn/__virtual__/` directory**. Under PnP, the resolver reads package contents from the cache zips and materializes peer-dependency-specific virtual packages under `.yarn/__virtual__/`. With those two directories absent, the PnP data references packages the local filesystem cannot serve, so the bundler reports "Module not found" for every affected dependency.

The fix strategy is to restore a complete and consistent install state by running a clean, full `yarn install` that regenerates the cache, virtual packages, and PnP data — without altering the package manager, dependency versions, resolutions, or package extensions, and without touching application source. This is an install-state repair, not a source-code change.

## Glossary

- **Bug_Condition (C)**: The condition that triggers the bug — the frontend build resolving a module whose backing PnP artifact (cache zip and/or `__virtual__/` entry) is missing from the incomplete local install state.
- **Property (P)**: The desired behavior — every module the frontend build requests resolves successfully, and the compile completes with 0 module-resolution errors.
- **Preservation**: The declared toolchain and dependency contract that must remain unchanged — Yarn v4 (`yarn@4.13.0`), PnP linker, `resolutions`, `packageExtensions`, and the dependency versions in each workspace `package.json`.
- **PnP (Plug'n'Play)**: Yarn Berry's resolution strategy where `.pnp.cjs` maps every import to an exact package location (a zip in `.yarn/cache/` or a virtual folder in `.yarn/__virtual__/`) instead of using a `node_modules` tree.
- **`__virtual__` package**: A per-consumer materialization Yarn creates so a dependency with peer dependencies resolves its peers relative to the importer. The failing `@backstage/plugin-app` paths live here.
- **CLI virtual entrypoint**: `__backstage-autodetected-plugins__` and `__backstage-module-federation-runtime-shared-dependencies__` — synthetic modules the Backstage CLI's Rspack config injects at build time; they only resolve when the CLI and its dependencies are fully installed and the PnP resolver is intact.
- **install-state.gz**: Yarn's cached snapshot of the last resolution. Its presence without a matching `cache/` and `__virtual__/` is a hallmark of a partial/stale install.

## Bug Details

### Bug Condition

The bug manifests when the frontend Rspack build (`backstage-cli package start` in `packages/app`, invoked by `backstage-cli repo start`) asks the PnP resolver for a module, and the artifact PnP points to — a Berry cache zip and/or a `.yarn/__virtual__/` folder — does not exist on disk because the local install is incomplete. This covers both real dependencies resolved through the `@backstage/plugin-app` virtual package and the CLI-injected virtual entrypoints, which depend on an intact PnP graph.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type ModuleResolutionRequest
         (the specifier the frontend build asks the PnP resolver to resolve,
          e.g. "@backstage/config", "i18next", "@mui/material/Popover",
          "__backstage-autodetected-plugins__")
  OUTPUT: boolean

  RETURN buildRequestsModule(input)
         AND resolverBackingArtifactMissing(input)   // cache zip or __virtual__ entry absent
         AND resolutionFails(input)                   // "Module not found / Can't resolve"
END FUNCTION
```

### Examples

- **CLI virtual entrypoint**: The app entry imports `__backstage-autodetected-plugins__`. Expected: the CLI provides it and it resolves. Actual: "Module not found" because the PnP graph backing the CLI's injection is incomplete.
- **Real dep via virtual package**: `@backstage/plugin-app` (under `.yarn/__virtual__/...`) imports `@backstage/config`. Expected: resolves to the cached package. Actual: "Can't resolve" — the `__virtual__/` folder and/or cache zip is missing.
- **Transitive third-party import**: `material-ui-popup-state` imports `@mui/material/Popover` and `@mui/material/version`. Expected: both resolve. Actual: "Module not found" for each.
- **Aggregate symptom (edge/terminal case)**: After 26 such failures the frontend reports "Rspack compiled with 26 errors" and the dev server does not serve the app — this is the observable end state, expected to be 0 errors after the fix.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- The package manager remains Yarn v4 (`yarn@4.13.0`) as declared by `packageManager` in the root `package.json`; the PnP linker (no `nodeLinker` override in `.yarnrc.yml`) is preserved.
- The existing `resolutions` (`@types/react`, `@types/react-dom`) and `packageExtensions` in `.yarnrc.yml` (including the `@backstage/backend-plugin-api` migration-resolution extension, the `@backstage/plugin-permission-react` peer, and the `@backstage/cli-module-test-jest` jest deps) continue to be honored.
- The declared dependency versions in every workspace `package.json` (notably `packages/app/package.json`) are unchanged — the fix restores install state, it does not add, remove, or bump dependencies.
- Application source under `packages/app/src` is not modified; no source change is required for the build to pass.
- The backend continues to start via `yarn start` with no new module-resolution errors introduced by the fix.

**Scope:**
All inputs that do NOT involve a missing PnP-backing artifact are unaffected by this fix. This includes:
- Modules that already resolve correctly during any partial build (no behavior change for them).
- Runtime application logic and rendered UI (source behavior is untouched).
- Backend module resolution and startup (only the frontend resolution failures are in scope; the fix must not regress the backend).

**Note:** The expected correct behavior (all requested modules resolve; compile finishes with 0 errors) is defined in the Correctness Properties section (Property 1). This section focuses on what must NOT change.

## Hypothesized Root Cause

Based on the bug description and verified repository state (`.yarn/` contains only `install-state.gz` and `unplugged/`; `.pnp.cjs`, `.pnp.loader.mjs`, `yarn.lock`, `.yarnrc.yml` all present), the most likely causes are:

1. **Incomplete / partial `yarn install` (primary hypothesis)**: The Berry package cache (`.yarn/cache/`) and the virtual-package tree (`.yarn/__virtual__/`) were never fully populated, or were partially removed after `.pnp.cjs`/`install-state.gz` were generated. PnP points to artifacts that do not exist on disk, so every dependency backed by a missing zip/virtual folder fails to resolve.
   - `.yarn/cache/` absent → real dependencies (`@backstage/config`, `@backstage/core-app-api`, `i18next`, `prop-types`, `lodash`, `use-sync-external-store`, `@mui/material`) have no readable package contents.
   - `.yarn/__virtual__/` absent → the `@backstage/plugin-app` virtual entrypoints referenced in the error paths cannot be materialized.

2. **Stale / mismatched PnP data**: `.pnp.cjs` and `install-state.gz` reflect a resolution that no longer matches what is on disk (e.g. lockfile or manifests changed, or the cache was cleared) so the resolver and the actual filesystem diverge.

3. **CLI virtual entrypoints failing as a downstream effect**: `__backstage-autodetected-plugins__` and `__backstage-module-federation-runtime-shared-dependencies__` are injected by the Backstage CLI and only resolve when the PnP graph (and the CLI's own dependency tree) is intact. Their failure is a symptom of causes 1/2, not an independent defect.

4. **Cache-location / global-cache misconfiguration (secondary)**: If `.yarnrc.yml` or the environment routes the cache to a global location that is empty or unavailable, the project-local `.yarn/cache/` would legitimately be absent; a clean install regenerates whatever the effective config expects.

The exploratory testing step will confirm cause 1/2 (a clean `yarn install` regenerates `cache/` and `__virtual__/` and the failures disappear) or refute it (failures persist, pointing at a deeper config/lockfile issue requiring re-hypothesis).

## Correctness Properties

Property 1: Bug Condition - Frontend build resolves all requested modules

_For any_ module-resolution request the frontend build makes where the bug condition holds (isBugCondition returns true — the backing PnP artifact was missing under the incomplete install state), after a complete `yarn install` the resolver SHALL locate the module successfully, and the frontend SHALL compile with 0 module-resolution errors and serve the dev server. This covers the CLI virtual entrypoints (`__backstage-autodetected-plugins__`, `__backstage-module-federation-runtime-shared-dependencies__`), the `@backstage/plugin-app` virtual-package dependencies (`@backstage/config`, `@backstage/core-app-api`, `i18next`, `prop-types`, `lodash/mapValues`, `use-sync-external-store/shim`), and the `material-ui-popup-state` transitives (`@mui/material/Popover`, `@mui/material/version`).

**Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5**

Property 2: Preservation - Toolchain and dependency contract unchanged

_For any_ aspect of the project that does NOT involve a missing PnP-backing artifact (isBugCondition returns false), the fixed state SHALL produce the same configuration and behavior as before, preserving the Yarn v4 package manager and PnP linker, the declared `resolutions` and `packageExtensions`, the dependency versions in every workspace `package.json`, unmodified application source, and backend startup free of new module-resolution errors.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**

## Fix Implementation

### Changes Required

Assuming the root-cause analysis is correct, the fix is an install-state repair executed from the repository root — no manifest or source edits.

**Location**: repository root (`/home/vvu/WS/projects/terragrunt/hello-terragrunt-backstage`), install artifacts under `.yarn/` and `.pnp.*`.

**"Function" under repair**: the Yarn PnP install state (`.yarn/cache/`, `.yarn/__virtual__/`, `.pnp.cjs`, `.pnp.loader.mjs`, `.yarn/install-state.gz`).

**Specific Changes**:
1. **Run a clean, complete install**: From the repo root, run `yarn install` (Yarn v4). This regenerates the missing `.yarn/cache/` zips, the `.yarn/__virtual__/` tree, and refreshes `.pnp.cjs`/`.pnp.loader.mjs`/`install-state.gz` to match `yarn.lock`. Do not pass `--immutable` if the state must be rebuilt; if the environment blocks network access, note the cache must be provided out-of-band (see below).
   - Prefer the workspace-consistent path per AGENTS.md (Yarn v4 workspaces monorepo managed by `@backstage/cli`); do not hand-edit `package.json` or `.yarn/` contents.
2. **Do not change dependency declarations**: No edits to any `package.json` `dependencies`/`devDependencies`, and no bumping of versions — the goal is to satisfy the existing lockfile, not resolve to new versions.
3. **Preserve resolution config**: Leave `.yarnrc.yml` `resolutions` and `packageExtensions` intact so the regenerated graph honors them; verify the `@backstage/backend-plugin-api` extension is still present after install.
4. **Verify PnP artifacts materialized**: After install, confirm `.yarn/cache/` is populated and `.yarn/__virtual__/` exists (specifically that the `@backstage/plugin-app` virtual folder from the error paths is present).
5. **Re-run the frontend build**: Run `yarn start` (or scope to `yarn workspace app start`) and confirm the frontend compiles with 0 module-resolution errors; if failures persist, treat the primary hypothesis as refuted and re-hypothesize (stale lockfile, cache-location misconfig, or CLI version mismatch).

**Constraint reminder (AGENTS.md):** `yarn start` is a long-running dev server — it must be run manually by the user, not launched as a blocking command. For verification, prefer a non-watch build/typecheck where possible and inspect its output.

## Testing Strategy

### Validation Approach

Two phases: first reproduce the failures on the current (unfixed) install state and confirm they trace to missing PnP artifacts; then run the clean install and verify both that the previously-failing modules now resolve (fix checking) and that the toolchain/dependency contract is unchanged (preservation checking).

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE applying the fix, and confirm or refute the root cause (missing `cache/` and `__virtual__/`). If refuted, re-hypothesize.

**Test Plan**: Inspect the install state and run the frontend build against the unfixed repo to observe the 26 failures and tie them to missing artifacts.

**Test Cases**:
1. **Missing cache/virtual check**: Confirm `.yarn/cache/` and `.yarn/__virtual__/` are absent on the unfixed repo (already observed) — establishes the artifact gap (will show the gap on unfixed state).
2. **CLI virtual entrypoint failure**: Run the frontend build and confirm `__backstage-autodetected-plugins__` and `__backstage-module-federation-runtime-shared-dependencies__` report "Module not found" (will fail on unfixed code).
3. **Virtual-package dependency failure**: Confirm `@backstage/config`, `@backstage/core-app-api`, `i18next`, `prop-types`, `lodash/mapValues`, `use-sync-external-store/shim` fail to resolve from the `@backstage/plugin-app` virtual path (will fail on unfixed code).
4. **Transitive import / aggregate**: Confirm `@mui/material/Popover` and `@mui/material/version` fail and the build ends with "Rspack compiled with 26 errors" (will fail on unfixed code).

**Expected Counterexamples**:
- Resolution failures whose paths reference `.yarn/__virtual__/...` and Berry cache zips that do not exist locally.
- Possible causes: incomplete `yarn install`, stale/mismatched PnP data, or cache-location misconfiguration.

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed (restored) install state resolves the module and the build compiles cleanly.

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  runYarnInstall()                       // regenerate cache/, __virtual__/, .pnp.cjs
  result := frontendBuild().resolve(input)
  ASSERT result.resolvedSuccessfully
  ASSERT frontendBuild().moduleResolutionErrorCount == 0
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed state matches the original — same package manager, linker, resolutions, package extensions, dependency versions, source, and backend startup.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT original(input) == fixed(input)
END FOR
// concretely:
ASSERT rootPackageJson.packageManager == "yarn@4.13.0"
ASSERT yarnrc.resolutions AND yarnrc.packageExtensions unchanged
ASSERT every workspace package.json dependency version unchanged
ASSERT git diff on packages/app/src is empty
ASSERT backend starts with no new module-resolution errors
```

**Testing Approach**: Property-based / broad-sweep checking is preferred for preservation because the "unchanged" domain is large (every dependency, every config key, all source). Comparing declared manifests and config before/after install, plus a source diff, gives strong assurance that only install artifacts changed.

**Test Plan**: Capture the manifests/config and a source snapshot before the install, then diff after.

**Test Cases**:
1. **Package manager / linker preservation**: Verify `packageManager` stays `yarn@4.13.0` and no `nodeLinker` was introduced.
2. **Resolutions & extensions preservation**: Verify `.yarnrc.yml` `packageExtensions` (incl. `@backstage/backend-plugin-api`) and root `resolutions` are byte-identical after install.
3. **Dependency-version preservation**: Verify no `package.json` dependency versions changed and `yarn.lock` was not rewritten to different versions.
4. **Source & backend preservation**: Verify `git diff` shows no changes under `packages/app/src`, and that the backend still starts without new resolution errors.

### Unit Tests

- Assert `.yarn/cache/` is populated and `.yarn/__virtual__/` exists after install (artifact presence).
- Assert the frontend build reports 0 module-resolution errors for the specific 26 previously-failing specifiers.
- Assert `packageManager` and `.yarnrc.yml` resolution config are unchanged.

### Property-Based Tests

- Over the set of module specifiers requested by the frontend build, assert every one resolves post-install (fix property).
- Over the set of declared dependencies across all workspaces, assert each declared version is unchanged post-install (preservation property).
- Over the config keys in `.yarnrc.yml` and root `resolutions`, assert each is preserved post-install.

### Integration Tests

- Full `yarn start`: frontend compiles with 0 errors and the dev server serves the app (run manually, per AGENTS.md — do not launch as a blocking command).
- Backend startup via `yarn start` completes without new module-resolution errors (regression guard).
- `yarn tsc` typecheck succeeds against the restored install state (broader consistency check).
