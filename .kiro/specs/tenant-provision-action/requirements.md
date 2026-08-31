# Requirements Document

## Introduction

This feature implements the **backend provisioning behavior** that the `tenant-provisioning-template`
spec explicitly deferred as out of scope. That earlier spec covers only the frontend input form
(tenant name, environment, and which optional components to enable). This feature adds the custom
Backstage scaffolder action that consumes those validated parameters and performs the actual work:
clone the tenant "live" repository, render (create or update) the tenant's `terragrunt.hcl`, commit
the change on a new branch, push it, and open a pull request against the live repository's base
branch. The workflow ends at the pull request.

The action is named `tenant:provision`, following Backstage's `namespace:verb` action-id convention.
It is delivered as the scaffolder-action implementation of the already-scaffolded backend module
`@internal/backstage-plugin-platform-backend-module-tenant-provisioning` (which currently only logs
"Hello World"), registered in `packages/backend/src/index.ts`. The existing
`templates/tenant-provisioning/template.yaml` wires this action into its `spec.steps` in place of the
current `debug:log` placeholder.

**In scope:** the `tenant:provision` action's inputs, cloning the live repo at the configured ref,
rendering/creating/updating `terragrunt.hcl` at `<tenant-name>/<environment>/terragrunt.hcl`,
timestamped branch creation, commit, push, pull-request creation, temporary-file cleanup (including
on failure), secret handling, and error handling for validation/git/network failures.

**Out of scope:** the parameter form and its field-level validation (owned by
`tenant-provisioning-template`); running `terragrunt plan`/`apply` or any Terraform/AWS execution;
any destroy/de-provisioning workflow. The pull request is the hard boundary — this feature performs
**no** `terragrunt apply`-equivalent, cost-affecting, or otherwise irreversible infrastructure
operation, and does not do so in tests or CI.

The generated configuration shape (an `include "root"` block, a `terraform { source = ... }` block
sourced from `TERRAGRUNT_MODULE_SOURCE`, and an `inputs = { tenant_name, environment, ...
enable_<component> }` block) follows the design documented in the plugin README. The
`enable_<component>` inputs are produced by expanding the tenant's selected components against the
configured set of allowed components (for example `enable_dynamodb` and `enable_ecr`), so every
allowed component appears set to `true` when selected and `false` otherwise.

## Glossary

- **Provision_Action**: The custom Backstage scaffolder action, registered with the action id
  `tenant:provision`, that performs the provisioning workflow described by this document.
- **Provisioning_Module**: The Backstage backend module
  (`@internal/backstage-plugin-platform-backend-module-tenant-provisioning`) that registers the
  Provision_Action and is added in `packages/backend/src/index.ts`.
- **Scaffolder_Backend**: The Backstage scaffolder backend that executes a Template's steps,
  including the Provision_Action.
- **Template**: The `tenant-provisioning-template` `scaffolder.backstage.io/v1beta3` Template entity
  whose `spec.steps` invoke the Provision_Action.
- **Tenant_Name**: The tenant identifier supplied by the Template parameters, written to the
  `tenant_name` Terragrunt input and used as the top-level folder name in the Tenant_Live_Repo.
- **Environment**: The deployment environment supplied by the Template parameters, written to the
  `environment` Terragrunt input and used as the subfolder name under the tenant folder. Environment
  is one of the fixed values `dev`, `test`, `uat`, or `prod`.
- **Allowed_Components**: The configured set of valid component names the Provision_Action
  recognizes, read from the `tenantProvisioning.components` (or equivalent) app-config list.
  `dynamodb` and `ecr` are the Allowed_Components today; new components are added by extending this
  configuration, without changing the Provision_Action's code.
- **Selected_Components**: The array of component names the user selected in the Template's
  multi-select components parameter for a single execution; a subset of the Allowed_Components.
- **Component_Flag**: A single Allowed_Component's boolean entry within the Component_Set, mapping to
  an `enable_<component>` entry in the Terragrunt `inputs` block and defaulting to `false`.
- **Component_Set**: The complete `enable_<component>` mapping the Provision_Action renders for one
  execution, formed by expanding the Selected_Components against the Allowed_Components so that every
  Allowed_Component is present with value `true` when it is in Selected_Components and `false`
  otherwise.
- **Tenant_Live_Repo**: The Git repository holding tenant Terragrunt configuration, identified by the
  `TENANT_LIVE_REPO_URL` configuration value, with layout
  `<tenant-name>/<environment>/terragrunt.hcl`.
- **Live_Repo_Base_Branch**: The branch of the Tenant_Live_Repo that the Provision_Action clones from
  and opens the pull request against, identified by the `TENANT_LIVE_REPO_BRANCH` configuration value.
- **Module_Source**: The Terraform module source string written into the generated `terraform`
  block's `source` attribute, identified by the `TERRAGRUNT_MODULE_SOURCE` configuration value.
- **Terragrunt_File**: The generated `terragrunt.hcl` file at
  `<Tenant_Name>/<Environment>/terragrunt.hcl` within a checkout of the Tenant_Live_Repo.
- **Feature_Branch**: The new branch created by the Provision_Action, named
  `devops/<Tenant_Name>-<Environment>-<yyyymmdd-hhmmss>`.
- **Working_Directory**: The temporary directory into which the Provision_Action clones the
  Tenant_Live_Repo and performs all file operations for a single execution.
- **Git_Token**: The GitHub Personal Access Token (`GITHUB_TOKEN`) used to authenticate clone, push,
  and pull-request operations against the Tenant_Live_Repo.
- **Secret_Value**: Any sensitive configuration value, specifically the Git_Token and any AWS
  credentials available to the Scaffolder_Backend process.

## Requirements

### Requirement 1: Register the `tenant:provision` scaffolder action

**User Story:** As a platform operator, I want a `tenant:provision` scaffolder action registered in the backend, so that the tenant-provisioning Template can invoke provisioning as a workflow step.

#### Acceptance Criteria

1. THE Provisioning_Module SHALL register a scaffolder action with the action id `tenant:provision`.
2. WHEN the Scaffolder_Backend starts with the Provisioning_Module added in the backend, THE Scaffolder_Backend SHALL make the `tenant:provision` action available to Templates.
3. THE Provision_Action SHALL accept a Tenant_Name input value matching the pattern `^[a-z0-9-]{1,32}$`, an Environment input value that is one of `dev`, `test`, `uat`, `prod`, and a set of Selected_Components (component names chosen from the Allowed_Components; currently `dynamodb` and `ecr`).
4. IF the Tenant_Name input value does not match `^[a-z0-9-]{1,32}$` or the Environment input value is not one of `dev`, `test`, `uat`, `prod`, THEN THE Provision_Action SHALL fail the step with an error identifying the invalid input, SHALL NOT clone the Tenant_Live_Repo, and SHALL leave the Tenant_Live_Repo unchanged.
5. WHERE a component in the Allowed_Components is not present in the Selected_Components, THE Provision_Action SHALL set that component's `enable_<component>` entry to `false`.
6. THE Provision_Action SHALL read the Tenant_Live_Repo location from the `TENANT_LIVE_REPO_URL` configuration value, the Live_Repo_Base_Branch from the `TENANT_LIVE_REPO_BRANCH` configuration value, and the Module_Source from the `TERRAGRUNT_MODULE_SOURCE` configuration value.
7. WHERE the `TENANT_LIVE_REPO_BRANCH` configuration value is not supplied, THE Provision_Action SHALL default the Live_Repo_Base_Branch to `main`.
8. IF the `TERRAGRUNT_MODULE_SOURCE` configuration value is absent or empty, THEN THE Provision_Action SHALL fail the step with an error identifying the missing configuration, SHALL NOT clone the Tenant_Live_Repo, and SHALL leave the Tenant_Live_Repo unchanged.
9. THE Provision_Action SHALL obtain configuration values from environment-backed app-config references rather than from hardcoded literals.
10. THE Provision_Action SHALL read the Allowed_Components from an app-config list rather than from a hardcoded list of component names.

### Requirement 2: Clone the tenant live repository

**User Story:** As a tenant, I want the provisioning workflow to start from the current live configuration, so that my change is applied on top of the latest committed state.

#### Acceptance Criteria

1. WHEN the Provision_Action executes, THE Provision_Action SHALL clone the Tenant_Live_Repo identified by `TENANT_LIVE_REPO_URL` at the Live_Repo_Base_Branch identified by `TENANT_LIVE_REPO_BRANCH` into a Working_Directory, leaving the Working_Directory checked out on the Live_Repo_Base_Branch.
2. THE Provision_Action SHALL create the Working_Directory as a temporary directory dedicated to the current execution.
3. IF the clone fails because the Tenant_Live_Repo cannot be reached over the network, THEN THE Provision_Action SHALL fail the step with an error indicating the repository could not be reached.
4. IF the clone fails because the ref identified by `TENANT_LIVE_REPO_BRANCH` does not exist in the Tenant_Live_Repo, THEN THE Provision_Action SHALL fail the step with an error identifying the missing ref.
5. IF the clone fails because authentication with the Git_Token is rejected, THEN THE Provision_Action SHALL fail the step with an authentication error that excludes the Secret_Value.
6. IF the clone does not complete within 120 seconds, THEN THE Provision_Action SHALL abort the clone and fail the step with an error indicating the clone timed out.

### Requirement 3: Render and write the tenant Terragrunt configuration

**User Story:** As a tenant, I want a `terragrunt.hcl` generated from my inputs, so that my tenant and environment are provisioned without hand-writing HCL.

#### Acceptance Criteria

1. THE Provision_Action SHALL render a Terragrunt_File containing an `include "root"` block, a `terraform` block whose `source` attribute is set to the Module_Source, and an `inputs` block.
2. THE Provision_Action SHALL set the `inputs` block's `tenant_name` to the Tenant_Name and `environment` to the Environment.
3. THE Provision_Action SHALL render one `enable_<component>` entry in the `inputs` block for each Component_Flag in the Component_Set, setting each entry's boolean value from the corresponding Component_Flag input value, and SHALL do so without hardcoding a fixed list of component names in the rendering logic.
4. THE Provision_Action SHALL write the Terragrunt_File to the path `<Tenant_Name>/<Environment>/terragrunt.hcl`, where `<Tenant_Name>` and `<Environment>` are the validated Tenant_Name and Environment input values, relative to the root of the Working_Directory.
5. IF the target tenant folder, environment subfolder, or Terragrunt_File does not exist in the Working_Directory, THEN THE Provision_Action SHALL create the folder path and the Terragrunt_File.
6. IF the target Terragrunt_File already exists in the Working_Directory, THEN THE Provision_Action SHALL overwrite the Terragrunt_File with the rendered content.
7. IF the computed path for the tenant folder, environment subfolder, or Terragrunt_File resolves to a location outside the Working_Directory, THEN THE Provision_Action SHALL fail the step with an error indicating the path is outside the Working_Directory and SHALL NOT create or modify any file.
8. IF creating the folder path or writing the Terragrunt_File fails, THEN THE Provision_Action SHALL fail the step with an error indicating the file could not be written and SHALL leave any pre-existing Terragrunt_File content unchanged.

### Requirement 4: Create a timestamped feature branch

**User Story:** As a platform operator, I want each provisioning change on its own branch, so that concurrent tenant changes do not collide and each change maps to one pull request.

#### Acceptance Criteria

1. WHEN the Provision_Action has written the Terragrunt_File, THE Provision_Action SHALL create a Feature_Branch in the Working_Directory checkout, based on the Live_Repo_Base_Branch, without modifying the Live_Repo_Base_Branch.
2. THE Provision_Action SHALL name the Feature_Branch `devops/<Tenant_Name>-<Environment>-<yyyymmdd-hhmmss>`, where `<yyyymmdd-hhmmss>` is the execution start time expressed in Coordinated Universal Time (UTC) as a four-digit year, followed by two-digit zero-padded month (01-12), two-digit zero-padded day (01-31), a hyphen, then two-digit zero-padded hour (00-23), two-digit zero-padded minute (00-59), and two-digit zero-padded second (00-59).
3. THE Provision_Action SHALL commit onto the Feature_Branch exactly the added or updated Terragrunt_File and any parent folders it created for that file, and no other files, with a commit message that includes both the Tenant_Name and the Environment being provisioned.
4. IF a branch named identically to the computed Feature_Branch name already exists in the Working_Directory checkout or the Tenant_Live_Repo, THEN THE Provision_Action SHALL fail the step with an error indicating the branch name already exists and SHALL NOT create a commit or a pull request.

### Requirement 5: Push the branch and open a pull request

**User Story:** As a platform operator, I want the provisioning change delivered as a pull request, so that a human reviews it before any infrastructure is applied.

#### Acceptance Criteria

1. WHEN the commit has been created, THE Provision_Action SHALL push the Feature_Branch to the Tenant_Live_Repo.
2. WHEN the Feature_Branch has been pushed, THE Provision_Action SHALL open a pull request in the Tenant_Live_Repo from the Feature_Branch targeting the Live_Repo_Base_Branch.
3. THE Provision_Action SHALL set a pull request title that identifies the Tenant_Name and Environment being provisioned.
4. WHEN the pull request has been created, THE Provision_Action SHALL expose both the pull request URL and the Feature_Branch name as step output values.
5. THE Provision_Action SHALL stop after the pull request is created and SHALL NOT run `terragrunt plan`, `terragrunt apply`, any other Terragrunt command, or any Terraform or AWS execution against the tenant configuration.
6. IF an open pull request from the Feature_Branch targeting the Live_Repo_Base_Branch already exists, THEN THE Provision_Action SHALL NOT create a duplicate pull request and SHALL expose the existing pull request URL as a step output value.
7. IF the push does not succeed within 60 seconds or is rejected by the Tenant_Live_Repo, THEN THE Provision_Action SHALL fail the step with an error describing the failed push and SHALL NOT attempt to create a pull request.
8. IF the pull request cannot be created within 60 seconds after a successful push, THEN THE Provision_Action SHALL fail the step with an error describing the pull-request failure and SHALL report the pushed Feature_Branch name.

### Requirement 6: Clean up temporary files

**User Story:** As a platform operator, I want the workflow to leave no temporary files behind, so that the backend host does not accumulate clones or leak tenant data between executions.

#### Acceptance Criteria

1. WHEN the Provision_Action completes successfully, THE Provision_Action SHALL delete the Working_Directory and all files and subdirectories created within it during that execution before the action returns.
2. IF the Provision_Action fails after the Working_Directory has been created, THEN THE Provision_Action SHALL delete the Working_Directory and all files and subdirectories created within it before the action returns the failure.
3. IF the Provision_Action attempts to delete the Working_Directory and the deletion does not fully remove it, THEN THE Provision_Action SHALL return an error indicating that cleanup did not complete and identifying the path that could not be removed, without exposing tenant secrets or credentials.
4. WHERE the Scaffolder_Backend is configured with a scaffolder working directory, THE Provision_Action SHALL create the Working_Directory as a uniquely named subdirectory under that configured directory, distinct from any other concurrent execution's Working_Directory.
5. WHERE the Scaffolder_Backend is not configured with a scaffolder working directory, THE Provision_Action SHALL create the Working_Directory as a uniquely named subdirectory under the operating system temporary directory, distinct from any other concurrent execution's Working_Directory.

### Requirement 7: Protect sensitive configuration

**User Story:** As a platform operator, I want credentials kept out of logs and committed files, so that tenant provisioning does not leak secrets.

#### Acceptance Criteria

1. THE Provision_Action SHALL exclude every Secret_Value from its log output at all log levels, including debug-level output.
2. THE Provision_Action SHALL exclude every Secret_Value from the Terragrunt_File and from any other file committed to the Tenant_Live_Repo.
3. IF an error message, stack trace, or exception detail would otherwise contain a Secret_Value, THEN THE Provision_Action SHALL replace each Secret_Value with a fixed non-reversible redaction placeholder before the message is logged or returned to the caller, and SHALL preserve the remaining non-secret content of the message.
4. THE Provision_Action SHALL restrict all Working_Directory paths for a single execution to a path composed of that execution's Tenant_Name and Environment, so that one execution's file operations cannot read or write another tenant's Working_Directory.
5. IF a Working_Directory path resolved during an execution falls outside that execution's Tenant_Name and Environment path, THEN THE Provision_Action SHALL abort the execution before performing any file read or write at that path and SHALL return an error indicating the path violated tenant isolation.
6. WHEN the Provision_Action terminates, whether by success or failure, THE Provision_Action SHALL remove every file it created that contains a Secret_Value from the local filesystem.

### Requirement 8: Validate inputs before performing side effects

**User Story:** As a platform operator, I want invalid inputs rejected before any repository change, so that the workflow fails fast without creating branches, commits, or pull requests.

#### Acceptance Criteria

1. IF the Tenant_Name input value or the Environment input value is absent, null, or an empty string, THEN THE Provision_Action SHALL fail the step with a validation error that identifies the offending input, SHALL NOT create a Working_Directory, and SHALL NOT clone the Tenant_Live_Repo.
2. IF the Tenant_Name input value is shorter than 1 character, longer than 32 characters, or contains a character outside the set of lowercase letters (a-z), digits (0-9), and hyphen, THEN THE Provision_Action SHALL fail the step with a validation error that identifies the Tenant_Name as invalid and SHALL NOT clone the Tenant_Live_Repo.
3. IF the Environment input value is not exactly one of the values `dev`, `test`, `uat`, or `prod`, THEN THE Provision_Action SHALL fail the step with a validation error that identifies the Environment as invalid and SHALL NOT clone the Tenant_Live_Repo.
4. WHEN the Provision_Action fails validation, THE Provision_Action SHALL leave the Tenant_Live_Repo unchanged, creating no Working_Directory, no Feature_Branch, no commit, and no pull request.

### Requirement 9: Support an extensible set of components

**User Story:** As a platform operator, I want the provisioning action to handle new optional components without code changes to its core logic, so that additional `enable_<component>` inputs can be introduced as the Terraform module grows.

#### Acceptance Criteria

1. THE Provision_Action SHALL determine the Component_Set by expanding the Selected_Components against the Allowed_Components, including every Allowed_Component with value `true` when it is a member of the Selected_Components and `false` otherwise.
2. THE Provision_Action SHALL render one `enable_<component>` entry for each Allowed_Component, using the same rendering logic for every component with no component-name-specific branching.
3. THE Provision_Action SHALL name each rendered input `enable_<component>`, where `<component>` is the component name.
4. THE Provision_Action SHALL render the `enable_<component>` entries ordered by component name in ascending lexicographic byte order, so that the same Allowed_Components and Selected_Components always produce byte-for-byte identical Terragrunt_File content.
5. WHERE the Allowed_Components is extended with a new component name in configuration, THE Provision_Action SHALL render that component's `enable_<component>` entry without any change to the Provision_Action's rendering logic.
6. IF a name in the Selected_Components is not a member of the Allowed_Components, THEN THE Provision_Action SHALL fail the step with an error identifying the unrecognized component and SHALL NOT render or write any Terragrunt_File content.
7. IF any Allowed_Component name does not match the pattern `^[a-z0-9_]+$`, THEN THE Provision_Action SHALL fail the step with an error identifying the invalid component name and SHALL NOT render or write any Terragrunt_File content.
8. WHERE the Selected_Components is empty, THE Provision_Action SHALL render one `enable_<component>` entry set to `false` for every Allowed_Component.
9. WHERE the Allowed_Components is empty, THE Provision_Action SHALL render the `inputs` block with `tenant_name` and `environment` only and no `enable_<component>` entries.
