# @internal/backstage-plugin-platform-backend-module-tenant-provisioning

The tenant-provisioning backend module for the `platform` plugin.

_This plugin was created through the Backstage CLI_

## Overview

This module powers a Backstage Software Template that lets a user provision
(or update) a tenant's Terragrunt configuration without hand-writing HCL or
opening a PR by hand.

From the template, the user provides:

- **Tenant ID / Tenant Name** — identifies the tenant (e.g. `SAMPLETENANT`).
- **Environment** — one of `dev`, `test`, `uat`, `production`.
- **Components to provision** — which optional modules to enable for this
  tenant/environment, e.g. `dynamodb`, `ecr`.

Example resulting `inputs` block:

```hcl
inputs = {
  tenant_name     = "SAMPLETENANT"
  environment     = "dev"
  enable_dynamodb = false
  enable_ecr      = true
}
```

The module renders a `terragrunt.hcl` from these inputs and opens a chore PR
against the tenant configuration ("live") repository.

## How it works

1. The template collects tenant name, environment, and enabled components.
2. The module renders `terragrunt.hcl` from the template below, substituting
   the tenant inputs and the configured Terraform module source.
3. It writes the file to `<tenant-name>/<environment>/terragrunt.hcl` in the
   tenant live repository (creating the tenant/environment folder if it
   doesn't exist yet).
4. It commits the change on a new branch and opens a pull request ("chore:
   provision `<tenant-name>/<environment>`") against the live repo's default
   branch.

### Tenant live repository layout

Each tenant has its own top-level folder, with one subfolder per
provisioned environment:

```
├── <tenant-1>
│   └── <dev>/terragrunt.hcl
│   └── <prod>/terragrunt.hcl
├── <tenant-2>
│   └── <dev>/terragrunt.hcl
│   └── <uat>/terragrunt.hcl
└── <tenant-3>
    └── <dev>/terragrunt.hcl
```

### Generated `terragrunt.hcl` template

```hcl
include "root" {
  path = find_in_parent_folders("root.hcl")
}

terraform {
  source = "git::<the-terraform-modules-reference>"
}

inputs = {
  tenant_name     = "<tenant-name>"
  environment     = "<env>"
  enable_dynamodb = <from input option, default is false>
  enable_ecr      = <from input option, default is false>
}
```

## Configuration

The tenant live repository and the Terraform module source are not
hard-coded — they're configured via environment variables so the same
module can target different repos/refs per environment (e.g. sandbox vs.
production Backstage instances).

| Environment variable | Description | Default |
| --- | --- | --- |
| `TENANT_LIVE_REPO_URL` | Git URL of the repository that holds tenant Terragrunt configuration. | `https://github.com/hoangviet1vu/hello-terragrunt-live.git` |
| `TENANT_LIVE_REPO_BRANCH` | Base branch in the live repo that PRs are opened against. | `main` |
| `TERRAGRUNT_MODULE_SOURCE` | `source` value written into the generated `terraform` block, e.g. `git::git@github.com:hoangviet1vu/hello-terragrunt-modules.git//?ref=main`. | _(required)_ |

> Variable names above are placeholders and can be renamed to match the
> final implementation/config schema.

## Status

This module is currently scaffolded but not yet implemented (see
[`src/module.ts`](src/module.ts)) — the behavior above describes the
intended design.
