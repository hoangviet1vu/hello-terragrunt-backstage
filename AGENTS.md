# AGENTS.md

Guidance for anyone (human or AI coding agent) working in this repository. See
[README.md](./README.md) for the product overview and quick start.

## What this project is

A Backstage application that lets tenants self-service provision/update cloud infrastructure.
A tenant runs a Software Template in this app; the scaffolder backend then drives Terragrunt
(wrapping Terraform) against that tenant's folder in the separate
[`hello-terragrunt-live`](https://github.com/hoangviet1vu/hello-terragrunt-live) repository, and
Terraform applies the resulting plan to AWS.

This means most of the interesting logic in this repo is **scaffolder actions/templates that
shell out to Git/Terragrunt/Terraform/AWS**, wrapped in an otherwise-standard Backstage app.

## Current state of the codebase

As of now this is a freshly scaffolded app (`npx @backstage/create-app@latest`) with **no
custom Terragrunt integration implemented yet** — `packages/backend/src/index.ts` only wires up
stock Backstage plugins (scaffolder, catalog, auth, techdocs, permission, search, kubernetes,
notifications, mcp-actions), and `examples/template/template.yaml` is the default example
template (fetch → publish:github → catalog:register). Treat any Terragrunt/Terraform-specific
behavior described in the README as the target design, not yet-existing code, unless you find it
in `plugins/`.

## Repo layout

- `packages/app` — frontend (React), standard Backstage app package.
- `packages/backend` — backend; plugins are registered in `src/index.ts` via `backend.add(...)`.
- `plugins/` — where custom plugins/modules should live (e.g. a scaffolder action module for
  Terragrunt). Scaffold new ones with `yarn new` from the repo root, not by hand.
- `examples/` — demo catalog entities, org data, and the starter template. This is what
  `app-config.yaml` points `catalog.locations` at for local dev; production config
  (`app-config.production.yaml`) should point at real catalog/template locations instead.
- `app-config.yaml` — base/local config (SQLite, guest auth, example locations).
- `app-config.production.yaml` — production overrides (Postgres connection via env vars, prod
  base URLs). Config files are merged, later files override earlier ones.

## Conventions

- This is a Yarn (v4, workspaces) monorepo managed by `@backstage/cli`. Prefer the root scripts
  in `package.json` (`yarn start`, `yarn build:backend`, `yarn test`, `yarn lint`, `yarn new`)
  over calling underlying tools directly.
- Add new backend capabilities as backend plugins/modules registered in
  `packages/backend/src/index.ts`, following the existing `backend.add(import('...'))` pattern.
- Add new scaffolder actions as a custom module in `plugins/`, then register it in the backend
  (typically alongside the existing `@backstage/plugin-scaffolder-backend-module-github` line).
- Add new Software Templates as `Template` catalog entities (see
  `examples/template/template.yaml` for the shape) and register their location under
  `catalog.locations` in the relevant `app-config*.yaml`.
- Follow the Backstage config convention: secrets and environment-specific values are
  `${ENV_VAR}` references in `app-config*.yaml`, never hardcoded.

## Terragrunt/Terraform integration (design notes for future work)

When implementing the scaffolder side of this:

- A scaffolder action needs to: clone/update `hello-terragrunt-live`, write/update the tenant's
  `terragrunt.hcl` (or the `.tfvars`/inputs it references) under that tenant's folder, then
  invoke the `terragrunt` CLI (e.g. `plan`, then `apply`) in that folder, and finally commit/push
  (or open a PR) back to `hello-terragrunt-live`.
- Terragrunt/Terraform and the AWS SDK/credentials must be available in whatever environment
  actually runs the backend (a `Dockerfile` step or a documented host prerequisite) — this is a
  process-execution dependency, not an npm dependency.
- Treat `terragrunt apply`-equivalent steps as **irreversible, cost-affecting infrastructure
  changes**. Any code path that can trigger `apply` (as opposed to `plan`) should require
  explicit tenant confirmation in the template and should not run in tests or CI by default.
- AWS credentials and the GitHub PAT (`GITHUB_TOKEN`) are the two most sensitive pieces of
  config in this system — never log them, never write them into files checked into
  `hello-terragrunt-live`, and never widen the scaffolder's `workingDirectory` handling in a way
  that could leak them across tenants.

## Environment & secrets

See the README's [Environment variables](./README.md#environment-variables) table. Local dev
uses an in-memory SQLite database and needs no Postgres/AWS setup unless you're exercising the
actual provisioning steps. Never commit `.env` files or real credentials — `.env*` is already
gitignored (except `.env.example`).

## Build, test, lint

- `yarn start` — run frontend + backend locally.
- `yarn test` / `yarn test:all` — unit tests (`backstage-cli repo test`).
- `yarn test:e2e` — Playwright tests (`playwright.config.ts`).
- `yarn lint` (changed files) / `yarn lint:all` (whole repo).
- `yarn tsc` — typecheck.

Run the relevant lint/test/typecheck commands after making changes, scoped to what you touched
where possible (e.g. `yarn workspace backend test`).

## Things to avoid

- Don't hardcode tenant IDs, AWS account IDs, or credentials in templates or actions — they must
  come from template parameters or environment variables.
- Don't call `terraform`/`terragrunt` destroy-style operations from scaffolder actions unless a
  template explicitly exists for de-provisioning and the user has confirmed it.
- Don't add plugins/dependencies "by hand" by editing `package.json`; use `yarn new` for new
  plugins and standard `yarn add` inside the correct workspace for dependencies, so the
  monorepo's workspace linking stays consistent.
