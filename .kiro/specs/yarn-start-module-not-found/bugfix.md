# Bugfix Requirements Document

## Introduction

Running `yarn start` (which invokes `backstage-cli repo start` and, for the frontend, the Rspack-based `backstage-cli package start` in `packages/app`) fails to compile. The build ends with "Rspack compiled with 26 errors", where every error is a "Module not found / Can't resolve" failure originating from the frontend package `packages/app`.

This repository is a freshly scaffolded Backstage app using a Yarn v4 workspaces monorepo with **Plug'n'Play (PnP)** resolution (`.pnp.cjs`, `.pnp.loader.mjs`, `.yarnrc.yml` with no `nodeLinker` override, and `.yarn/install-state.gz` present). The failing modules split into two groups:

- Backstage-internal virtual entrypoints the app bundler expects the CLI to provide: `__backstage-autodetected-plugins__` and `__backstage-module-federation-runtime-shared-dependencies__`.
- Real dependencies that fail to resolve from inside the `@backstage/plugin-app` virtual package under `.yarn/__virtual__/...` (`@backstage/config`, `@backstage/core-app-api`, `i18next`, `prop-types`, `lodash/mapValues`, `use-sync-external-store/shim`, and `@mui/material/Popover` + `@mui/material/version` pulled in via `material-ui-popup-state`).

The symptom pattern — resolution failures pointing at PnP virtual paths and Yarn Berry cache zips — indicates the local install/PnP state is incomplete or stale (dependencies not fully installed, or the PnP data does not match the bundler's resolution), rather than a source-code defect. The user initially reported this as a "git error", but the output is a dependency/module-resolution failure during the frontend build, not a Git failure.

The goal of this fix is to make `yarn start` compile the frontend cleanly (0 module-resolution errors) by restoring a complete and consistent install/PnP state, without changing the app's source behavior.

## Bug Analysis

### Current Behavior (Defect)

What currently happens when `yarn start` is run in this repository state.

1.1 WHEN `yarn start` runs the frontend build in `packages/app` THEN the system fails to resolve `__backstage-autodetected-plugins__` and reports a "Module not found" error
1.2 WHEN the frontend build resolves the app entry THEN the system fails to resolve `__backstage-module-federation-runtime-shared-dependencies__` and reports a "Module not found" error
1.3 WHEN the frontend build resolves dependencies of the `@backstage/plugin-app` virtual package under `.yarn/__virtual__/...` THEN the system fails to resolve `@backstage/config`, `@backstage/core-app-api`, `i18next`, `prop-types`, `lodash/mapValues`, and `use-sync-external-store/shim` and reports "Module not found" for each
1.4 WHEN the build resolves `material-ui-popup-state` THEN the system fails to resolve its transitive imports `@mui/material/Popover` and `@mui/material/version` and reports "Module not found" for each
1.5 WHEN the frontend build completes its compile pass THEN the system aborts with "Rspack compiled with 26 errors" and the dev server does not serve the app

### Expected Behavior (Correct)

What should happen instead when `yarn start` is run.

2.1 WHEN `yarn start` runs the frontend build in `packages/app` THEN the system SHALL resolve `__backstage-autodetected-plugins__` without a module-resolution error
2.2 WHEN the frontend build resolves the app entry THEN the system SHALL resolve `__backstage-module-federation-runtime-shared-dependencies__` without a module-resolution error
2.3 WHEN the frontend build resolves dependencies of the `@backstage/plugin-app` virtual package THEN the system SHALL resolve `@backstage/config`, `@backstage/core-app-api`, `i18next`, `prop-types`, `lodash/mapValues`, and `use-sync-external-store/shim` successfully
2.4 WHEN the build resolves `material-ui-popup-state` THEN the system SHALL resolve its transitive imports `@mui/material/Popover` and `@mui/material/version` successfully
2.5 WHEN the frontend build completes its compile pass THEN the system SHALL compile with 0 module-resolution errors and serve the app dev server

### Unchanged Behavior (Regression Prevention)

Existing behavior and configuration that must be preserved by the fix.

3.1 WHEN the fix is applied THEN the system SHALL CONTINUE TO use Yarn v4 (`yarn@4.13.0`) as the package manager as declared in the root `package.json`
3.2 WHEN dependencies are resolved after the fix THEN the system SHALL CONTINUE TO honor the existing `resolutions` and `packageExtensions` declared in `package.json` and `.yarnrc.yml` (including the `@backstage/backend-plugin-api` migration-resolution extension)
3.3 WHEN the backend is started via `yarn start` THEN the system SHALL CONTINUE TO start the backend without new module-resolution errors introduced by the fix
3.4 WHEN application source under `packages/app/src` is built THEN the system SHALL CONTINUE TO produce the same app behavior, with no changes required to application source code to make the build pass
3.5 WHEN no other install-affecting change is made THEN the system SHALL CONTINUE TO keep the declared dependency versions in `packages/app/package.json` unchanged (the fix restores install state rather than altering the dependency set)
