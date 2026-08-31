# Tenant Name Allow Uppercase Bugfix Design

## Overview

The tenant provisioning flow validates the "Tenant name" input against
`^[a-z0-9-]{1,32}$`. That character class only permits lowercase letters, so any
otherwise well-formed tenant name containing an uppercase letter (e.g.
`MYCOMPANY`, `MyTenant`) is rejected — first by the Scaffolder frontend form and,
if that were bypassed, by the backend `tenant:provision` action.

The fix broadens the character class at both enforcement points from
`[a-z0-9-]` to `[A-Za-z0-9-]`, keeping the anchors (`^...$`) and the length
bound (`{1,32}`) exactly as they are. This adds `A-Z` to the accepted set while
leaving every other acceptance and rejection unchanged: names already valid
today stay valid, and empty/whitespace-only names, names longer than 32
characters, and names containing other characters (spaces, underscores, dots,
symbols, unicode) are still rejected. The field's helper text (which says
"lowercase letters") is updated to describe the broadened set, and the related
property tests that currently treat uppercase as invalid are updated to treat it
as valid.

The two enforcement points must stay consistent, so both are changed together:

- Frontend: the `tenantName` parameter `pattern` in
  `templates/tenant-provisioning/template.yaml`.
- Backend: the `TENANT_NAME_PATTERN` constant in
  `plugins/platform-backend-module-tenant-provisioning/src/actions/tenantProvision.ts`,
  used by both the zod input schema and the fail-fast guard, along with the
  human-readable pattern strings embedded in the schema `describe`/error message
  and the fail-fast error message.

## Glossary

- **Bug_Condition (C)**: The condition that triggers the bug — a `tenantName`
  that is 1 to 32 characters of letters, digits, and hyphens and contains at
  least one uppercase letter (`A-Z`), which is rejected today.
- **Property (P)**: The desired behavior for inputs satisfying C — the tenant
  name is accepted as valid (frontend allows submission; backend schema and
  fail-fast guard pass and provisioning proceeds).
- **Preservation**: All validation outcomes for inputs that do NOT satisfy C
  must remain identical — every currently valid lowercase name stays valid, and
  every currently rejected name (empty, whitespace-only, too long, or containing
  characters outside letters/digits/hyphens) stays rejected. The `environment`
  and `components` parameters are unaffected.
- **TENANT_NAME_PATTERN**: The `RegExp` constant in `tenantProvision.ts`
  (`/^[a-z0-9-]{1,32}$/` today) used by both the zod input schema and the
  handler's fail-fast guard to validate `tenantName`.
- **tenantName pattern**: The JSON Schema `pattern` keyword
  (`'^[a-z0-9-]{1,32}$'` today) on the `tenantName` parameter in
  `template.yaml`, which the Scaffolder frontend (rjsf) enforces before
  submission.

## Bug Details

### Bug Condition

The bug manifests when a tenant enters a `tenantName` that is otherwise
well-formed (1 to 32 characters, each character a letter, digit, or hyphen) but
contains one or more uppercase letters. Both the frontend `pattern` and the
backend `TENANT_NAME_PATTERN` use the character class `[a-z0-9-]`, which excludes
`A-Z`, so the value fails validation even though it is a reasonable tenant name.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type string          // the candidate tenantName
  OUTPUT: boolean

  RETURN length(input) >= 1
         AND length(input) <= 32
         AND everyCharIn(input, LETTERS + DIGITS + HYPHEN)   // A-Z a-z 0-9 -
         AND containsAtLeastOneUppercase(input)              // at least one A-Z
END FUNCTION
```

In terms of the original and fixed patterns: `isBugCondition(input)` is true iff
`input` matches the fixed pattern `^[A-Za-z0-9-]{1,32}$` but does NOT match the
original pattern `^[a-z0-9-]{1,32}$`.

### Examples

- `MYCOMPANY` — expected: accepted (1-32 chars, all letters); actual: frontend
  blocks submission with `'Tenant name' must match pattern "^[a-z0-9-]{1,32}$"`.
- `MyTenant` — expected: accepted; actual: rejected (contains `M`, `T`).
- `Tenant-01` — expected: accepted (mixed case, digits, hyphen); actual:
  rejected (contains `T`).
- `A` — expected: accepted (single uppercase letter, length 1); actual:
  rejected.
- `sampletenant` — expected: accepted; actual: accepted (already valid, NOT a
  bug-condition input — included to anchor preservation).

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Every `tenantName` of 1 to 32 characters consisting only of lowercase letters,
  digits, and hyphens (e.g. `sampletenant`, `tenant-01`) must remain valid
  (Req 3.1).
- Empty and whitespace-only `tenantName` values must remain rejected (Req 3.2).
- `tenantName` values longer than 32 characters must remain rejected, including
  otherwise-valid character sets that exceed the length bound (Req 3.3).
- `tenantName` values containing characters outside letters, digits, and hyphens
  (spaces, underscores, dots, other symbols, unicode) must remain rejected
  (Req 3.4).
- The `environment` parameter (enum `dev`/`test`/`uat`/`prod`) and the
  `components` selection must be validated and collected exactly as today,
  unaffected by the tenant name change (Req 3.5).

**Scope:**
All inputs that do NOT satisfy the bug condition — i.e. every input that is not
a 1-to-32-character letters/digits/hyphens string containing an uppercase letter
— must produce exactly the same validation outcome (accept or reject) after the
fix as before it. This includes:
- All currently valid lowercase tenant names.
- Empty, whitespace-only, and over-length tenant names.
- Tenant names containing disallowed characters.
- The `environment` and `components` parameters.

**Note:** The expected correct behavior for bug-condition inputs (accept
uppercase-containing names) is defined in the Correctness Properties section
(Property 1).

## Hypothesized Root Cause

The root cause is well understood and confirmed by the requirements: the
character class in the validation pattern is too narrow. There is no ambiguity
about which function or selector is at fault — the same literal pattern appears
in two coordinated places.

1. **Narrow character class in the backend pattern**: `TENANT_NAME_PATTERN` in
   `tenantProvision.ts` is `/^[a-z0-9-]{1,32}$/`. The `[a-z0-9-]` class omits
   `A-Z`, so both the zod schema regex and the fail-fast guard reject
   uppercase-containing names.

2. **Narrow character class in the frontend pattern**: The `tenantName.pattern`
   in `template.yaml` is `'^[a-z0-9-]{1,32}$'`. rjsf enforces this in the browser
   and blocks submission before the request reaches the backend, producing the
   observed `must match pattern "^[a-z0-9-]{1,32}$"` error.

3. **Human-readable pattern strings duplicated alongside the regex**: The schema
   `.describe(...)`, the zod `.regex(...)` message, and the fail-fast `throw`
   message all embed the literal `^[a-z0-9-]{1,32}$`. These are not validation
   logic, but if left unchanged they would misdescribe the accepted set after
   the fix.

4. **Helper text describing "lowercase letters"**: The `tenantName.description`
   in `template.yaml` states the value must be "lowercase letters, digits, and
   hyphens", which would be inaccurate once uppercase is accepted.

## Correctness Properties

Property 1: Bug Condition - Uppercase tenant names are accepted

_For any_ input where the bug condition holds (isBugCondition returns true) — a
`tenantName` of 1 to 32 characters made up of letters, digits, and hyphens that
contains at least one uppercase letter — the fixed validation SHALL accept the
value: the frontend `pattern` matches (submission allowed) and the backend
`TENANT_NAME_PATTERN` matches in both the zod schema and the fail-fast guard
(input accepted, provisioning proceeds).

**Validates: Requirements 2.1, 2.2**

Property 2: Preservation - Non-uppercase validation outcomes are unchanged

_For any_ input where the bug condition does NOT hold (isBugCondition returns
false), the fixed validation SHALL produce the same accept/reject result as the
original validation, preserving acceptance of all currently valid lowercase
names and rejection of empty, whitespace-only, over-length, and
disallowed-character names, and leaving the `environment` and `components`
parameters unaffected.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**

## Fix Implementation

### Changes Required

Assuming our root cause analysis is correct, the fix broadens the character
class from `[a-z0-9-]` to `[A-Za-z0-9-]` at both enforcement points and updates
the accompanying human-readable text, keeping the anchors and `{1,32}` length
bound unchanged.

**File**: `plugins/platform-backend-module-tenant-provisioning/src/actions/tenantProvision.ts`

**Function/Constant**: `TENANT_NAME_PATTERN` and its consumers (the zod input
schema and the fail-fast guard)

**Specific Changes**:
1. **Broaden the regex constant**: Change `TENANT_NAME_PATTERN` from
   `/^[a-z0-9-]{1,32}$/` to `/^[A-Za-z0-9-]{1,32}$/`. Both the zod schema and
   the fail-fast guard reference this single constant, so they update together.

2. **Update the zod schema message and describe**: Change the `.regex(...)`
   message and the `.describe(...)` text from `^[a-z0-9-]{1,32}$` to
   `^[A-Za-z0-9-]{1,32}$` so the surfaced validation error and the schema
   description match the actual accepted set.

3. **Update the fail-fast guard error message**: Change the thrown
   `Invalid input 'tenantName': must match ^[a-z0-9-]{1,32}$` string to
   `^[A-Za-z0-9-]{1,32}$`.

**File**: `templates/tenant-provisioning/template.yaml`

**Parameter**: `tenantName`

**Specific Changes**:
4. **Broaden the frontend pattern**: Change `pattern: '^[a-z0-9-]{1,32}$'` to
   `pattern: '^[A-Za-z0-9-]{1,32}$'`.

5. **Update the helper text**: Change the `description` from "1-32 characters of
   lowercase letters, digits, and hyphens" to wording that includes uppercase
   (e.g. "1-32 characters of letters, digits, and hyphens").

**Related tests to update (so the suite encodes the new contract):**

6. **`packages/backend/src/tenantProvisioningTemplate.tenantName.property.test.ts`**:
   - Update the reference oracle `ALLOWED_CHAR` from `/^[a-z0-9-]$/` to
     `/^[A-Za-z0-9-]$/` so `isValidTenantName` treats uppercase as valid.
   - Update the guard assertion that expects
     `tenantNameSchema.pattern === '^[a-z0-9-]{1,32}$'` to the fixed pattern.
   - Update the generator that splices a "disallowed" character in: move `'A'`
     and `'Z'` out of the disallowed set (keep `'_'`, `'.'`, `'/'`, `' '`, `'é'`,
     `'好'`), and add uppercase letters to the allowed-alphabet generator so both
     the valid and bug-condition cases are exercised.

7. **`plugins/platform-backend-module-tenant-provisioning/src/actions/tenantProvision.failfast.test.ts`**:
   - Update `VALID_TENANT_RE` from `/^[a-z0-9-]{1,32}$/` to
     `/^[A-Za-z0-9-]{1,32}$/` so the `invalidTenantNameArb` filter no longer
     classifies uppercase-containing names as invalid, and update the
     accompanying comment that lists "uppercase" among invalid characters.

Other property tests reference `^[a-z0-9-]{1,32}$` only to generate *valid*
tenant names from a lowercase alphabet (`naming.branch.test.ts`,
`naming.prtitle.test.ts`, `hcl.datadriven.test.ts`, `hcl.roundtrip.test.ts`,
`workspace.uniqueness.test.ts`). Those generators still produce valid names
under the broadened pattern (lowercase is a subset of the new class), so they do
not require changes for correctness; they may optionally be extended to include
uppercase, but that is not necessary to keep them passing.

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface
counterexamples that demonstrate the bug on the unfixed patterns, then verify
the fix accepts uppercase-containing names and preserves every other validation
outcome. Both the frontend JSON Schema `pattern` (validated with ajv against the
committed `template.yaml`) and the backend `TENANT_NAME_PATTERN` (validated
through the action's zod schema and fail-fast guard) are exercised.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing
the fix. Confirm or refute the root cause analysis (narrow character class). If
we refute, we will need to re-hypothesize.

**Test Plan**: Write tests that feed uppercase-containing but otherwise
well-formed tenant names to both enforcement points — validate them against the
committed frontend schema with ajv, and run them through the action handler's
fail-fast guard — and assert they are accepted. Run these on the UNFIXED code to
observe the rejections and confirm the character class is the cause.

**Test Cases**:
1. **Frontend all-uppercase**: Validate `MYCOMPANY` against the extracted
   `tenantName` schema (will fail on unfixed code).
2. **Frontend mixed-case**: Validate `MyTenant` and `Tenant-01` against the
   schema (will fail on unfixed code).
3. **Backend all-uppercase**: Run the handler with `tenantName = 'MYCOMPANY'`
   and assert no `tenantName` validation error (will fail on unfixed code).
4. **Single uppercase edge**: Validate `A` (length 1) at both points (will fail
   on unfixed code).

**Expected Counterexamples**:
- Uppercase-containing names are rejected at both the frontend `pattern` and the
  backend guard/schema.
- Cause: the `[a-z0-9-]` character class excludes `A-Z`.

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed
validation accepts the tenant name.

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  ASSERT frontendSchemaAccepts(input)                    // fixed pattern
  ASSERT backendSchemaAccepts(input)                     // fixed TENANT_NAME_PATTERN
  ASSERT backendFailFastGuardPasses(input)
END FOR
```

Equivalently: for every `input` matching `^[A-Za-z0-9-]{1,32}$` that contains at
least one `A-Z`, both the frontend schema and the backend pattern must match.

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the
fixed validation produces the same accept/reject result as the original
validation.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT frontendSchemaAccepts_original(input) = frontendSchemaAccepts_fixed(input)
  ASSERT backendPattern_original.test(input)  = backendPattern_fixed.test(input)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation
checking because:
- It generates many test cases automatically across the input domain (arbitrary
  unicode strings, allowed-alphabet strings of varying length, whitespace-only
  strings, and strings with a spliced-in disallowed character).
- It catches edge cases (length boundaries at 1, 32, 33; single disallowed
  character) that manual unit tests might miss.
- It provides a strong guarantee that acceptance/rejection is unchanged for
  every non-bug-condition input.

The formal equivalence that makes preservation easy to reason about: for any
input NOT satisfying the bug condition, `^[A-Za-z0-9-]{1,32}$` and
`^[a-z0-9-]{1,32}$` agree — they differ only on inputs that satisfy the bug
condition (length 1-32, letters/digits/hyphens, at least one uppercase).

**Test Plan**: Observe behavior on UNFIXED code first for lowercase-valid,
empty/whitespace, over-length, and disallowed-character names, then keep
property-based tests asserting those same outcomes hold after the fix. Update
the oracles/generators that currently encode "uppercase is invalid" so they
encode "uppercase is valid" while leaving all other classifications intact.

**Test Cases**:
1. **Lowercase acceptance preservation**: Observe that `sampletenant`,
   `tenant-01`, and generated `[a-z0-9-]{1,32}` names are accepted on unfixed
   code; assert they remain accepted after the fix.
2. **Empty/whitespace rejection preservation**: Observe that `''` and
   whitespace-only names are rejected on unfixed code; assert they remain
   rejected.
3. **Over-length rejection preservation**: Observe that names longer than 32
   characters (including all-lowercase and mixed-case) are rejected; assert they
   remain rejected.
4. **Disallowed-character rejection preservation**: Observe that names with
   spaces, `_`, `.`, `/`, or unicode are rejected; assert they remain rejected.
5. **Environment/components preservation**: Observe that the `environment` enum
   and `components` selection validate as today; assert unchanged.

### Unit Tests

- Assert the committed frontend `tenantName` pattern equals
  `^[A-Za-z0-9-]{1,32}$` (guard that the schema under test is the fixed one).
- Assert `MYCOMPANY`, `MyTenant`, `Tenant-01`, and `A` are accepted at both
  enforcement points.
- Assert `sampletenant` and `tenant-01` remain accepted.
- Assert `''`, `'   '`, a 33-character name, and names with `_`/`.`/space/unicode
  remain rejected, with the backend surfacing a `tenantName` validation error and
  performing no side effect.

### Property-Based Tests

- Bug condition: generate random 1-32-character letters/digits/hyphens strings
  containing at least one uppercase letter and assert both the frontend schema
  and the backend pattern accept them.
- Preservation (frontend): reuse the ajv-vs-oracle property in
  `tenantProvisioningTemplate.tenantName.property.test.ts` with the oracle's
  `ALLOWED_CHAR` broadened to `[A-Za-z0-9-]`, asserting validation succeeds iff
  length in [1,32] and every character is in the broadened class.
- Preservation (backend): keep the `tenantProvision.failfast.test.ts` property
  asserting invalid names are rejected with a `tenantName` error and no side
  effects, with `VALID_TENANT_RE` broadened so uppercase names are no longer
  generated as "invalid".

### Integration Tests

- Run the `tenant:provision` action end-to-end (with the side-effecting
  collaborators mocked) using an uppercase-containing tenant name and confirm it
  passes the fail-fast guard and proceeds into the provisioning flow.
- Confirm switching `environment` values and toggling `components` still behaves
  as before when the tenant name contains uppercase letters.
- Confirm the surfaced validation error message for a genuinely invalid name now
  reads `^[A-Za-z0-9-]{1,32}$`, matching the broadened pattern.
