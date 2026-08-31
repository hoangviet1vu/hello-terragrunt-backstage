# Bugfix Requirements Document

## Introduction

The "Tenant name" parameter in the tenant provisioning Software Template rejects
tenant names that contain uppercase letters. The parameter is validated against
the pattern `^[a-z0-9-]{1,32}$`, which only permits lowercase letters (`a-z`),
digits (`0-9`), and hyphens (`-`), for a length of 1 to 32 characters. When a
tenant enters a value that includes uppercase letters (for example `MYCOMPANY`
or `MyTenant`), the Scaffolder frontend blocks submission with a validation
error: `'Tenant name' must match pattern "^[a-z0-9-]{1,32}$"`.

The same pattern is enforced in two places that must be kept consistent:

- The frontend form parameter `tenantName` in
  `templates/tenant-provisioning/template.yaml`.
- The backend `tenant:provision` action in
  `plugins/platform-backend-module-tenant-provisioning/src/actions/tenantProvision.ts`,
  where `TENANT_NAME_PATTERN` (`/^[a-z0-9-]{1,32}$/`) is used both in the input
  schema and in the fail-fast guard.

The desired behavior is for the tenant name to accept uppercase letters (`A-Z`)
in addition to the currently allowed characters, while continuing to accept all
tenant names that are already valid today and continuing to reject names that
violate the length limit or contain other disallowed characters.

## Bug Analysis

### Current Behavior (Defect)

The tenant name is validated by the pattern `^[a-z0-9-]{1,32}$`, so any tenant
name containing at least one uppercase letter fails validation, even when it is
otherwise well-formed (1 to 32 characters made up only of letters, digits, and
hyphens).

1.1 WHEN a tenant enters a `tenantName` containing one or more uppercase letters (e.g. `MYCOMPANY`) that is otherwise 1 to 32 characters of letters, digits, and hyphens THEN the Scaffolder frontend blocks submission and displays the validation error `'Tenant name' must match pattern "^[a-z0-9-]{1,32}$"`

1.2 WHEN the `tenant:provision` action receives a `tenantName` containing one or more uppercase letters that is otherwise 1 to 32 characters of letters, digits, and hyphens THEN the action rejects the input as invalid (schema regex and fail-fast guard fail with `must match ^[a-z0-9-]{1,32}$`) and performs no side effect

### Expected Behavior (Correct)

The tenant name should accept uppercase letters as well, so a name of 1 to 32
characters made up of uppercase letters, lowercase letters, digits, and hyphens
is treated as valid.

2.1 WHEN a tenant enters a `tenantName` containing one or more uppercase letters that is otherwise 1 to 32 characters of letters, digits, and hyphens (e.g. `MYCOMPANY`) THEN the Scaffolder frontend SHALL accept the value and allow submission without a validation error

2.2 WHEN the `tenant:provision` action receives a `tenantName` containing one or more uppercase letters that is otherwise 1 to 32 characters of letters, digits, and hyphens THEN the action SHALL accept the input as valid (schema regex and fail-fast guard pass) and proceed with provisioning

### Unchanged Behavior (Regression Prevention)

Every tenant name that is valid today must remain valid, and names that are
invalid for reasons other than uppercase letters must still be rejected.

3.1 WHEN a tenant enters a `tenantName` of 1 to 32 characters consisting only of lowercase letters, digits, and hyphens (e.g. `sampletenant`) THEN the system SHALL CONTINUE TO accept the value as valid

3.2 WHEN a tenant enters a `tenantName` that is empty or whitespace-only THEN the system SHALL CONTINUE TO reject the value as invalid

3.3 WHEN a tenant enters a `tenantName` longer than 32 characters THEN the system SHALL CONTINUE TO reject the value as invalid

3.4 WHEN a tenant enters a `tenantName` containing characters outside letters, digits, and hyphens (e.g. spaces, underscores, dots, or other symbols) THEN the system SHALL CONTINUE TO reject the value as invalid

3.5 WHEN the `environment` and `components` parameters are submitted THEN the system SHALL CONTINUE TO validate and collect them exactly as today, unaffected by the tenant name change
