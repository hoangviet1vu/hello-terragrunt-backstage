# Environment Enum Validation Bugfix Design

## Overview

The `environment` parameter in the tenant-provisioning Software Template
(`templates/tenant-provisioning/template.yaml`) is currently a free-text string
validated only by the regex pattern `^[a-z0-9-]{1,12}$`, with `default: dev`.
This permits any lowercase string (e.g. `staging`, `production`, `foo`) to pass
validation even though only four environments are valid. Because the value is
used as the environment subfolder name and written to the `environment`
Terragrunt input, an invalid value can drive provisioning against a non-existent
or invalid environment folder.

The fix constrains the `environment` parameter to a fixed enumerated set —
`dev`, `test`, `uat`, `prod` — rendered as a dropdown rather than a free-text
field, while keeping `default: dev`. This is a declarative change to the
template's parameter schema (JSON Schema `enum` in place of `pattern`); no
scaffolder action code changes are involved, and no Git/Terragrunt/Terraform/AWS
side effects are introduced. The fix is targeted and minimal: it narrows the set
of accepted values and leaves every other parameter, step, and output untouched.

## Glossary

- **Bug_Condition (C)**: The condition that triggers the bug — an `environment`
  value that matches the old pattern `^[a-z0-9-]{1,12}$` but is not one of the
  four allowed values.
- **Property (P)**: The desired behavior — any environment value outside
  `{dev, test, uat, prod}` is rejected, and the form presents a constrained
  dropdown limited to those four values.
- **Preservation**: Existing behavior that must remain unchanged — the `dev`
  default, acceptance of the four valid values, and the collection/validation of
  the other parameters (`tenantName`, `dynamodb`, `ecr`) and the debug-log and
  results outputs.
- **environment parameter**: The `environment` property under
  `spec.parameters[0].properties` in
  `templates/tenant-provisioning/template.yaml` that the scaffolder form renders
  and validates.
- **allowed set**: The four valid environment values `{dev, test, uat, prod}`.
- **validateEnvironment (F)**: Environment handling before the fix — free-text
  validated only by `^[a-z0-9-]{1,12}$`.
- **validateEnvironment' (F')**: Environment handling after the fix — a
  constrained `enum` limited to `{dev, test, uat, prod}` with `default: dev`.

## Bug Details

### Bug Condition

The bug manifests when a tenant submits an `environment` value that passes the
current regex validation but is not a real environment. The `environment`
parameter schema is defined with a permissive `pattern` (`^[a-z0-9-]{1,12}$`)
instead of a bounded `enum`, so the Backstage scaffolder form accepts and
propagates values that lie outside the allowed set. In short, the parameter's
value space is too wide: it admits any short lowercase-hyphen string rather than
the four intended choices.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type EnvironmentInput   // the environment string submitted via the template form
  OUTPUT: boolean

  RETURN matches(input, '^[a-z0-9-]{1,12}$')
         AND input NOT IN {'dev', 'test', 'uat', 'prod'}
END FUNCTION
```

### Examples

- `environment = staging` — expected: rejected (not a valid environment);
  actual: accepted, matches `^[a-z0-9-]{1,12}$`, propagated to Terragrunt input
  and subfolder name.
- `environment = production` — expected: rejected; actual: accepted (would
  target a `production` subfolder that does not exist as a valid environment).
- `environment = foo` — expected: rejected; actual: accepted and propagated.
- `environment = dev` — expected: accepted (edge case: valid value must remain
  accepted); actual: accepted. This input is NOT a bug condition and must be
  preserved.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- The `environment` parameter must continue to default to `dev` when the tenant
  makes no selection.
- The value `dev` (and the other valid values `test`, `uat`, `prod`) must
  continue to be accepted and propagated to the `environment` Terragrunt input
  and subfolder name exactly as today.
- The other parameters (`tenantName` with its `^[a-z0-9-]{1,32}$` pattern,
  `dynamodb`, `ecr`) must continue to be rendered, validated, and collected
  unchanged.
- The `debug:log` step and the `output.text` results block must continue to echo
  the selected `environment` value (and the other inputs) unchanged.

**Scope:**
All inputs that do NOT involve an out-of-set environment value should be
completely unaffected by this fix. This includes:
- Any submission whose `environment` is one of `dev`, `test`, `uat`, `prod`.
- All values for the non-environment parameters (`tenantName`, `dynamodb`,
  `ecr`).
- The template's steps and outputs, which reference but do not constrain the
  environment value.

**Note:** The actual expected correct behavior for buggy inputs is defined in the
Correctness Properties section (Property 1). This section focuses on what must
NOT change.

## Hypothesized Root Cause

Based on the bug description, the most likely issues are:

1. **Overly permissive value space (primary cause)**: The `environment` property
   uses a JSON Schema `pattern` (`^[a-z0-9-]{1,12}$`) that validates *shape*
   (lowercase letters, digits, hyphens, 1-12 chars) rather than *membership* in
   a fixed set. Any short lowercase-hyphen string therefore validates, including
   invalid environments like `staging` or `production`.

2. **Wrong schema construct for a closed choice**: A closed set of four options
   should be modeled as a JSON Schema `enum`, which Backstage renders as a
   dropdown and validates by exact membership. Using `pattern` both allows
   invalid input and presents the wrong UI control (free-text vs. constrained
   choice).

3. **No enumeration of valid environments anywhere in the schema**: Because the
   allowed set is not encoded in the template, there is no single source of truth
   the form can validate against, so validation cannot reject out-of-set values.

The root cause is fundamentally a schema-modeling defect (declarative
validation), not a defect in scaffolder action logic — the template does not yet
execute any Terragrunt/Git side effects.

## Correctness Properties

Property 1: Bug Condition - Invalid Environment Values Are Rejected

_For any_ input where the bug condition holds (isBugCondition returns true) — an
`environment` value that matches `^[a-z0-9-]{1,12}$` but is not in
`{dev, test, uat, prod}` — the fixed template SHALL reject the value as invalid
(the constrained `enum` does not accept it) and SHALL present the environment
field as a dropdown limited to the four allowed values so such a value cannot be
submitted.

**Validates: Requirements 2.1, 2.2, 2.3**

Property 2: Preservation - Valid Environments, Default, and Other Inputs Unchanged

_For any_ input where the bug condition does NOT hold (isBugCondition returns
false) — including the four valid environment values, the absence of a selection
(default `dev`), and all values for `tenantName`, `dynamodb`, and `ecr` — the
fixed template SHALL produce the same result as the original template, preserving
the `dev` default, acceptance and propagation of valid environments, and the
validation, collection, and echoing of every other input.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4**

## Fix Implementation

### Changes Required

Assuming our root cause analysis is correct:

**File**: `templates/tenant-provisioning/template.yaml`

**Location**: `spec.parameters[0].properties.environment`

**Specific Changes**:
1. **Replace `pattern` with `enum`**: Remove the
   `pattern: '^[a-z0-9-]{1,12}$'` constraint and add
   `enum: [dev, test, uat, prod]` so the value space is exactly the four allowed
   environments. The property remains `type: string`.

2. **Preserve the default**: Keep `default: dev` unchanged so the first render
   still defaults to `dev` (Requirement 3.1). `dev` is a member of the new
   `enum`, so the default remains valid.

3. **Render as a constrained choice**: With `enum` present, Backstage's
   scaffolder renders a dropdown automatically. Optionally add
   `enumNames: [dev, test, uat, prod]` (or `ui:widget: select`) only if a
   distinct display label is desired; not required for correctness. Keep this
   minimal to avoid altering unrelated UI behavior.

4. **Update the description**: Adjust the `environment` field description to
   state that it must be one of `dev`, `test`, `uat`, `prod` (replacing the
   "1-12 characters of lowercase letters, digits, and hyphens" wording that
   described the old pattern), so the documented contract matches the new
   validation.

5. **Leave everything else untouched**: Do not change `tenantName`, `dynamodb`,
   `ecr`, the `required` list (which still includes `environment`), the
   `debug:log` step, or the `output.text` block. These references to
   `${{ parameters.environment }}` continue to work with an enum-constrained
   value.

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples
that demonstrate the bug on unfixed code, then verify the fix works correctly and
preserves existing behavior. Because the fix is a declarative change to a
Backstage template's JSON Schema, tests validate the parameter schema (and its
rendering/validation behavior) rather than a runtime function.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing
the fix. Confirm or refute the root cause analysis. If we refute, we will need to
re-hypothesize.

**Test Plan**: Load the template's `environment` parameter schema and validate
candidate values against it (using a JSON Schema validator that mirrors the
scaffolder's validation, or by inspecting the rendered form control). Run these
checks on the UNFIXED schema to observe that out-of-set values are accepted.

**Test Cases**:
1. **Invalid short string (`staging`)**: Validate `environment = staging` against
   the schema — accepted on unfixed code (will fail the desired assertion that it
   is rejected).
2. **Invalid word (`production`)**: Validate `environment = production` — accepted
   on unfixed code (will fail).
3. **Invalid token (`foo`)**: Validate `environment = foo` — accepted on unfixed
   code (will fail).
4. **UI control shape (edge case)**: Inspect the `environment` schema — on
   unfixed code it exposes a `pattern`/free-text field rather than an `enum`
   dropdown (will fail the assertion that a constrained choice is presented).

**Expected Counterexamples**:
- Out-of-set values matching `^[a-z0-9-]{1,12}$` pass validation instead of being
  rejected.
- Possible causes: use of `pattern` instead of `enum`, value space validating
  shape rather than membership, no enumeration of valid environments in the
  schema.

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed
template produces the expected behavior (the value is rejected / not selectable).

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  result := validateEnvironment_fixed(input)
  ASSERT result = REJECTED
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the
fixed template produces the same result as the original template.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT validateEnvironment_original(input) = validateEnvironment_fixed(input)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation
checking because:
- It generates many test cases automatically across the input domain (both valid
  environment values and arbitrary values for the other parameters).
- It catches edge cases that manual unit tests might miss.
- It provides strong guarantees that behavior is unchanged for all non-buggy
  inputs.

**Test Plan**: Observe behavior on the UNFIXED schema first for the four valid
values, the default, and the other parameters, then write property-based tests
capturing that behavior and assert it is unchanged after the fix.

**Test Cases**:
1. **Valid environments preserved**: Observe that `dev`, `test`, `uat`, `prod`
   are accepted on unfixed code, then verify they remain accepted after the fix.
2. **Default preserved**: Observe that the schema defaults to `dev` on unfixed
   code, then verify `default: dev` is unchanged after the fix.
3. **Other parameters preserved**: Observe that `tenantName` (pattern
   `^[a-z0-9-]{1,32}$`), `dynamodb`, and `ecr` validate/collect correctly on
   unfixed code, then verify they are unchanged after the fix.
4. **Outputs preserved**: Observe that the `debug:log` step and `output.text`
   block echo the selected `environment` on unfixed code, then verify they render
   the value unchanged after the fix.

### Unit Tests

- Assert the `environment` schema declares `enum: [dev, test, uat, prod]` and no
  longer declares the old `pattern`.
- Assert each of `dev`, `test`, `uat`, `prod` validates as accepted.
- Assert representative out-of-set values (`staging`, `production`, `foo`) are
  rejected.
- Assert `default: dev` is present and is a member of the enum.
- Assert `tenantName`, `dynamodb`, and `ecr` schemas are unchanged.

### Property-Based Tests

- Generate random strings matching `^[a-z0-9-]{1,12}$` but not in the allowed
  set and verify every one is rejected by the fixed schema (Fix Checking /
  Property 1).
- Generate random draws from `{dev, test, uat, prod}` and verify every one is
  accepted, identically to the unfixed schema (Preservation / Property 2).
- Generate random valid `tenantName`/`dynamodb`/`ecr` combinations and verify
  their acceptance is identical before and after the fix (Preservation).

### Integration Tests

- Render the full tenant-provisioning form and confirm the `environment` control
  is a dropdown offering exactly `dev`, `test`, `uat`, `prod` with `dev`
  preselected.
- Complete the template end-to-end selecting each valid environment and confirm
  the `debug:log` step and results output echo the chosen value.
- Attempt to drive the template with an out-of-set `environment` value and
  confirm the form does not accept it (no submission with an invalid value
  reaches the steps).
