# Implementation Plan: GitHub Authentication

## Overview

This plan implements GitHub OAuth sign-in for the Backstage app alongside the existing guest
provider. Implementation is in **TypeScript** (matching the existing monorepo).

The work is sequenced so the pure decision helper `resolveGithubUser` and its property tests come
first, then the custom sign-in resolver that wires the helper to the catalog and token issuance
(Approach B from the design), then the GitHub provider registration in the backend, then
`app-config` credential blocks, then the frontend sign-in module, and finally README docs. Each
step builds on the previous and ends by integrating into the running backend/frontend so there is
no orphaned code.

Verification uses the project scripts (from AGENTS.md / `package.json`): `yarn tsc` (typecheck),
`yarn workspace backend test`, `yarn workspace app test`, and `yarn lint`. The Playwright
end-to-end test is run with `yarn test:e2e` (not run in CI by default).

## Tasks

- [x] 1. Implement the pure sign-in resolver decision helper
  - [x] 1.1 Create the `resolveGithubUser` helper and `ResolveOutcome` type
    - In `packages/backend/src`, create a resolver module (e.g. `githubSignInResolver.ts`) exporting the `ResolveOutcome` union (`{ kind: 'match'; userRef: string } | { kind: 'no-match' } | { kind: 'ambiguous'; count: number }`) and a pure function `resolveGithubUser(githubUsername: string, candidateUserEntityNames: string[]): ResolveOutcome`
    - Lowercase both the username and each candidate name, count case-insensitive matches, and return `match` (with the matched `user:default/<name>` ref) only when exactly one candidate matches; return `no-match` for zero and `ambiguous` (with count) for two or more
    - Keep the function pure — no catalog access, no token issuance, no timers
    - _Requirements: 3.2, 3.3, 3.4_

  - [x] 1.2 Write property test for resolver outcome by match count
    - Use `fast-check` with at least 100 iterations (`fc.assert(..., { numRuns: 100 })`)
    - Generate usernames plus candidate lists constructed to land in each partition (zero / exactly one / two-or-more case-insensitive matches) with random non-matching noise names, and assert the outcome kind matches the case-insensitive match count and that `match` selects the single matching entity
    - Tag with comment: `Feature: github-authentication, Property 1: Resolver outcome is determined by the case-insensitive match count`
    - **Property 1: Resolver outcome is determined by the case-insensitive match count**
    - **Validates: Requirements 3.2, 3.3, 3.4**

  - [x] 1.3 Write property test for case-insensitivity and determinism
    - Use `fast-check` with at least 100 iterations
    - Assert that permuting only the letter-case of the username, or of any candidate name, does not change the outcome, and that two calls with equal inputs yield equal outcomes
    - Tag with comment: `Feature: github-authentication, Property 2: Matching is case-insensitive and deterministic`
    - **Property 2: Matching is case-insensitive and deterministic**
    - **Validates: Requirements 3.2**

- [x] 2. Implement the custom GitHub sign-in resolver (catalog + deny semantics)
  - [x] 2.1 Build the resolver that wires `resolveGithubUser` to the catalog and token issuance
    - In the resolver module, implement the sign-in resolver `(info, ctx)` that reads the GitHub username from `info`, performs a catalog lookup of candidate `User` entity names bounded by a 10-second timeout, calls `resolveGithubUser`, and translates the `ResolveOutcome` into either an issued identity (`ctx.issueToken`/`signInWithCatalogUser`-style) for the `match` case or a distinct denial for each failure case
    - Denial errors: `no-match` → "no matching catalog User entity"; `ambiguous` → "ambiguous GitHub identity"; timeout/catalog-unreachable → "identity could not be resolved". No identity or session is issued in any deny case
    - Never log `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET` or credential values; error messages reference variable names only
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

  - [x] 2.2 Write unit tests for the resolver's deny and issue paths
    - With a mocked catalog/context: exactly-one match issues an identity for the matched user (3.2); zero matches denies with the no-match error (3.3); multiple matches denies with the ambiguous error (3.4)
    - _Requirements: 3.2, 3.3, 3.4_

  - [x] 2.3 Write integration test for the catalog-timeout deny path
    - Use a mock catalog that stalls beyond 10s (or rejects) and assert the resolver denies with the "identity could not be resolved" error and issues no identity/session
    - _Requirements: 3.5_

- [x] 3. Register the GitHub provider with the custom resolver in the backend
  - [x] 3.1 Wire the custom GitHub provider module into `packages/backend/src/index.ts`
    - Add a backend module (targeting `pluginId: 'auth'`, `providerId: 'github'`) that builds the GitHub provider using `createOAuthProviderFactory` + `githubAuthenticator` from `@backstage/plugin-auth-node` / the provider package and supplies the custom `signInResolver` from task 2.1, then `backend.add(...)` it next to the existing guest provider line
    - Retain the existing `@backstage/plugin-auth-backend` and guest provider registrations unchanged
    - _Requirements: 1.1, 1.2, 3.1_

  - [x] 3.2 Write backend startup smoke + provider endpoint integration tests
    - Assert the backend boots with both guest and GitHub providers registered (1.1, 1.2), and that the GitHub provider endpoint responds (is not 404) to authentication requests after startup (1.3)
    - Assert that when `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET` are unset/unresolved, the Auth Backend surfaces a configuration error identifying the missing variable rather than starting with empty credentials (1.4, 2.7)
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.7_

- [x] 4. Configure the GitHub provider credentials in app-config
  - [x] 4.1 Add the `github` development provider block and set `auth.environment` in `app-config.yaml`
    - Under `auth.providers`, add a `github.development` block with `clientId: ${GITHUB_CLIENT_ID}` and `clientSecret: ${GITHUB_CLIENT_SECRET}`; set `auth.environment: development`; retain the existing `guest: {}` block. Omit `signIn.resolvers` (the code resolver from task 2.1 takes priority)
    - Use only `${...}` references — no literal credential values
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [x] 4.2 Add the `github` production provider block in `app-config.production.yaml`
    - Add a `github.production` block with `clientId: ${GITHUB_CLIENT_ID}` and `clientSecret: ${GITHUB_CLIENT_SECRET}`; set `auth.environment: production`; retain the guest block. Use only `${...}` references
    - _Requirements: 2.4, 2.6_

  - [x] 4.3 Write config-shape and no-literal-credential tests
    - Parse both config files and assert the `github` provider blocks exist under the correct environment keys, that `clientId`/`clientSecret` are exactly `${GITHUB_CLIENT_ID}`/`${GITHUB_CLIENT_SECRET}`, and that `auth.providers.guest` is retained (2.1, 2.2, 2.3, 2.5, 2.6)
    - Scan all `app-config*` files and assert the github credential fields match only the `${...}` reference form with no literal-credential pattern (2.4)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

- [x] 5. Checkpoint - Ensure backend build and tests pass
  - Run `yarn tsc`, `yarn workspace backend test`, and `yarn lint`. Ensure all tests pass, ask the user if questions arise.

- [x] 6. Add the GitHub sign-in option to the frontend
  - [x] 6.1 Create a sign-in frontend module using `githubAuthApiRef`
    - Create `packages/app/src/modules/auth` following the existing `createFrontendModule` pattern used by `navModule`/`homeModule`, providing a `SignInPage` extension configured with the GitHub provider (`githubAuthApiRef`) as a selectable option and keeping guest available
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

  - [x] 6.2 Register the sign-in module in `packages/app/src/App.tsx`
    - Add the new auth module to the `features` array alongside `catalogPlugin`, `navModule`, and `homeModule`
    - _Requirements: 4.1_

  - [x] 6.3 Write frontend sign-in page tests
    - Render/snapshot test asserting a selectable GitHub option is present (4.1); interaction test that selecting it invokes the OAuth start handler (4.2); failure/cancel/timeout returns to the sign-in page with an error and no session (4.4); a resolver denial surfaces an "identity could not be resolved" error and denies the session (4.5)
    - _Requirements: 4.1, 4.2, 4.4, 4.5_

- [x] 7. Document the GitHub authentication environment variables
  - [x] 7.1 Update the README Environment variables section
    - Add a `GITHUB_CLIENT_ID` row (Purpose: identifies the GitHub OAuth App used for GitHub sign-in) and a `GITHUB_CLIENT_SECRET` row (Purpose: authenticates the GitHub OAuth App used for GitHub sign-in), each with all three columns (Variable, Purpose, Used in) populated and Used in listing `app-config.yaml`, `app-config.production.yaml`
    - State that both values are obtained from a GitHub OAuth App, and extend the existing "never commit real values" note to explicitly cover `GITHUB_CLIENT_SECRET`
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [x] 7.2 Write README content checks
    - Assert rows for `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` exist with all three columns populated and the specified Purpose text (5.1, 5.2), that the section states both come from a GitHub OAuth App (5.3), and that the do-not-commit note covers `GITHUB_CLIENT_SECRET` (5.4)
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

- [x] 8. Add the end-to-end happy-path test (Playwright)
  - Add a Playwright test (run via `yarn test:e2e`) where a resolvable user completing GitHub auth (with the OAuth exchange mocked/stubbed) obtains an authenticated session and sees the app view
  - _Requirements: 4.3_

- [x] 9. Final checkpoint - Ensure all tests pass
  - Run `yarn tsc`, `yarn workspace backend test`, `yarn workspace app test`, and `yarn lint`. Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional (test-related) and can be skipped for a faster MVP.
- Each task references specific requirement clauses for traceability.
- Property tests (1.2, 1.3) target the pure `resolveGithubUser` helper only; the rest of the
  feature is covered by unit/example and integration/smoke tests per the design's Testing Strategy.
- The custom code resolver (Approach B) is the primary path, so `signIn.resolvers` is omitted from
  the `app-config` github blocks — the resolver decision lives in exactly one place (task 2.1).
- Never log or commit `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`; config uses `${...}` references only.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "4.1", "4.2", "7.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "2.1", "4.3", "6.1", "7.2"] },
    { "id": 2, "tasks": ["2.2", "2.3", "3.1", "6.2"] },
    { "id": 3, "tasks": ["3.2", "6.3", "8"] }
  ]
}
```
