# Bugfix Requirements Document

## Introduction

The `environment` parameter in the tenant-provisioning Software Template
(`templates/tenant-provisioning/template.yaml`) is defined as a free-form string
validated only by the regex pattern `^[a-z0-9-]{1,12}$`, with a default of `dev`.
This allows a tenant to submit any arbitrary lowercase string (for example
`staging`, `production`, or `foo`) that passes validation but does not correspond
to a valid environment. Because the environment value is used as the subfolder
name and written to the `environment` Terragrunt input, an invalid value could
drive Terragrunt provisioning against a non-existent or invalid environment
folder.

The environment must instead be constrained to exactly one of four allowed
values — `dev`, `test`, `uat`, `prod` — presented as a constrained choice (an
enumerated dropdown) rather than a free-text field. The default remains `dev`.

## Bug Analysis

### Current Behavior (Defect)

The `environment` parameter is a free-text string field that accepts any value
matching the pattern `^[a-z0-9-]{1,12}$`.

1.1 WHEN a tenant enters an `environment` value that is not one of `dev`, `test`, `uat`, `prod` but matches the pattern `^[a-z0-9-]{1,12}$` (e.g. `staging`, `production`, `foo`) THEN the system accepts the value as valid
1.2 WHEN the form renders the `environment` parameter THEN the system presents a free-text input field that permits arbitrary lowercase strings rather than a constrained set of choices
1.3 WHEN an invalid `environment` value is accepted THEN the system propagates it to the `environment` Terragrunt input and subfolder name, which can target a non-existent or invalid environment folder

### Expected Behavior (Correct)

The `environment` parameter should only allow selection from the enumerated set
`{dev, test, uat, prod}`.

2.1 WHEN a tenant enters an `environment` value that is not one of `dev`, `test`, `uat`, `prod` THEN the system SHALL reject the value as invalid
2.2 WHEN the form renders the `environment` parameter THEN the system SHALL present a constrained choice (enum/dropdown) limited to `dev`, `test`, `uat`, and `prod`
2.3 WHEN a tenant selects one of `dev`, `test`, `uat`, or `prod` THEN the system SHALL accept the value and propagate it to the `environment` Terragrunt input and subfolder name

### Unchanged Behavior (Regression Prevention)

Existing valid behavior and the surrounding template inputs must be preserved.

3.1 WHEN the form is first rendered and the tenant has made no selection THEN the system SHALL CONTINUE TO default the `environment` value to `dev`
3.2 WHEN a tenant selects `dev` THEN the system SHALL CONTINUE TO accept it and treat it exactly as it does today
3.3 WHEN the tenant provides values for the other parameters (`tenantName`, `dynamodb`, `ecr`) THEN the system SHALL CONTINUE TO validate and collect them unchanged
3.4 WHEN the template collects and echoes the inputs (debug log and results output) THEN the system SHALL CONTINUE TO render the selected `environment` value unchanged

## Bug Condition Derivation

### Bug Condition Function

```pascal
FUNCTION isBugCondition(X)
  INPUT: X of type EnvironmentInput   // the environment string submitted via the template form
  OUTPUT: boolean

  // Buggy inputs: values that pass the current regex but are not in the allowed set
  RETURN matches(X, '^[a-z0-9-]{1,12}$')
         AND X NOT IN {'dev', 'test', 'uat', 'prod'}
END FUNCTION
```

### Property Specification (Fix Checking)

```pascal
// Property: Fix Checking - Environment enum validation
FOR ALL X WHERE isBugCondition(X) DO
  result ← validateEnvironment'(X)
  ASSERT result = REJECTED   // invalid environment values are rejected by the constrained enum
END FOR
```

### Preservation Goal (Preservation Checking)

```pascal
// Property: Preservation Checking
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT validateEnvironment(X) = validateEnvironment'(X)
  // In particular, X IN {'dev','test','uat','prod'} remains accepted,
  // and the 'dev' default is preserved.
END FOR
```

**Key Definitions:**
- **F** (`validateEnvironment`): environment handling before the fix — free-text validated only by `^[a-z0-9-]{1,12}$`.
- **F'** (`validateEnvironment'`): environment handling after the fix — a constrained enum limited to `{dev, test, uat, prod}` with default `dev`.
- **Counterexample**: submitting `environment = staging` currently passes validation (bug), but must be rejected after the fix.
