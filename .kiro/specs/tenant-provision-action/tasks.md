# Implementation Plan: tenant-provision-action

## Overview

This plan implements the `tenant:provision` custom Backstage scaffolder action inside the existing
backend module `@internal/backstage-plugin-platform-backend-module-tenant-provisioning`
(`plugins/platform-backend-module-tenant-provisioning/`), which today only logs "Hello World". The
work is built bottom-up following the design's collaborators — ConfigReader, component expansion,
HclRenderer, branch-name/PR-title builders, secret redaction, WorkspaceManager, and GitHelper — then
wired together in the action handler and registered via `scaffolderActionsExtensionPoint`. Finally the
existing `templates/tenant-provisioning/template.yaml` is rewired to invoke the action, and the
`tenantProvisioning` config block is added.

Pure, input-varying logic is covered by property-based tests using `fast-check` (min 100 iterations,
each tagged `Feature: tenant-provision-action, Property N: <text>`). Git/network I/O, PR idempotency,
and scaffolder wiring are covered by mock-based unit/integration tests. **No test runs
`terragrunt`/`terraform` or any real AWS/network operation** — all git and Octokit calls are mocked,
honoring the hard boundary in Requirement 5.5 and `AGENTS.md`.

Conventions (per AGENTS.md): dependencies are added via
`yarn workspace @internal/backstage-plugin-platform-backend-module-tenant-provisioning add ...`
(never by hand-editing `package.json`); verification uses root scripts (`yarn tsc`, `yarn lint`,
`yarn test`) scoped to the touched workspace where possible.

## Tasks

- [x] 1. Scaffold module dependencies and file structure
  - Add runtime deps to the module workspace via
    `yarn workspace @internal/backstage-plugin-platform-backend-module-tenant-provisioning add @backstage/plugin-scaffolder-node @backstage/integration isomorphic-git @octokit/rest zod`
    (do NOT hand-edit `package.json`).
  - Add dev dep via
    `yarn workspace @internal/backstage-plugin-platform-backend-module-tenant-provisioning add -D fast-check`.
  - Create stub files with typed exports so later tasks can build incrementally:
    `src/config.ts`, `src/components.ts`, `src/hcl.ts`, `src/naming.ts` (branch-name + PR-title),
    `src/redact.ts`, `src/workspace.ts`, `src/git.ts`, `src/actions/tenantProvision.ts`.
  - Ensure `src/index.ts` exports the module (unchanged export point).
  - Run `yarn workspace @internal/backstage-plugin-platform-backend-module-tenant-provisioning tsc`
    (or `yarn tsc`) to confirm stubs typecheck.
  - _Requirements: 1.1_

- [x] 2. Implement ConfigReader and config schema
  - [x] 2.1 Implement `readTenantProvisioningConfig(config)` in `src/config.ts`
    - Read `tenantProvisioning.liveRepoUrl`, `tenantProvisioning.liveRepoBranch`,
      `tenantProvisioning.moduleSource` via `getOptionalString`, and
      `tenantProvisioning.components` via `getOptionalStringArray`.
    - Default `liveRepoBranch` to `main` when absent; default `components` to `['dynamodb', 'ecr']`
      when absent.
    - Fail with a config error naming the key when `moduleSource` is absent or empty.
    - Validate every allowed component name matches `^[a-z0-9_]+$` and reject an allowed-set larger
      than 100 entries, before returning.
    - _Requirements: 1.6, 1.7, 1.8, 1.9, 1.10, 9.7, 9.8_
  - [x] 2.2 Add `config.d.ts` schema declaration for the `tenantProvisioning` block
    - Declare `liveRepoUrl`, `liveRepoBranch`, `moduleSource`, `components` so
      `backstage-cli config:check` validates the block.
    - _Requirements: 1.9, 1.10_
  - [x] 2.3 Write unit tests for ConfigReader
    - Branch defaults to `main`; missing/empty `moduleSource` fails with a key-naming error;
      `components` defaults to `[dynamodb, ecr]`; an allowed name violating `^[a-z0-9_]+$` fails;
      an allowed-set >100 entries fails.
    - _Requirements: 1.7, 1.8, 1.10, 9.7, 9.8_

- [x] 3. Implement component expansion
  - [x] 3.1 Implement `expandComponents(selected, allowed)` in `src/components.ts`
    - Reject any `selected` name not in `allowed` with an error identifying the unrecognized
      component, before producing any record.
    - Return a record with one entry per allowed name: `true` iff in `selected`, else `false`
      (duplicates in `selected` collapse; empty `selected` → all `false`; empty `allowed` → `{}`).
    - Keep the function pure and deterministic.
    - _Requirements: 1.5, 9.1, 9.5, 9.6, 9.8, 9.9_
  - [x] 3.2 Write property test for component expansion
    - **Property 9: Component expansion is total over the allowed set and rejects unknown selections**
    - Generate an arbitrary `allowed` set plus a `selected` subset; assert one entry per allowed
      name (`true` iff selected); plus a generator injecting a name not in `allowed` asserting it
      throws before producing a record.
    - Tag: `Feature: tenant-provision-action, Property 9: Component expansion is total over the allowed set and rejects unknown selections`, min 100 iterations.
    - **Validates: Requirements 9.1, 9.5, 9.6, 9.8, 9.9**

- [x] 4. Implement HclRenderer
  - [x] 4.1 Implement `renderTerragruntHcl(input)` in `src/hcl.ts`
    - Emit an `include "root"` block, a `terraform { source = "<moduleSource>" }` block, and an
      `inputs` block with `tenant_name` and `environment`.
    - Emit one `enable_<name>` line per entry in the `components` record, using the same logic for
      every key (no per-name branching), sorted by key in ascending lexicographic byte order; treat
      missing values as `false`; empty map → no `enable_*` entries.
    - Defense-in-depth validation before producing output: reject any component key not matching
      `^[a-z0-9_]+$`, reject a map >100 entries, and reject a `moduleSource` containing `"` or newline.
    - _Requirements: 3.1, 3.2, 3.3, 9.2, 9.3, 9.4, 9.7, 9.8_
  - [x] 4.2 Write property test for HCL round-trip
    - **Property 1: Rendered HCL round-trips the inputs**
    - Generate `{tenantName, environment, moduleSource, allowed, selected}`; run
      `renderTerragruntHcl(expandComponents(selected, allowed), ...)` and parse `terraform.source`,
      `inputs.tenant_name/environment`, and each `enable_<name>` back out; assert equality and one
      entry per allowed name (`true` iff selected; empty allowed → no `enable_*`).
    - Tag: `Feature: tenant-provision-action, Property 1: Rendered HCL round-trips the inputs`, min 100 iterations.
    - **Validates: Requirements 3.1, 3.2, 3.3, 1.5, 9.1, 9.3, 9.4, 9.8, 9.9**
  - [x] 4.3 Write property test for data-driven component rendering
    - **Property 8: Component rendering is data-driven, ordered, and validated**
    - Generate arbitrary valid-key maps (0..100 entries): assert one `enable_<key>` per entry,
      ascending byte order, values match; plus generators biased toward invalid keys and oversized
      maps: assert rendering throws before producing output.
    - Tag: `Feature: tenant-provision-action, Property 8: Component rendering is data-driven, ordered, and validated`, min 100 iterations.
    - **Validates: Requirements 9.2, 9.3, 9.4, 9.7, 9.8**

- [x] 5. Implement branch-name and PR-title builders
  - [x] 5.1 Implement branch-name and PR-title builders in `src/naming.ts`
    - `buildBranchName(tenantName, environment, date)` → `devops/<tenant>-<env>-<yyyymmdd-hhmmss>`
      with the timestamp in UTC (zero-padded year/month/day-hour/minute/second).
    - `buildPullRequestTitle(tenantName, environment)` → a title containing both the tenant name and
      the environment.
    - Keep both pure.
    - _Requirements: 4.2, 5.3_
  - [x] 5.2 Write property test for branch-name format
    - **Property 2: Feature branch name is well-formed**
    - Generate valid tenant/env plus arbitrary `Date`; assert the name matches
      `^devops/[a-z0-9-]{1,32}-(dev|test|uat|prod)-\d{8}-\d{6}$` and embeds the UTC components.
    - Tag: `Feature: tenant-provision-action, Property 2: Feature branch name is well-formed`, min 100 iterations.
    - **Validates: Requirements 4.2**
  - [x] 5.3 Write property test for PR title
    - **Property 7: Pull request title identifies tenant and environment**
    - Generate valid tenant/env; assert the title contains both.
    - Tag: `Feature: tenant-provision-action, Property 7: Pull request title identifies tenant and environment`, min 100 iterations.
    - **Validates: Requirements 5.3**

- [x] 6. Implement secret redaction helper
  - [x] 6.1 Implement `redact(message, secrets)` in `src/redact.ts`
    - Replace every occurrence of each secret value with a fixed non-reversible placeholder, leaving
      all non-secret substrings unchanged; keep the function pure.
    - _Requirements: 7.1, 7.3_
  - [x] 6.2 Write property test for secret redaction
    - **Property 5: Secret redaction is total and content-preserving**
    - Generate a message string and a secret value injected at random positions; assert all secret
      occurrences are removed and the rest of the content is preserved.
    - Tag: `Feature: tenant-provision-action, Property 5: Secret redaction is total and content-preserving`, min 100 iterations.
    - **Validates: Requirements 7.3, 7.1**

- [x] 7. Implement WorkspaceManager
  - [x] 7.1 Implement `createWorkspace(opts)` and `Workspace` in `src/workspace.ts`
    - Create a uniquely named subdirectory (e.g. `fs.mkdtemp`) under the scaffolder working
      directory when configured, otherwise under `os.tmpdir()`.
    - `resolveWithin(relPath)` resolves against `root` and throws when the normalized result is not
      a descendant of `root`.
    - `cleanup()` removes the directory recursively and, if anything remains, throws an error naming
      the residual path with secrets redacted.
    - _Requirements: 3.4, 3.7, 6.1, 6.2, 6.3, 6.4, 6.5, 7.4, 7.5_
  - [x] 7.2 Write property test for path confinement
    - **Property 3: Target path stays confined to the working directory**
    - Generate arbitrary strings biased toward `..`, `/`, and absolute prefixes; assert
      `resolveWithin` output is inside root or throws — no resolved path escapes root.
    - Tag: `Feature: tenant-provision-action, Property 3: Target path stays confined to the working directory`, min 100 iterations.
    - **Validates: Requirements 3.4, 3.7, 7.4, 7.5**
  - [x] 7.3 Write property test for working-directory uniqueness
    - **Property 6: Working directories are unique per execution**
    - Invoke the workspace path builder many times (both configured-baseDir and os.tmpdir cases) and
      assert all generated paths are distinct.
    - Tag: `Feature: tenant-provision-action, Property 6: Working directories are unique per execution`, min 100 iterations.
    - **Validates: Requirements 6.4, 6.5**
  - [x] 7.4 Write unit tests for cleanup behavior
    - Directory removed on success and on failure; cleanup that leaves residue yields a redacted
      error naming the residual path.
    - _Requirements: 6.1, 6.2, 6.3_

- [x] 8. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Implement GitHelper (mocked I/O only)
  - [x] 9.1 Implement clone/branch/commit/push over isomorphic-git in `src/git.ts`
    - `clone({url, ref, dir, timeoutMs})` using `singleBranch`/`ref`, leaving the checkout on the
      base branch; enforce a 120s timeout via `AbortController`/`Promise.race`.
    - `localBranchOrRemoteExists(branch)`; `createBranchCommitPush({branch, baseBranch, filePath,
      message, timeoutMs})` committing exactly the one file with a message including tenant+env;
      enforce a 60s push timeout.
    - Resolve auth via `ScmIntegrations.fromConfig` + `DefaultGithubCredentialsProvider` keyed by the
      live repo host; never log or persist the token.
    - Map clone errors to network-unreachable, missing-ref, auth-rejected (token redacted), and
      timeout; map push errors to reject/timeout; route all errors through the redaction helper.
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 4.1, 4.3, 4.4, 5.1, 5.7, 7.1, 7.2, 7.3_
  - [x] 9.2 Implement PR lookup/creation over Octokit in `src/git.ts`
    - `findOpenPullRequest({head, base})` and `createPullRequest({head, base, title, timeoutMs})`
      with a 60s timeout; reuse an existing open PR URL instead of creating a duplicate; on failure
      report the pushed branch name.
    - _Requirements: 5.2, 5.6, 5.8_
  - [x] 9.3 Write mocked unit tests for GitHelper
    - Clone error mapping (network/missing-ref/auth-redacted/timeout); duplicate branch detection;
      commit contains exactly `terragrunt.hcl` with a tenant+env message; push failure/timeout;
      PR happy path, duplicate-open-PR reuse, and PR failure/timeout reporting the pushed branch.
    - All `isomorphic-git`/Octokit calls mocked — no real network.
    - _Requirements: 2.3, 2.4, 2.5, 2.6, 4.3, 4.4, 5.2, 5.6, 5.7, 5.8_

- [x] 10. Implement the action handler and register it
  - [x] 10.1 Implement `createTenantProvisionAction` in `src/actions/tenantProvision.ts`
    - Build with `createTemplateAction({ id: 'tenant:provision', ... })`; input schema
      `tenantName` (`^[a-z0-9-]{1,32}$`), `environment` enum (`dev|test|uat|prod`),
      `selectedComponents` string array (default `[]`); output `pullRequestUrl` and `branchName`.
    - Orchestrate fail-fast ordering: validate inputs → read/validate config → `expandComponents`
      (all before any workspace/clone) → create workspace → clone → render + write file at
      `<tenant>/<env>/terragrunt.hcl` (create/overwrite, confined path) → branch/commit → push →
      PR (reuse if open) → set outputs.
    - Wrap everything after workspace creation in `try/finally` so cleanup runs on both success and
      failure; surface redacted errors after cleanup.
    - _Requirements: 1.3, 1.4, 1.5, 3.5, 3.6, 3.7, 3.8, 5.4, 6.1, 6.2, 8.1, 8.2, 8.3, 8.4_
  - [x] 10.2 Register the action in `src/module.ts`
    - Replace the "Hello World" `registerInit` with deps on
      `scaffolderActionsExtensionPoint` (`@backstage/plugin-scaffolder-node/alpha`),
      `coreServices.rootConfig`, and `coreServices.logger`; call
      `scaffolder.addActions(createTenantProvisionAction({ config, logger }))`. Keep
      `pluginId: 'platform'`, `moduleId: 'tenant-provisioning'`.
    - _Requirements: 1.1, 1.2_
  - [x] 10.3 Write property test for fail-fast input validation
    - **Property 4: Invalid input is rejected with no side effects**
    - Generate invalid tenant/env strings; assert the action fails with a validation error and, with
      spies on the workspace/git collaborators, that none were invoked.
    - Tag: `Feature: tenant-provision-action, Property 4: Invalid input is rejected with no side effects`, min 100 iterations.
    - **Validates: Requirements 1.4, 8.1, 8.2, 8.3, 8.4**
  - [x] 10.4 Write mocked integration tests for the handler
    - Happy path exposes `pullRequestUrl` + `branchName` (Req 5.1-5.4); creates missing folders and
      file (3.5) and overwrites existing (3.6); write failure leaves prior content intact (3.8);
      path escaping the workspace is rejected before I/O (3.7); cleanup runs on success and failure
      (6.1, 6.2).
    - _Requirements: 3.5, 3.6, 3.7, 3.8, 5.1, 5.2, 5.3, 5.4, 6.1, 6.2_
  - [x] 10.5 Write safety-boundary assertion test
    - Assert that across a full mocked run no child-process/exec, no `terragrunt`/`terraform`
      invocation, and no AWS call is made anywhere in the action.
    - _Requirements: 5.5_
  - [x] 10.6 Write registration smoke test and secret-hygiene test
    - The module registers an action with id `tenant:provision` retrievable from the scaffolder
      actions registry (1.1, 1.2); log capture across a mocked run contains no token value (7.1);
      the rendered/committed file never contains a token (7.2).
    - _Requirements: 1.1, 1.2, 7.1, 7.2_

- [x] 11. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. Rewire the tenant-provisioning template
  - Edit `templates/tenant-provisioning/template.yaml`: replace the `dynamodb`/`ecr` boolean
    parameters with a single multi-select `components` array parameter (`items.enum: [dynamodb,
    ecr]`, `uniqueItems: true`, `default: []`, `ui:widget: checkboxes`).
  - Replace the `debug:log` `show-inputs` step with a `tenant:provision` step forwarding
    `tenantName`, `environment`, and `selectedComponents: ${{ parameters.components }}`.
  - Update `output` to show the branch name and pull request URL (link + text) from
    `steps.provision.output`.
  - _Requirements: 1.2, 1.3, 5.4_

- [x] 13. Wire the tenantProvisioning config block
  - Add the `tenantProvisioning` block to `app-config.yaml` using `${ENV_VAR}` references
    (`liveRepoUrl: ${TENANT_LIVE_REPO_URL}`, `liveRepoBranch: ${TENANT_LIVE_REPO_BRANCH}`,
    `moduleSource: ${TERRAGRUNT_MODULE_SOURCE}`, `components: [dynamodb, ecr]`).
  - Confirm the `config.d.ts` from task 2.2 covers the block (no hardcoded literals).
  - _Requirements: 1.6, 1.7, 1.8, 1.9, 1.10_

- [x] 14. Final verification
  - Run `yarn workspace @internal/backstage-plugin-platform-backend-module-tenant-provisioning tsc`,
    then `yarn lint` and
    `yarn workspace @internal/backstage-plugin-platform-backend-module-tenant-provisioning test`.
  - Fix any failures; confirm no test performs a real network/AWS/terragrunt operation.
  - _Requirements: 1.1, 5.5_

## Notes

- Tasks marked with `*` are optional (property/unit/integration/smoke tests) and can be skipped for a
  faster MVP; core implementation tasks are never optional.
- Each task references specific requirements for traceability; property-test tasks also reference
  their design property number.
- The design's 9 correctness properties map to sub-tasks 3.2 (P9), 4.2 (P1), 4.3 (P8), 5.2 (P2),
  5.3 (P7), 6.2 (P5), 7.2 (P3), 7.3 (P6), and 10.3 (P4).
- Checkpoints (tasks 8 and 11) ensure incremental validation.
- The workflow ends at the pull request: no task runs `terragrunt`/`terraform` `plan`/`apply` or any
  real AWS/network side effect, and tests mock all git/Octokit I/O.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1", "3.1", "4.1", "5.1", "6.1", "7.1", "9.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "3.2", "4.2", "4.3", "5.2", "5.3", "6.2", "7.2", "7.3", "7.4", "9.2"] },
    { "id": 3, "tasks": ["9.3", "10.1"] },
    { "id": 4, "tasks": ["10.2", "12"] },
    { "id": 5, "tasks": ["10.3", "10.4", "10.5", "10.6", "13"] },
    { "id": 6, "tasks": ["14"] }
  ]
}
```
