# Hello Terragrunt Backstage

A [Backstage](https://backstage.io) application that lets tenants self-service provision and
update their cloud infrastructure through Software Templates. A tenant picks a template, fills in
a form (tenant ID, which components to provision, sizing, etc.), and the scaffolder drives
[Terragrunt](https://terragrunt.gruntwork.io/)/[Terraform](https://www.terraform.io/) against
that tenant's folder in the
[`hello-terragrunt-live`](https://github.com/hoangviet1vu/hello-terragrunt-live) repository to
apply the change.

> For guidance on how to work in this codebase (as a human contributor or an AI coding agent),
> see [AGENTS.md](./AGENTS.md).

## How it works

```
Tenant --> Backstage UI --> Software Template --> Scaffolder action(s)
                                                        |
                                                        v
                                   git clone/checkout hello-terragrunt-live
                                   (tenant-specific folder, e.g. tenants/<tenant-id>/)
                                                        |
                                                        v
                                       terragrunt <plan|apply> (Terraform under the hood)
                                                        |
                                                        v
                                        AWS infrastructure provisioned/updated
```

1. The tenant opens a **Template** in the Backstage catalog (Create... page).
2. The template form collects the inputs needed to provision infra (tenant ID, region,
   components to enable, sizing, etc.).
3. The scaffolder backend runs the template's steps, which check out (or update) the tenant's
   folder in `hello-terragrunt-live`, render/update the `terragrunt.hcl` configuration for that
   tenant, and invoke the Terragrunt CLI.
4. Terragrunt wraps Terraform to plan/apply the infrastructure changes against AWS, using the
   backend's configured AWS credentials.
5. Results (and links to the generated PR/commit in `hello-terragrunt-live`) are reported back to
   the tenant in the Backstage UI.

## Tech stack

- **Framework:** [Backstage](https://backstage.io) (Node.js + TypeScript monorepo, Yarn workspaces)
- **Frontend:** `packages/app` (React, via `@backstage/cli`)
- **Backend:** `packages/backend` (new-style Backstage backend, `@backstage/backend-defaults`)
- **Infra tooling:** Terraform, Terragrunt, AWS SDK, invoked from scaffolder actions
- **Source of truth for infra:** [`hello-terragrunt-live`](https://github.com/hoangviet1vu/hello-terragrunt-live)
  (per-tenant `terragrunt.hcl` files), accessed over Git using a GitHub PAT
- **Database:**
  - Local development: SQLite (`better-sqlite3`, in-memory)
  - Production: PostgreSQL

## Repository structure

```
.
├── app-config.yaml              # Base Backstage config (local dev defaults, SQLite)
├── app-config.production.yaml   # Production overrides (Postgres, prod backend/base URLs)
├── catalog-info.yaml            # This app's own catalog entity
├── examples/                    # Example catalog entities, org data, and a starter template
├── packages/
│   ├── app/                     # Frontend (Backstage app)
│   └── backend/                 # Backend (plugins wired up in src/index.ts)
├── plugins/                     # Custom plugins/modules (e.g. Terragrunt scaffolder actions) live here
└── AGENTS.md                    # Guidance for contributors / coding agents
```

## Prerequisites

- Node.js 22 or 24, and Yarn (see `packageManager` in [package.json](./package.json))
- [Terraform](https://developer.hashicorp.com/terraform/install) and
  [Terragrunt](https://terragrunt.gruntwork.io/docs/getting-started/install/) CLIs on the machine
  running the backend (whatever executes scaffolder actions)
- AWS credentials with permissions to manage the provisioned resources
- Git, and a GitHub [Personal Access Token](https://backstage.io/docs/integrations/github/locations#configuration)
  with access to `hello-terragrunt-live`
- PostgreSQL for production use (SQLite is used automatically for local development)

## Environment variables

| Variable                          | Purpose                                              | Used in                       |
| ---------------------------------- | ----------------------------------------------------- | ------------------------------ |
| `GITHUB_TOKEN`                    | PAT for reading/writing `hello-terragrunt-live` and other GitHub integrations | `app-config.yaml` |
| `POSTGRES_HOST` / `POSTGRES_PORT` | Production database connection                        | `app-config.production.yaml` |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` | Production database credentials                    | `app-config.production.yaml` |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` (or role-based credentials) | AWS credentials used by the AWS SDK and by Terraform/Terragrunt when applying infra | Terragrunt/Terraform steps |
| `AWS_REGION` / `AWS_DEFAULT_REGION` | Default AWS region for provisioning                  | Terragrunt/Terraform steps    |

Never commit real values for these — use a local `.env` (already gitignored) or your
deployment platform's secret manager.

## Quick start

To start the app, run:

```sh
yarn install
yarn start
```

This starts the frontend and backend together (frontend on `http://localhost:3000`, backend on
`http://localhost:7007`), using the local SQLite database and the example catalog data/template
under [`examples/`](./examples).

To run against production config (Postgres, etc.) locally, supply the required environment
variables and pass the extra config file:

```sh
yarn workspace backend start --config ../../app-config.yaml --config ../../app-config.production.yaml
```

## Useful scripts

- `yarn test` / `yarn test:all` — unit tests (via `backstage-cli repo test`)
- `yarn test:e2e` — Playwright end-to-end tests
- `yarn lint` / `yarn lint:all` — lint changed/all packages
- `yarn build:backend` — build the backend for deployment
- `yarn new` — scaffold a new plugin/module under `plugins/`

## Related repositories

- [`hello-terragrunt-live`](https://github.com/hoangviet1vu/hello-terragrunt-live) — holds the
  per-tenant `terragrunt.hcl` files this app provisions against.
