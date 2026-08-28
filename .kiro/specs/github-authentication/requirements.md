# Requirements Document

## Introduction

This feature enables GitHub OAuth sign-in for the Backstage application. Currently the app
only supports the guest authentication provider. This feature adds a GitHub authentication
provider so that a user can sign in with a GitHub account, and the signed-in GitHub identity
is resolved to a matching `User` entity in the software catalog. The feature spans backend
provider registration, `app-config` configuration for both local and production environments,
a sign-in resolver that maps a GitHub username to a catalog `User`, and documentation of the
two new environment variables (`GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`).

Configuration follows the Backstage convention that secrets are referenced as environment
variables (`${GITHUB_CLIENT_ID}`, `${GITHUB_CLIENT_SECRET}`) and are never hardcoded.

## Glossary

- **Backstage_App**: The Backstage application in this repository, comprising the frontend
  package (`packages/app`) and the backend package (`packages/backend`).
- **Auth_Backend**: The `@backstage/plugin-auth-backend` plugin running in the backend, which
  hosts authentication providers.
- **GitHub_Provider_Module**: The `@backstage/plugin-auth-backend-module-github-provider`
  backend module that registers the GitHub authentication provider with the Auth_Backend.
- **GitHub_OAuth_App**: The OAuth application registered in GitHub that issues the
  `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` credentials used for authentication.
- **Sign_In_Resolver**: The configured logic that maps an authenticated GitHub identity to a
  Backstage catalog `User` entity and issues a Backstage identity token.
- **Catalog_User_Entity**: A `User` kind entity in the software catalog (defined in
  `templates/org.yaml`) whose `metadata.name` matches a GitHub username.
- **Sign_In_Page**: The frontend sign-in page provided by `@backstage/plugin-auth` in the
  declarative frontend system, configured through `app-config.yaml`.
- **GITHUB_CLIENT_ID**: The environment variable holding the GitHub OAuth App client ID.
- **GITHUB_CLIENT_SECRET**: The environment variable holding the GitHub OAuth App client secret.

## Requirements

### Requirement 1: Register the GitHub authentication provider in the backend

**User Story:** As a Backstage operator, I want the GitHub authentication provider registered in
the backend, so that the application can process GitHub OAuth sign-in requests.

#### Acceptance Criteria

1. THE Backstage_App SHALL register the GitHub_Provider_Module with the Auth_Backend in
   `packages/backend/src/index.ts`.
2. THE Backstage_App SHALL retain the existing guest authentication provider registration
   alongside the GitHub_Provider_Module.
3. WHEN the backend starts with the GitHub_Provider_Module registered, THE Auth_Backend SHALL
   expose a GitHub authentication provider endpoint that responds to authentication requests.
4. IF the backend starts and either GITHUB_CLIENT_ID or GITHUB_CLIENT_SECRET is unset, THEN THE
   Auth_Backend SHALL fail to start the GitHub provider and SHALL surface an error identifying the
   missing configuration.

### Requirement 2: Configure the GitHub provider with environment-referenced credentials

**User Story:** As a Backstage operator, I want the GitHub provider configured with credentials
supplied through environment variables, so that no secrets are stored in source control.

#### Acceptance Criteria

1. THE Backstage_App SHALL define a `github` provider block under `auth.providers` in
   `app-config.yaml`, with `clientId` and `clientSecret` nested under a `development` environment
   key.
2. THE Backstage_App SHALL set the GitHub provider `clientId` to the literal string
   `${GITHUB_CLIENT_ID}` in `app-config.yaml`.
3. THE Backstage_App SHALL set the GitHub provider `clientSecret` to the literal string
   `${GITHUB_CLIENT_SECRET}` in `app-config.yaml`.
4. THE Backstage_App SHALL NOT contain literal GitHub client ID or client secret values in any
   `app-config` file; only `${GITHUB_CLIENT_ID}` and `${GITHUB_CLIENT_SECRET}` references SHALL
   appear.
5. THE Backstage_App SHALL retain the existing guest provider block under `auth.providers`.
6. THE Backstage_App SHALL define a `github` provider block under `auth.providers` in
   `app-config.production.yaml`, with `clientId` set to `${GITHUB_CLIENT_ID}` and `clientSecret`
   set to `${GITHUB_CLIENT_SECRET}` nested under a `production` environment key.
7. IF the backend starts and a `${GITHUB_CLIENT_ID}` or `${GITHUB_CLIENT_SECRET}` reference cannot
   be resolved from the environment, THEN THE Auth_Backend SHALL surface a configuration error
   rather than starting with an empty credential.

### Requirement 3: Resolve GitHub identities to catalog User entities

**User Story:** As a user signing in with GitHub, I want my GitHub identity mapped to my catalog
User entity, so that I receive a Backstage identity with my catalog associations.

#### Acceptance Criteria

1. THE Backstage_App SHALL configure a Sign_In_Resolver for the GitHub provider in the
   `app-config` `auth.providers.github` block.
2. WHEN a user completes GitHub authentication and exactly one Catalog_User_Entity whose
   `metadata.name` matches the authenticated GitHub username under a case-insensitive comparison
   exists, THE Sign_In_Resolver SHALL issue a Backstage identity for that Catalog_User_Entity.
3. IF a user completes GitHub authentication and no Catalog_User_Entity matching the authenticated
   GitHub username exists, THEN THE Sign_In_Resolver SHALL deny the sign-in, SHALL NOT issue a
   Backstage identity or establish a session, and SHALL return an error indicating that no
   matching catalog User entity was found.
4. IF a user completes GitHub authentication and more than one Catalog_User_Entity matches the
   authenticated GitHub username, THEN THE Sign_In_Resolver SHALL deny the sign-in, SHALL NOT
   issue a Backstage identity or establish a session, and SHALL return an error indicating that
   the GitHub identity is ambiguous.
5. IF the Sign_In_Resolver cannot complete the Catalog_User_Entity lookup because the catalog
   cannot be reached within 10 seconds, THEN THE Sign_In_Resolver SHALL deny the sign-in, SHALL
   NOT issue a Backstage identity or establish a session, and SHALL return an error indicating
   that the identity could not be resolved.

### Requirement 4: Provide GitHub sign-in on the frontend

**User Story:** As a user, I want a GitHub sign-in option on the Backstage sign-in page, so that I
can authenticate with my GitHub account.

#### Acceptance Criteria

1. THE Backstage_App SHALL configure the Sign_In_Page via `app-config.yaml` to present the GitHub
   provider as a selectable sign-in option that is visible to the user before authentication.
2. WHEN a user selects the GitHub sign-in option, THE Sign_In_Page SHALL start the GitHub OAuth
   authentication flow within 2 seconds of the selection.
3. WHEN GitHub authentication succeeds and the Sign_In_Resolver resolves the user to a catalog
   identity, THE Backstage_App SHALL grant the user an authenticated session and display the
   authenticated application view.
4. IF the GitHub OAuth authentication flow fails, is cancelled by the user, or does not complete
   within 60 seconds, THEN THE Backstage_App SHALL deny the session, return the user to the
   Sign_In_Page, and display an error indication that sign-in did not succeed.
5. IF the Sign_In_Resolver cannot resolve the authenticated GitHub user to a catalog identity,
   THEN THE Backstage_App SHALL deny the session and display an error indication that the identity
   could not be resolved.

### Requirement 5: Document the GitHub authentication environment variables

**User Story:** As a developer setting up the application, I want the GitHub authentication
environment variables documented, so that I can configure sign-in without reading source code.

#### Acceptance Criteria

1. THE Backstage_App SHALL provide a row for GITHUB_CLIENT_ID in the README Environment variables
   table with all three columns (Variable, Purpose, Used in) populated, where the Purpose text
   states the variable identifies the GitHub_OAuth_App used for GitHub sign-in.
2. THE Backstage_App SHALL provide a row for GITHUB_CLIENT_SECRET in the README Environment
   variables table with all three columns (Variable, Purpose, Used in) populated, where the
   Purpose text states the variable authenticates the GitHub_OAuth_App used for GitHub sign-in.
3. THE Backstage_App SHALL state in the README Environment variables section that GITHUB_CLIENT_ID
   and GITHUB_CLIENT_SECRET are obtained from a GitHub_OAuth_App.
4. THE Backstage_App SHALL cover GITHUB_CLIENT_SECRET under the README Environment variables
   section's instruction not to commit real values.
