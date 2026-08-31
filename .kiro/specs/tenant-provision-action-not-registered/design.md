# tenant-provision-action-not-registered Bugfix Design

## Overview

The `tenant:provision` scaffolder action is never registered in the scaffolder's
real action registry, so any tenant that runs the tenant-provisioning template fails at the
"Provision tenant Terragrunt config" step with:

```
NotFoundError: Template action with ID 'tenant:provision' is not registered.
```

The backend module that supplies the action (`plugins/platform-backend-module-tenant-provisioning/src/module.ts`)
is created via `createBackendModule({ pluginId: 'platform', moduleId: 'tenant-provisioning' })`,
but its `registerInit` depends on `scaffolderActionsExtensionPoint`, which is owned by the
`scaffolder` plugin. In the Backstage backend system a module only attaches to extension points
of the plugin named by its `pluginId`. Because no `platform` plugin provides the scaffolder
actions extension point, the module's `addActions()` call never reaches the scaffolder registry,
and the action is silently dropped at startup — the failure only surfaces when the template step
runs.

The fix is a one-line change: set the module's `pluginId` to `'scaffolder'` so it attaches to the
plugin that owns the extension point it depends on. The rest of the module (moduleId, deps,
`registerInit`, the exported symbol, and the backend wiring) is unchanged. The design also
hardens the registration test so a wrong `pluginId` is caught before runtime instead of passing
against a hand-provided fake extension point.

## Glossary

- **Bug_Condition (C)**: The module depends on `scaffolderActionsExtensionPoint` but declares a
  `pluginId` that is not the plugin owning that extension point, so its actions never reach the
  scaffolder registry.
- **Property (P)**: When the module is registered, the `tenant:provision` action reaches the
  scaffolder's real action registry and the template step resolves and runs it without a
  `NotFoundError`.
- **Preservation**: The action id `tenant:provision`, the behavior of
  `createTenantProvisionAction`, the exported module symbol/default export, and every other
  backend registration in `packages/backend/src/index.ts` must remain unchanged.
- **`platformModuleTenantProvisioning`**: The `BackendFeature` created by `createBackendModule`
  in `plugins/platform-backend-module-tenant-provisioning/src/module.ts`; re-exported as the
  default from that package's `src/index.ts`.
- **`scaffolderActionsExtensionPoint`**: The extension point (`id: "scaffolder.actions"`) from
  `@backstage/plugin-scaffolder-node`, contributed by the `@backstage/plugin-scaffolder-backend`
  plugin under pluginId `scaffolder`. A module receives it only when the module's `pluginId` is
  `scaffolder`.
- **pluginId (module)**: The runtime `pluginId` passed to `createBackendModule`. Distinct from
  the `backstage.pluginId` field in `package.json`, which is packaging metadata and is not part
  of this fix.

## Bug Details

### Bug Condition

The bug manifests when the backend module that provides `tenant:provision` is created with a
`pluginId` that does not match the plugin that owns `scaffolderActionsExtensionPoint`. The module
loads without error, but the backend system never wires its `addActions()` output into the
scaffolder's real registry, so the action is missing at template-run time.

**Formal Specification:**
```
FUNCTION isBugCondition(M)
  INPUT: M, the backend module registration for tenant-provisioning
  OUTPUT: boolean

  RETURN M.dependsOn(scaffolderActionsExtensionPoint)
         AND M.pluginId <> ownerPluginId(scaffolderActionsExtensionPoint)
END FUNCTION
```

For this codebase `ownerPluginId(scaffolderActionsExtensionPoint) = 'scaffolder'`, and the current
module has `pluginId = 'platform'`, so `isBugCondition` is currently true.

### Examples

- **Startup (current, buggy):** Backend starts, `platformModuleTenantProvisioning` initializes
  without error, `addActions(...)` is called on the `platform`-scoped extension-point instance,
  but the real scaffolder registry never receives `tenant:provision`. Expected: the action is in
  the scaffolder registry.
- **Template run (current, buggy):** A tenant runs the tenant-provisioning template; at the
  "Provision tenant Terragrunt config" step, `DefaultTemplateActionRegistry.get('tenant:provision')`
  throws `NotFoundError`. Expected: the action resolves and executes.
- **Existing smoke test (current, misleading):** `src/module.test.ts` boots `startTestBackend`
  with a hand-provided fake `scaffolderActionsExtensionPoint`; the harness attaches the fake
  regardless of the module's `pluginId`, so `addActions` is observed and the test passes. Expected:
  the test should fail when `pluginId` is wrong.
- **Edge case — after fix:** With `pluginId = 'scaffolder'`, the module attaches to the scaffolder
  plugin, the action reaches the registry, and other scaffolder actions/templates continue to run
  unchanged.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- The action is exposed under the exact id `tenant:provision` (the id used by the template step
  does not change) — Req 3.1.
- `createTenantProvisionAction({ config, logger })` builds the action from the same `config` and
  `logger` dependencies with identical behavior — Req 3.2.
- The exported symbol `platformModuleTenantProvisioning` and the package's default export
  (`src/index.ts`) keep the same names, so no importer changes; `packages/backend/src/index.ts`
  keeps its existing `backend.add(import('@internal/...'))` line unchanged — Req 3.3.
- All other stock and custom plugins/modules in `packages/backend/src/index.ts` and all other
  scaffolder actions and templates resolve and execute exactly as before — Req 3.3, 3.4.

**Scope:**
All inputs that do NOT involve this module's `pluginId` association should be completely
unaffected by this fix. This includes:
- The action's runtime logic (git/HCL/workspace/naming/redact helpers) — no code path there
  changes.
- Every other `backend.add(...)` registration in the backend.
- Other scaffolder actions and templates, and their resolution/execution.

## Hypothesized Root Cause

Confirmed root cause (validated by reading `module.ts` and the extension-point definition):

1. **Plugin-id mismatch (root cause).** `createBackendModule` is called with
   `pluginId: 'platform'`, but the module depends on `scaffolderActionsExtensionPoint`, which is
   contributed only by the `scaffolder` plugin. The backend system attaches a module's `deps`
   extension points from the plugin named by the module's `pluginId`; a `platform`-scoped module
   never receives the scaffolder extension point, so `addActions()` writes into an instance that
   is not the real scaffolder registry.

2. **Extension point carries no owner metadata.** `scaffolderActionsExtensionPoint` is created
   with only `{ id: "scaffolder.actions" }`; the plugin↔extension-point ownership is enforced by
   the backend wiring at runtime, not stored on the object. This is why the mismatch cannot be
   caught by inspecting the extension point alone and must be caught via the module's declared
   `pluginId`.

3. **Test blind spot (why it went undetected).** `src/module.test.ts` supplies a fake
   `scaffolderActionsExtensionPoint` through `startTestBackend({ extensionPoints: [...] })`. The
   test harness attaches that fake to the module irrespective of `pluginId`, bypassing the exact
   association that is broken in production. The test therefore passes on buggy code.

## Correctness Properties

Property 1: Bug Condition - tenant:provision reaches the real scaffolder registry

_For any_ module registration where the bug condition holds (`isBugCondition` returns true — the
module depends on `scaffolderActionsExtensionPoint` but its `pluginId` is not the owner of that
extension point), the fixed module SHALL declare `pluginId = 'scaffolder'` so that, when the
backend starts, the `tenant:provision` action is registered in the scaffolder's real action
registry and the "Provision tenant Terragrunt config" template step resolves and executes it
without throwing `NotFoundError`.

**Validates: Requirements 2.1, 2.2, 2.3**

Property 2: Preservation - Action, exports, and other registrations unchanged

_For any_ input where the bug condition does NOT hold (the module already attaches to the
scaffolder actions extension point), the fixed module SHALL produce the same result as the
original module, preserving the action id `tenant:provision`, the behavior of
`createTenantProvisionAction`, the exported module symbol and default export, the backend wiring
in `packages/backend/src/index.ts`, and the resolution/execution of all other scaffolder actions
and templates.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4**

## Fix Implementation

### Changes Required

Root cause is confirmed, so the change is minimal and targeted.

**File**: `plugins/platform-backend-module-tenant-provisioning/src/module.ts`

**Function**: the `createBackendModule({ ... })` call assigned to
`platformModuleTenantProvisioning`

**Specific Changes**:
1. **Correct the pluginId.** Change `pluginId: 'platform'` to `pluginId: 'scaffolder'` so the
   module attaches to the plugin that owns `scaffolderActionsExtensionPoint`. This is the only
   production-code change.

2. **Keep moduleId unchanged.** `moduleId: 'tenant-provisioning'` stays as-is (unique within the
   `scaffolder` plugin's modules; `@backstage/plugin-scaffolder-backend-module-github` uses a
   different moduleId, so there is no collision).

3. **Keep `register`/`registerInit`/`deps` unchanged.** The `deps`
   (`scaffolder: scaffolderActionsExtensionPoint`, `config`, `logger`) and the `init` body
   (`scaffolder.addActions(createTenantProvisionAction({ config, logger }))`) are correct once the
   pluginId is fixed; do not touch them.

4. **Do not rename exports.** `export const platformModuleTenantProvisioning` and
   `src/index.ts`'s `export { platformModuleTenantProvisioning as default }` are unchanged. The
   name intentionally keeps the `platform*` prefix; renaming would ripple into the backend import
   and is out of scope (Req 3.3).

5. **No change to `packages/backend/src/index.ts`.** The existing
   `backend.add(import('@internal/backstage-plugin-platform-backend-module-tenant-provisioning'))`
   line continues to work because the default export is unchanged.

6. **`package.json` `backstage.pluginId` metadata is out of scope.** That field is packaging
   metadata and does not affect runtime extension-point attachment; leaving it avoids an unrelated
   change. (If desired later, it can be aligned separately, but it is not part of this fix and not
   required by any acceptance criterion.)

## Testing Strategy

### Validation Approach

Two-phase: first surface a counterexample that fails on the unfixed code (proving the bug and the
test's power to catch it), then verify the fix registers the action and preserves everything else.
No git/network/terragrunt/terraform/AWS operation is exercised — building the action is pure, and
registration is inspected statically.

### Exploratory Bug Condition Checking

**Goal**: Surface a counterexample that demonstrates the bug BEFORE implementing the fix, and
confirm the root cause (pluginId mismatch). The existing smoke test cannot do this because it
bypasses the pluginId association, so the exploratory step is to add a check that reads the
module's declared `pluginId`.

**Test Plan**: `createBackendModule` returns a `BackendFeature` whose `getRegistrations()` yields
registration objects that each carry `pluginId` and `moduleId` (verified in
`@backstage/backend-plugin-api`). A test can call
`platformModuleTenantProvisioning.getRegistrations()` and assert the registration's `pluginId`
equals `'scaffolder'`. Run this on the UNFIXED code to observe it fail (`pluginId === 'platform'`),
confirming the root cause and the test's diagnostic power.

**Test Cases**:
1. **Declared pluginId check**: assert `getRegistrations()[0].pluginId === 'scaffolder'`
   (will fail on unfixed code: `'platform'`).
2. **moduleId preserved check**: assert `getRegistrations()[0].moduleId === 'tenant-provisioning'`
   (passes on both; guards against an accidental moduleId change).
3. **Action id via startTestBackend**: keep the existing capturing-fake test asserting
   `addActions` received `tenant:provision` (passes on both; retained for the id assertion).
4. **Edge case**: assert exactly one registration is produced and it depends on the scaffolder
   actions extension point (may fail if register wiring is altered).

**Expected Counterexamples**:
- On unfixed code, the declared-pluginId assertion fails with actual `'platform'`.
- Possible causes ruled in/out: pluginId mismatch (confirmed), moduleId collision (ruled out),
  deps/init error (ruled out — init runs fine against the fake).

### Fix Checking

**Goal**: Verify that for the buggy configuration, the fixed module registers `tenant:provision`
so it reaches the scaffolder registry.

**Pseudocode:**
```
FOR ALL M WHERE isBugCondition(M) DO
  reg := M'.getRegistrations()[0]
  ASSERT reg.pluginId = ownerPluginId(scaffolderActionsExtensionPoint)   // 'scaffolder'
  ASSERT reg.moduleId = 'tenant-provisioning'
  ASSERT startTestBackend(M').capturedActions CONTAINS 'tenant:provision'
END FOR
```

**Recommended registration test (chosen approach).** Evaluate the three options from the task:

- **(a) Boot the real `@backstage/plugin-scaffolder-backend` and assert the action resolves in the
  real registry.** Highest fidelity but heaviest and most fragile: `plugin-scaffolder-backend` is
  not a declared dependency of this workspace (only `plugin-scaffolder-node` and, as a devDep,
  `plugin-catalog-backend` are), it pulls a large dependency graph, and a full scaffolder backend
  boot can require additional services/config. Rejected as the primary test — cost and flakiness
  outweigh the benefit, and it risks pulling network/db-adjacent setup.

- **(b) Assert the module's declared `pluginId` via a lightweight harness.** `getRegistrations()`
  is a stable, public part of the `BackendFeature` contract and exposes `pluginId`/`moduleId`
  directly. Asserting `pluginId === 'scaffolder'` fails immediately and unambiguously on the exact
  defect (`isBugCondition`), needs no extra dependencies, and runs fast with no network. This is
  the most robust cost/benefit choice.

- **(c) Register the module against a test backend where the extension point is provided under the
  correct plugin scope, and add a negative check for a `platform`-scoped module.** `startTestBackend`
  attaches supplied `extensionPoints` to a module regardless of its `pluginId`, so it cannot
  distinguish `pluginId: 'scaffolder'` from `pluginId: 'platform'` via the fake — it does not
  actually exercise the association. A true negative check would require the real plugin (reducing
  to option a). Rejected as unable to catch the bug reliably.

**Recommendation: option (b)**, complemented by the retained capturing-fake test for the action
id. Concretely, add to `src/module.test.ts`:

- A `describe('module pluginId association', ...)` block that calls
  `(platformModuleTenantProvisioning as BackendFeature).getRegistrations()` and asserts the single
  registration has `pluginId === 'scaffolder'` and `moduleId === 'tenant-provisioning'`. This test
  FAILS on the current code and PASSES after the fix, satisfying Req 2.3.
- Keep the existing `startTestBackend` capturing-fake test asserting the added action id is
  `tenant:provision` (Req 2.1, 2.2 at the id/registration level; runs without network).

This runs under the module's existing `backstage-cli package test` (Jest) setup with no new
dependencies and no network.

### Preservation Checking

**Goal**: Verify that for inputs where the bug condition does not hold, the fixed module produces
the same result as the original.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT F(input) = F'(input)
  // action id, createTenantProvisionAction behavior, exported symbols,
  // and all other backend registrations are identical
END FOR
```

**Testing Approach**: Property-based testing (`fast-check`, already a devDependency) is suitable
for confirming `createTenantProvisionAction` behavior is unchanged across generated
`config`/`logger` inputs, since the fix does not touch that function.

**Test Plan**: Observe current behavior first (action id, action construction) and lock it in with
tests that must keep passing after the fix. Do not exercise git/network/terragrunt.

**Test Cases**:
1. **Action id preservation**: `createTenantProvisionAction({...}).id === 'tenant:provision'`
   holds on unfixed code and continues to hold after the fix (Req 3.1). (Already present.)
2. **Action construction preservation**: `createTenantProvisionAction` builds an action from the
   given `config`/`logger` identically before and after the fix; verify with representative and
   PBT-generated inputs that the produced action shape/id is stable (Req 3.2).
3. **Export/default preservation**: the package default export and named
   `platformModuleTenantProvisioning` symbol still import successfully (Req 3.3).

### Unit Tests

- Assert the module's declared `pluginId` is `'scaffolder'` and `moduleId` is
  `'tenant-provisioning'` via `getRegistrations()` (regression guard for Req 2.3).
- Assert `createTenantProvisionAction(...).id === 'tenant:provision'` (Req 3.1).
- Assert `startTestBackend` with a capturing fake extension point sees `tenant:provision`
  handed to `addActions` (Req 2.1, 2.2).

### Property-Based Tests

- Using `fast-check`, generate varied `config`/`logger` mocks and assert
  `createTenantProvisionAction` returns an action with the stable id and shape (preservation of
  Req 3.2), confirming the fix does not alter action construction.

### Integration Tests

- Manual/runtime verification (not automated, and NOT run against real terragrunt/terraform/AWS or
  network): after the fix, `yarn start`, run the tenant-provisioning template, and confirm the
  "Provision tenant Terragrunt config" step no longer throws
  `NotFoundError: Template action with ID 'tenant:provision' is not registered.` (Req 2.2). This is
  a smoke observation of registration wiring only; provisioning steps that would invoke
  Git/Terragrunt/AWS are out of scope for verification here.

### Automated verification commands

Run scoped to the touched workspace, no network:
- `yarn tsc` — typecheck the change.
- `yarn workspace @internal/backstage-plugin-platform-backend-module-tenant-provisioning lint`
  — lint the module.
- `yarn workspace @internal/backstage-plugin-platform-backend-module-tenant-provisioning test`
  — run the module's Jest suite (including the new pluginId regression test).
