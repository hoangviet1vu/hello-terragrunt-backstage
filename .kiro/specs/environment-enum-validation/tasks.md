# Implementation Plan

- [x] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** - Invalid Environment Values Are Rejected
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate out-of-set `environment` values are accepted
  - **Scoped PBT Approach**: Generate random strings matching `^[a-z0-9-]{1,12}$` that are NOT in `{dev, test, uat, prod}`; also cover the concrete deterministic counterexamples `staging`, `production`, `foo`
  - Load the `environment` parameter schema from `templates/tenant-provisioning/template.yaml` (`spec.parameters[0].properties.environment`) and validate candidate values against it with a JSON Schema validator that mirrors the scaffolder's validation
  - Assert (Bug Condition from design): for all X where `isBugCondition(X)` holds — `matches(X, '^[a-z0-9-]{1,12}$')` AND `X NOT IN {dev, test, uat, prod}` — the schema REJECTS X (Expected Behavior: value not accepted / not selectable)
  - Add an assertion that the schema exposes a constrained choice (`enum`) rather than a `pattern`/free-text control (Requirement 2.2)
  - Run test on UNFIXED code
  - **EXPECTED OUTCOME**: Test FAILS (this is correct - it proves the bug exists; out-of-set values are accepted and the field is free-text)
  - Document counterexamples found (e.g. "`environment = staging` is accepted instead of rejected", "`environment = production` is accepted", "`environment = foo` is accepted", "schema declares `pattern` not `enum`")
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 2.1, 2.2, 2.3_

- [x] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Valid Environments, Default, and Other Inputs Unchanged
  - **IMPORTANT**: Follow observation-first methodology - observe behavior on UNFIXED schema first, then encode it
  - Observe: `dev`, `test`, `uat`, `prod` are each accepted by the unfixed `environment` schema
  - Observe: the unfixed `environment` schema declares `default: dev`
  - Observe: `tenantName` (pattern `^[a-z0-9-]{1,32}$`), `dynamodb` (boolean, default false), and `ecr` (boolean, default false) validate and collect correctly on unfixed code
  - Observe: the `debug:log` step and `output.text` block echo the selected `environment` (and other inputs) on unfixed code
  - Write property-based tests capturing observed behavior for all X where `isBugCondition(X)` does NOT hold (Preservation Requirements from design):
    - For all draws from `{dev, test, uat, prod}`, the value is accepted (identical to unfixed schema)
    - `default: dev` is present and unchanged
    - For random valid `tenantName`/`dynamodb`/`ecr` combinations, acceptance/validation is identical before the fix
    - The `debug:log` step and `output.text` block still reference and echo `${{ parameters.environment }}` unchanged
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (this confirms the baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [x] 3. Fix for free-text environment parameter (constrain to enum)

  - [x] 3.1 Implement the fix
    - In `templates/tenant-provisioning/template.yaml` at `spec.parameters[0].properties.environment`, remove the `pattern: '^[a-z0-9-]{1,12}$'` constraint and add `enum: [dev, test, uat, prod]` (keep `type: string`)
    - Keep `default: dev` unchanged (`dev` is a member of the new enum)
    - Update the `environment` field `description` to state the value must be one of `dev`, `test`, `uat`, `prod` (replace the "1-12 characters of lowercase letters, digits, and hyphens" wording)
    - Leave `tenantName`, `dynamodb`, `ecr`, the `required` list (still includes `environment`), the `debug:log` step, and the `output.text` block untouched
    - _Bug_Condition: isBugCondition(input) = matches(input, '^[a-z0-9-]{1,12}$') AND input NOT IN {dev, test, uat, prod} (from design)_
    - _Expected_Behavior: expectedBehavior(result) — value outside {dev, test, uat, prod} is REJECTED and the field renders as a constrained enum dropdown (from design Property 1)_
    - _Preservation: Preservation Requirements from design — `dev` default preserved, valid values accepted, other parameters and outputs unchanged_
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 3.2 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - Invalid Environment Values Are Rejected
    - **IMPORTANT**: Re-run the SAME test from task 1 - do NOT write a new test
    - The test from task 1 encodes the expected behavior; when it passes it confirms out-of-set values are rejected and the field is a constrained enum
    - Run bug condition exploration test from step 1
    - **EXPECTED OUTCOME**: Test PASSES (confirms the bug is fixed)
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 3.3 Verify preservation tests still pass
    - **Property 2: Preservation** - Valid Environments, Default, and Other Inputs Unchanged
    - **IMPORTANT**: Re-run the SAME tests from task 2 - do NOT write new tests
    - Run preservation property tests from step 2
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions — `dev` default, valid environments, and `tenantName`/`dynamodb`/`ecr` plus outputs unchanged)
    - Confirm all tests still pass after the fix (no regressions)
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [x] 4. Checkpoint - Ensure all tests pass
  - Run the relevant test/lint/typecheck commands scoped to what was touched (e.g. `yarn workspace backend test`, or the workspace where the schema tests live), plus `yarn lint` on changed files
  - Ensure all tests pass, ask the user if questions arise
