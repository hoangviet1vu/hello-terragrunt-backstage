# Implementation Plan: Tenant Provisioning Template

## Overview

This plan implements the tenant-provisioning Backstage Software Template as a single declarative
`Template` catalog entity plus a `catalog.locations` registration, then verifies it with structural
unit tests and two `fast-check` property-based tests over the parameter JSON Schemas.

The scope is UI-input-only: the template collects `tenantName`, `environment`, `dynamodb`, and `ecr`,
echoes them via a stock `debug:log` step, and displays them in an `output.text` block. There is no
scaffolder action, no `terragrunt.hcl` rendering, and no PR. All work follows the repo conventions in
`AGENTS.md` (Yarn v4 workspaces, `@backstage/cli`, root scripts).

Because the design includes a "Correctness Properties" section, property-based test sub-tasks are
included and each references its design property number and the requirements it validates.

## Tasks

- [x] 1. Create the tenant-provisioning Template catalog entity
  - [x] 1.1 Author `templates/tenant-provisioning/template.yaml` with entity metadata and spec scaffolding
    - Create `templates/tenant-provisioning/template.yaml`, mirroring the existing
      `templates/template/template.yaml` folder-per-template layout.
    - Set `apiVersion: scaffolder.backstage.io/v1beta3`, `kind: Template`.
    - Set `metadata.name: tenant-provisioning-template`, a non-empty `metadata.title`
      (e.g. "Tenant Provisioning"), and a non-empty `metadata.description` identifying it as the
      tenant-provisioning template.
    - Set `spec.type: service` and `spec.owner: user:guest` (resolvable via `templates/org.yaml`).
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

  - [x] 1.2 Define the `spec.parameters` form (tenantName, environment, dynamodb, ecr)
    - Add a single parameters page with `required: [tenantName, environment]`.
    - `tenantName`: `type: string`, `pattern: '^[a-z0-9-]{1,32}$'`, non-empty title/description,
      `ui:autofocus: true`.
    - `environment`: `type: string`, `pattern: '^[a-z0-9-]{1,12}$'`, `default: dev`, non-empty
      title/description; keep it a plain `string` (not an enum) so rjsf renders a text input.
    - `dynamodb`: `type: boolean`, `default: false`, non-empty title/description.
    - `ecr`: `type: boolean`, `default: false`, non-empty title/description.
    - _Requirements: 2.1, 2.2, 2.4, 3.1, 3.2, 3.3, 3.4, 3.9, 4.1, 4.2, 4.3, 4.4, 4.5_

  - [x] 1.3 Add the runnable `show-inputs` step and `output.text` block
    - Add a single `debug:log` step (`id: show-inputs`) that echoes the four collected inputs, with a
      comment documenting it as a placeholder for the future provisioning action (no Git/Terragrunt/
      Terraform/AWS side effects).
    - Add an `output.text` entry that renders the collected `tenantName`, `environment`, `dynamodb`,
      and `ecr` values on the results screen.
    - _Requirements: 1.1_

- [x] 2. Register the template location for local dev
  - [x] 2.1 Add the `catalog.locations` entry in `app-config.yaml`
    - Following the existing example-template pattern, add a `type: file` entry with
      `target: ../../templates/tenant-provisioning/template.yaml` and `rules: - allow: [Template]`.
    - Leave `app-config.production.yaml` unchanged (out of scope).
    - _Requirements: 1.7, 1.8_

- [x] 3. Checkpoint - template entity authored and registered
  - Ensure the YAML parses and the config edit is valid; ask the user if questions arise.

- [x] 4. Add structural / schema validation tests for the template entity
  - [x] 4.1 Add a test that loads, parses, and schema-validates the template
    - Add a Jest test (runnable via `backstage-cli repo test`) that reads
      `templates/tenant-provisioning/template.yaml`, parses YAML to an object, and validates it as a
      valid `scaffolder.backstage.io/v1beta3` `Template` entity.
    - Assert one fact per criterion group: apiVersion/kind (1.1); `metadata.name` (1.2); non-empty
      title/description (1.3); `spec.type === 'service'` (1.4); non-empty `spec.owner` entity ref (1.5);
      `tenantName` string + pattern `^[a-z0-9-]{1,32}$` + in `required` + non-empty title/description
      (2.1, 2.2, 2.4); `environment` string + pattern `^[a-z0-9-]{1,12}$` + in `required` +
      `default === 'dev'` + non-empty title/description (3.1, 3.2, 3.4, 3.9); `dynamodb` boolean +
      `default === false` + non-empty title/description (4.1, 4.3, 4.5); `ecr` boolean +
      `default === false` + non-empty title/description (4.2, 4.4, 4.5).
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.4, 3.1, 3.2, 3.4, 3.9, 4.1, 4.2, 4.3, 4.4, 4.5_

- [x] 5. Add property-based tests over the parameter JSON Schemas
  - [x] 5.1 Write property test for the tenantName parameter schema
    - Add `fast-check` (+ `ajv`) to the test workspace via `yarn add` in the correct workspace if not
      already present; do not hand-edit `package.json`.
    - Extract the committed `tenantName` sub-schema from the loaded template and validate candidate
      values with `ajv` (matching rjsf JSON Schema semantics).
    - Generate a mix of arbitrary unicode strings, allowed-alphabet `[a-z0-9-]` strings of length
      `0..40`, whitespace-only strings, and strings with a disallowed character. Assert validation
      succeeds iff length ∈ `[1,32]` and every character is in `[a-z0-9-]`. Run 100+ iterations.
    - Tag with the comment `Feature: tenant-provisioning-template, Property 1: <property text>`.
    - **Property 1: Tenant name schema accepts exactly the valid names**
    - **Validates: Requirements 2.3, 2.4, 2.5, 2.6, 2.7**

  - [x] 5.2 Write property test for the environment parameter schema
    - Extract the committed `environment` sub-schema from the loaded template and validate candidate
      values with `ajv`.
    - Generate a mix of arbitrary unicode strings, allowed-alphabet `[a-z0-9-]` strings of length
      `0..20`, whitespace-only strings, and strings with a disallowed character. Assert validation
      succeeds iff length ∈ `[1,12]` and every character is in `[a-z0-9-]`. Run 100+ iterations.
    - Tag with the comment `Feature: tenant-provisioning-template, Property 2: <property text>`.
    - **Property 2: Environment schema accepts exactly the valid values**
    - **Validates: Requirements 3.4, 3.5, 3.6, 3.7, 3.8**

- [x] 6. Verify the entity and tests via yarn
  - Run scoped verification using the repo's root scripts: `yarn tsc` (typecheck), `yarn lint`
    (changed files), and `yarn test` (scoped to the touched workspace where possible) to confirm the
    template entity is valid and all structural and property tests pass.
  - _Requirements: 1.9_

- [~] 7. (Optional) Manual/e2e check of the template in the scaffolder UI
  - Optionally run `yarn start` locally and confirm the template appears in the scaffolder catalog and
    the form validation behaves as designed. This is a manual/e2e verification (framework behavior) and
    may be skipped for a code-only deliverable.
  - _Requirements: 1.7_

## Notes

- Tasks marked with `*` are optional (property tests in task 5 and the manual/e2e check in task 7) and
  can be skipped for a faster MVP; the core template, registration, and structural tests are not
  optional.
- Each task references specific requirements for traceability; property tasks additionally reference
  their design property number.
- The `show-inputs` step and `output.text` block keep the template runnable with no infrastructure
  side effects, consistent with the safety guidance around `apply`-style operations.
- Property tests validate the universal input rules over the committed parameter schemas; structural
  tests cover the deterministic single-artifact facts.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3"] },
    { "id": 2, "tasks": ["2.1"] },
    { "id": 3, "tasks": ["4.1", "5.1", "5.2"] }
  ]
}
```
