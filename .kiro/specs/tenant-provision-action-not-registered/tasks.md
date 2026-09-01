# Implementation Plan

- [x] 1. Write bug condition exploration test (pluginId association regression test)
  - **Property 1: Bug Condition** - tenant:provision reaches the real scaffolder registry
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails** at this step
  - **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
  - **GOAL**: Surface a counterexample proving the pluginId mismatch (`isBugCondition` true), per design "Exploratory Bug Condition Checking"
  - **Scoped PBT Approach**: This is a deterministic configuration defect, so scope the property to the single concrete failing case (the module's one registration) rather than generating inputs
  - Add a `describe('module pluginId association', ...)` block to `plugins/platform-backend-module-tenant-provisioning/src/module.test.ts`
  - Import the named export and cast it as `BackendFeature`, e.g. `import { platformModuleTenantProvisioning } from './module';` and use `getRegistrations()` from `@backstage/backend-plugin-api`
  - Assert `platformModuleTenantProvisioning.getRegistrations()[0].pluginId === 'scaffolder'` (from Bug Condition: `M.pluginId <> ownerPluginId(scaffolderActionsExtensionPoint)` where owner is `'scaffolder'`)
  - Assert `platformModuleTenantProvisioning.getRegistrations()[0].moduleId === 'tenant-provisioning'` (guards against accidental moduleId change)
  - Do NOT invoke git/network/terragrunt/terraform/AWS - `getRegistrations()` is a pure, static inspection of the `BackendFeature`
  - Run the test on UNFIXED code: `yarn workspace @internal/backstage-plugin-platform-backend-module-tenant-provisioning test`
  - **EXPECTED OUTCOME**: The pluginId assertion FAILS with actual value `'platform'` (this is correct - it proves the bug); the moduleId assertion passes
  - Document the counterexample: `getRegistrations()[0].pluginId === 'platform'` instead of `'scaffolder'`, so the module never attaches to the plugin owning `scaffolderActionsExtensionPoint`
  - Mark task complete when the test is written, run, and the failure is documented
  - _Requirements: 2.1, 2.2, 2.3_

- [x] 2. Verify preservation tests pass on UNFIXED code (baseline)
  - **Property 2: Preservation** - Action id, action construction, and other registrations unchanged
  - **IMPORTANT**: Follow observation-first methodology - do NOT add or change fix code here
  - Observe on UNFIXED code that the existing tests in `module.test.ts` already capture the behavior to preserve:
    - `createTenantProvisionAction({ config, logger }).id === 'tenant:provision'` (action id, Req 3.1)
    - `startTestBackend` with the capturing-fake extension point records `tenant:provision` handed to `addActions` (Req 3.2 construction / registration shape)
  - These existing tests are the preservation baseline; confirm they PASS as-is against unfixed code (no new preservation test is required beyond keeping these green, per design "Preservation Checking")
  - Run: `yarn workspace @internal/backstage-plugin-platform-backend-module-tenant-provisioning test`
  - **EXPECTED OUTCOME**: The existing action-id test and the `startTestBackend` registration test PASS (this confirms the baseline behavior to preserve; only the new task-1 pluginId assertion fails)
  - Do NOT exercise git/network/terragrunt/terraform/AWS
  - Mark task complete when the existing preservation tests are confirmed passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [x] 3. Fix the pluginId mismatch so tenant:provision reaches the scaffolder registry

  - [x] 3.1 Correct the module pluginId
    - In `plugins/platform-backend-module-tenant-provisioning/src/module.ts`, change `pluginId: 'platform'` to `pluginId: 'scaffolder'` in the `createBackendModule({ ... })` call
    - Keep `moduleId: 'tenant-provisioning'` unchanged (no collision with `@backstage/plugin-scaffolder-backend-module-github`)
    - Keep `register`, `registerInit`, and `deps` (`scaffolder: scaffolderActionsExtensionPoint`, `config`, `logger`) and the `init` body (`scaffolder.addActions(createTenantProvisionAction({ config, logger }))`) unchanged
    - Do NOT rename the exported symbol `platformModuleTenantProvisioning` or the default export in `src/index.ts`
    - Do NOT modify `packages/backend/src/index.ts` - the existing `backend.add(import('@internal/...'))` line keeps working via the unchanged default export
    - Do NOT touch `package.json` `backstage.pluginId` metadata (out of scope)
    - _Bug_Condition: isBugCondition(M) = M.dependsOn(scaffolderActionsExtensionPoint) AND M.pluginId <> 'scaffolder'_
    - _Expected_Behavior: after fix, getRegistrations()[0].pluginId === 'scaffolder' so tenant:provision reaches the real scaffolder registry_
    - _Preservation: action id `tenant:provision`, createTenantProvisionAction behavior, exported symbol/default export, and packages/backend/src/index.ts wiring all unchanged_
    - _Requirements: 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 3.4_

  - [x] 3.2 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - tenant:provision reaches the real scaffolder registry
    - **IMPORTANT**: Re-run the SAME pluginId association test from task 1 - do NOT write a new test
    - The test from task 1 encodes the expected behavior; when it passes it confirms the module attaches to the `scaffolder` plugin
    - Run: `yarn workspace @internal/backstage-plugin-platform-backend-module-tenant-provisioning test`
    - **EXPECTED OUTCOME**: `getRegistrations()[0].pluginId === 'scaffolder'` and `moduleId === 'tenant-provisioning'` now PASS (confirms the bug is fixed)
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 3.3 Verify preservation tests still pass
    - **Property 2: Preservation** - Action id, action construction, and other registrations unchanged
    - **IMPORTANT**: Re-run the SAME existing tests from task 2 - do NOT write new tests
    - Run: `yarn workspace @internal/backstage-plugin-platform-backend-module-tenant-provisioning test`
    - **EXPECTED OUTCOME**: The action-id test (`tenant:provision`) and the `startTestBackend` capturing-fake registration test still PASS (no regressions); `createTenantProvisionAction` behavior and exports unchanged
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [x] 4. Checkpoint - Verification (no terragrunt/terraform/AWS/network)
  - Run `yarn tsc` to typecheck the change
  - Run `yarn workspace @internal/backstage-plugin-platform-backend-module-tenant-provisioning lint` to lint the touched module
  - Run `yarn workspace @internal/backstage-plugin-platform-backend-module-tenant-provisioning test` to run the full module Jest suite (new pluginId regression test + existing registration/action-id tests)
  - Ensure all tests pass; if questions arise, ask the user
  - **Manual runtime note (NOT automated, NOT run in CI, no terragrunt/terraform/AWS/network):** after the fix, `yarn start`, run the tenant-provisioning template, and confirm the "Provision tenant Terragrunt config" step no longer throws `NotFoundError: Template action with ID 'tenant:provision' is not registered.` This is a smoke observation of registration wiring only; provisioning steps that would invoke Git/Terragrunt/AWS are out of scope for verification here
  - _Requirements: 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 3.4_
