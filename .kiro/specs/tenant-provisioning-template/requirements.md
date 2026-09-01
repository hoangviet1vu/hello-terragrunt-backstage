# Requirements Document

## Introduction

This feature adds a Backstage Software Template (a `Template` catalog entity) that lets a user
self-service the input for provisioning (or updating) a tenant's Terragrunt configuration through
the Backstage frontend, without hand-writing HCL.

The scope of THIS feature is **only the frontend input experience and the template's parameter
definitions, validation, and defaults**: the form the user fills in and the constraints applied to
that input. This template does NOT yet render `terragrunt.hcl`, does NOT invoke any scaffolder
action, and does NOT open a pull request. Rendering the configuration and opening a chore PR
against the tenant live repository (via the `platform` tenant-provisioning backend module) is
future work and out of scope for this feature.

The template collects three groups of input described in the plugin README: tenant name,
environment, and which optional components to enable. These are the values that a future
provisioning action would map to the Terragrunt `inputs` block, for example:

```hcl
inputs = {
  tenant_name     = "sampletenant"
  environment     = "dev"
  enable_dynamodb = false
  enable_ecr      = true
}
```

The input constraints in this feature mirror the tenant Terraform module's variable validation,
which is the authoritative source of truth: `tenant_name` is 1 to 32 characters, `environment` is
1 to 12 characters, both restricted to lowercase letters, digits, and hyphens (`^[a-z0-9-]+$`) and
neither may be empty or whitespace-only. The `environment` value is a free-text validated string,
not a fixed set of choices.

## Glossary

- **Template**: The Backstage `scaffolder.backstage.io/v1beta3` `Template` catalog entity that
  defines the input form (`spec.parameters`) and execution steps (`spec.steps`).
- **Scaffolder_Frontend**: The Backstage frontend component that renders the Template's parameters
  as an input form and submits the collected values.
- **Scaffolder_Backend**: The Backstage scaffolder backend that executes the Template's steps.
- **Provisioning_Action**: The custom scaffolder action (provided by the `platform`
  tenant-provisioning backend module) that would consume the collected parameters to render
  `terragrunt.hcl` and open a chore pull request against the Tenant_Live_Repo. This action is
  future work and out of scope for this feature; it is defined here only for context.
- **Tenant_Name**: The identifier of the tenant, entered by the user (e.g. `sampletenant`), written
  to the `tenant_name` Terragrunt input and used as the top-level folder name in the
  Tenant_Live_Repo. Constrained to 1 to 32 characters of lowercase letters, digits, and hyphens
  (`^[a-z0-9-]+$`), and may not be empty or whitespace-only, mirroring the tenant Terraform
  module's `tenant_name` variable validation.
- **Environment**: The deployment environment for the tenant configuration, written to the
  `environment` Terragrunt input and used as the subfolder name under the tenant folder (for
  example, an `environment` value of `prod` maps to a live folder named `prod`). This is a
  free-text validated string, not a fixed set of choices: constrained to 1 to 12 characters of
  lowercase letters, digits, and hyphens (`^[a-z0-9-]+$`), and may not be empty or whitespace-only,
  mirroring the tenant Terraform module's `environment` variable validation.
- **Component**: An optional Terraform module that can be enabled for a tenant/environment (e.g.
  `dynamodb`, `ecr`), each mapping to an `enable_<component>` Terragrunt input.
- **Tenant_Live_Repo**: The Git repository holding tenant Terragrunt configuration, configured via
  the `TENANT_LIVE_REPO_URL` environment variable, with a layout of
  `<tenant-name>/<environment>/terragrunt.hcl` (for example, `<tenant-name>/prod/terragrunt.hcl`).

## Requirements

### Requirement 1: Register the tenant-provisioning Template

**User Story:** As a platform operator, I want a tenant-provisioning Software Template available in
Backstage, so that tenants can discover and launch tenant provisioning from the frontend.

#### Acceptance Criteria

1. THE Template SHALL be defined as a `scaffolder.backstage.io/v1beta3` `Template` catalog entity.
2. THE Template SHALL declare a `metadata.name` value of `tenant-provisioning-template`.
3. THE Template SHALL declare a non-empty `metadata.title` and a non-empty `metadata.description`
   that identify it as the tenant-provisioning template.
4. THE Template SHALL declare a `spec.type` value of `service`.
5. THE Template SHALL declare a `spec.owner` value referencing a catalog entity.
6. IF the `spec.owner` value does not resolve to an existing catalog entity, THEN THE
   Scaffolder_Backend SHALL report the Template entity as having an unresolved owner reference.
7. WHERE the Template location is registered under `catalog.locations` in an `app-config` file,
   THE Scaffolder_Frontend SHALL list the Template in the template catalog.
8. IF the Template location is not registered under `catalog.locations`, THEN THE
   Scaffolder_Frontend SHALL omit the Template from the template catalog.
9. IF the Template entity fails schema validation, THEN THE Scaffolder_Backend SHALL report a
   validation error for the Template entity and THE Scaffolder_Frontend SHALL omit the Template
   from the template catalog.

### Requirement 2: Collect the tenant name

**User Story:** As a tenant, I want to enter my tenant name, so that my configuration is written to
the correct tenant folder.

#### Acceptance Criteria

1. THE Template SHALL define a required string parameter for the Tenant_Name.
2. THE Template SHALL display a non-empty title and a non-empty description for the Tenant_Name
   parameter in the Scaffolder_Frontend.
3. WHEN the user submits the form with the Tenant_Name field empty, THE Scaffolder_Frontend SHALL
   block submission and display a validation message indicating that the Tenant_Name is required.
4. THE Template SHALL constrain the Tenant_Name parameter to match a pattern of 1 to 32 characters
   where each character is a lowercase letter (a-z), a digit (0-9), or a hyphen (`^[a-z0-9-]+$`).
5. IF the submitted Tenant_Name is shorter than 1 character or longer than 32 characters, THEN THE
   Scaffolder_Frontend SHALL block submission and display a validation message stating the allowed
   length range of 1 to 32 characters.
6. IF the submitted Tenant_Name contains one or more characters outside the set of lowercase
   letters (a-z), digits (0-9), and hyphen, THEN THE Scaffolder_Frontend SHALL block submission and
   display a validation message describing the allowed characters.
7. IF the submitted Tenant_Name contains only whitespace characters, THEN THE Scaffolder_Frontend
   SHALL block submission and display a validation message indicating that the Tenant_Name is
   required.

### Requirement 3: Provide the environment

**User Story:** As a tenant, I want to enter the environment, so that my configuration targets the
correct environment subfolder.

#### Acceptance Criteria

1. THE Template SHALL define a required string parameter for the Environment.
2. THE Template SHALL display a non-empty title and a non-empty description for the Environment
   parameter in the Scaffolder_Frontend.
3. THE Scaffolder_Frontend SHALL present the Environment parameter as a text input field.
4. THE Template SHALL constrain the Environment parameter to match a pattern of 1 to 12 characters
   where each character is a lowercase letter (a-z), a digit (0-9), or a hyphen (`^[a-z0-9-]+$`).
5. WHEN the user submits the form with the Environment field empty, THE Scaffolder_Frontend SHALL
   block submission and display a validation message indicating that the Environment is required.
6. IF the submitted Environment contains only whitespace characters, THEN THE Scaffolder_Frontend
   SHALL block submission and display a validation message indicating that the Environment is
   required.
7. IF the submitted Environment is longer than 12 characters, THEN THE Scaffolder_Frontend SHALL
   block submission and display a validation message stating the allowed length range of 1 to 12
   characters.
8. IF the submitted Environment contains one or more characters outside the set of lowercase
   letters (a-z), digits (0-9), and hyphen, THEN THE Scaffolder_Frontend SHALL block submission and
   display a validation message describing the allowed characters.
9. THE Template SHALL default the Environment parameter to `dev`.

### Requirement 4: Choose components to provision

**User Story:** As a tenant, I want to enable optional components, so that only the modules I need
are captured for my tenant and environment.

#### Acceptance Criteria

1. THE Template SHALL define a boolean parameter for the `dynamodb` Component.
2. THE Template SHALL define a boolean parameter for the `ecr` Component.
3. THE Template SHALL default the `dynamodb` Component parameter to `false`.
4. THE Template SHALL default the `ecr` Component parameter to `false`.
5. THE Scaffolder_Frontend SHALL present each Component parameter as a boolean control with a
   non-empty title and a non-empty description.
