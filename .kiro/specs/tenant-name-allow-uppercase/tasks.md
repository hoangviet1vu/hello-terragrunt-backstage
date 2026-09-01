# Implementation Plan

- [x] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** - Uppercase tenant names are accepted
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate the bug exists at both the frontend `pattern` and the backend `TENANT_NAME_PATTERN`
  - **Scoped PBT Approach**: Generate random 1-32-character strings drawn from letters/digits/hyphens that contain at least one uppercase letter (`A-Z`); also include the concrete cases `MYCOMPANY`, `MyTenant`, `Tenant-01`, and `A` for reproducibility
  - Bug condition per design: `isBugCondition(input)` is true iff `input` matches `^[A-Za-z0-9-]{1,32}$` but does NOT match `^[a-z0-9-]{1,32}$` (length 1-32, only letters/digits/hyphens, at least one uppercase letter)
  - Frontend check: validate each bug-condition input against the `tenantName` schema extracted from the committed `templates/tenant-provisioning/template.yaml` (via ajv) and assert it is accepted
  - Backend check: run each bug-condition input through the `tenant:provision` action's zod input schema and fail-fast guard and assert no `tenantName` validation error occurs
  - The test assertions should match Property 1 (Expected Behavior): uppercase-containing names are accepted at both enforcement points
  - Run test on UNFIXED code
  - **EXPECTED OUTCOME**: Test FAILS (this is correct - it proves the bug exists)
  - Document counterexamples found (e.g. `MYCOMPANY` is rejected at the frontend `pattern` with `'Tenant name' must match pattern "^[a-z0-9-]{1,32}$"` and by the backend guard/schema) to confirm the root cause is the narrow `[a-z0-9-]` character class
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 1.1, 1.2, 2.1, 2.2_

- [x] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Non-uppercase validation outcomes are unchanged
  - **IMPORTANT**: Follow observation-first methodology - run the UNFIXED code first, record actual outputs, then assert those same outcomes
  - Scope per design: cover all inputs where `isBugCondition` returns false (every input that is NOT a 1-to-32-character letters/digits/hyphens string containing an uppercase letter)
  - Observe on UNFIXED code and assert the same accept/reject result after the fix:
    - Lowercase acceptance: `sampletenant`, `tenant-01`, and generated `^[a-z0-9-]{1,32}$` names are accepted (Req 3.1)
    - Empty/whitespace rejection: `''` and whitespace-only names are rejected (Req 3.2)
    - Over-length rejection: names longer than 32 characters (all-lowercase and mixed-case) are rejected (Req 3.3)
    - Disallowed-character rejection: names containing spaces, `_`, `.`, `/`, or unicode (e.g. `é`, `好`) are rejected (Req 3.4)
    - Environment/components: the `environment` enum (`dev`/`test`/`uat`/`prod`) and `components` selection validate and collect exactly as today (Req 3.5)
  - Write property-based tests capturing these observed patterns for both the frontend schema (ajv against committed `template.yaml`) and the backend `TENANT_NAME_PATTERN` (zod schema + fail-fast guard)
  - Property-based testing generates many test cases across the input domain (arbitrary unicode strings, allowed-alphabet strings of varying length including boundaries 1/32/33, whitespace-only strings, and strings with a spliced-in disallowed character) for stronger preservation guarantees
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (this confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 3. Fix for tenant name rejecting uppercase letters

  - [x] 3.1 Broaden the backend pattern and human-readable strings in `tenantProvision.ts`
    - Change `TENANT_NAME_PATTERN` from `/^[a-z0-9-]{1,32}$/` to `/^[A-Za-z0-9-]{1,32}$/` (keep anchors `^...$` and `{1,32}` length bound unchanged); both the zod schema and the fail-fast guard reference this single constant so they update together
    - Update the zod `.regex(...)` message and `.describe(...)` text from `^[a-z0-9-]{1,32}$` to `^[A-Za-z0-9-]{1,32}$`
    - Update the fail-fast guard thrown message `Invalid input 'tenantName': must match ^[a-z0-9-]{1,32}$` to `^[A-Za-z0-9-]{1,32}$`
    - _Bug_Condition: isBugCondition(input) — 1-32 chars of letters/digits/hyphens containing at least one uppercase letter (from design)_
    - _Expected_Behavior: Property 1 — backend TENANT_NAME_PATTERN accepts uppercase-containing names in both the zod schema and fail-fast guard (from design)_
    - _Preservation: Property 2 — all non-bug-condition validation outcomes unchanged (from design)_
    - _Requirements: 1.2, 2.2, 3.1, 3.2, 3.3, 3.4_

  - [x] 3.2 Broaden the frontend pattern and helper text in `template.yaml`
    - Change the `tenantName` `pattern` from `'^[a-z0-9-]{1,32}$'` to `'^[A-Za-z0-9-]{1,32}$'`
    - Update the `tenantName` `description` from "1-32 characters of lowercase letters, digits, and hyphens" to wording that includes uppercase (e.g. "1-32 characters of letters, digits, and hyphens")
    - _Bug_Condition: isBugCondition(input) — 1-32 chars of letters/digits/hyphens containing at least one uppercase letter (from design)_
    - _Expected_Behavior: Property 1 — frontend pattern matches uppercase-containing names so submission is allowed (from design)_
    - _Preservation: Property 2 — environment/components and all other frontend validation outcomes unchanged (from design)_
    - _Requirements: 1.1, 2.1, 3.5_

  - [x] 3.3 Update the related property tests to encode the new contract
    - In `packages/backend/src/tenantProvisioningTemplate.tenantName.property.test.ts`: broaden the oracle `ALLOWED_CHAR` from `/^[a-z0-9-]$/` to `/^[A-Za-z0-9-]$/`; update the guard assertion `tenantNameSchema.pattern === '^[a-z0-9-]{1,32}$'` to `'^[A-Za-z0-9-]{1,32}$'`; move `'A'` and `'Z'` out of the disallowed-character set (keep `'_'`, `'.'`, `'/'`, `' '`, `'é'`, `'好'`) and add uppercase letters to the allowed-alphabet generator
    - In `plugins/platform-backend-module-tenant-provisioning/src/actions/tenantProvision.failfast.test.ts`: broaden `VALID_TENANT_RE` from `/^[a-z0-9-]{1,32}$/` to `/^[A-Za-z0-9-]{1,32}$/` so `invalidTenantNameArb` no longer classifies uppercase-containing names as invalid, and update the accompanying comment that lists "uppercase" among invalid characters
    - Leave generators in `naming.branch.test.ts`, `naming.prtitle.test.ts`, `hcl.datadriven.test.ts`, `hcl.roundtrip.test.ts`, and `workspace.uniqueness.test.ts` unchanged (lowercase remains a subset of the broadened class, so they still produce valid names)
    - _Bug_Condition: isBugCondition(input) from design_
    - _Expected_Behavior: Property 1 — tests treat uppercase-containing names as valid (from design)_
    - _Preservation: Property 2 — tests still assert rejection of empty/whitespace/over-length/disallowed-character names (from design)_
    - _Requirements: 2.1, 2.2, 3.1, 3.2, 3.3, 3.4_

  - [x] 3.4 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - Uppercase tenant names are accepted
    - **IMPORTANT**: Re-run the SAME test from task 1 - do NOT write a new test
    - The test from task 1 encodes the expected behavior; when it passes it confirms uppercase-containing names are accepted at both the frontend schema and the backend pattern/guard
    - Run bug condition exploration test from task 1
    - **EXPECTED OUTCOME**: Test PASSES (confirms bug is fixed)
    - _Requirements: 2.1, 2.2_

  - [x] 3.5 Verify preservation tests still pass
    - **Property 2: Preservation** - Non-uppercase validation outcomes are unchanged
    - **IMPORTANT**: Re-run the SAME tests from task 2 - do NOT write new tests
    - Run preservation property tests from task 2
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions for lowercase acceptance, empty/whitespace/over-length/disallowed-character rejection, and environment/components)
    - Confirm all tests still pass after the fix (no regressions)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 4. Checkpoint - Ensure all tests pass
  - Run the relevant scoped suites (`yarn workspace backend test` and the tenant-provisioning plugin tests) plus `yarn tsc` and `yarn lint` on the touched files
  - Ensure all tests pass, ask the user if questions arise
