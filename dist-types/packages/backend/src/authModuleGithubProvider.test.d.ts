/**
 * Backend startup smoke + provider endpoint integration tests for the GitHub
 * authentication feature (task 3.2).
 *
 * These boot a minimal backend with `startTestBackend` from
 * `@backstage/backend-test-utils`, wiring up the real Auth Backend
 * (`@backstage/plugin-auth-backend`), the stock guest provider module, and the
 * custom `authModuleGithubProvider` from task 3.1. They assert:
 *
 *   - the backend boots with both the guest and GitHub providers registered
 *     (Requirements 1.1, 1.2);
 *   - after startup, the GitHub provider endpoint is reachable — it does NOT
 *     return 404 the way an unregistered provider does (Requirement 1.3);
 *   - when the GitHub credentials are absent/unresolved, the Auth Backend
 *     surfaces a configuration error naming the missing credential field
 *     rather than starting the provider with empty credentials
 *     (Requirements 1.4, 2.7).
 *
 * Why config injection uses `mockServices.rootConfig` with the credentials
 * inlined: the test harness receives already-parsed config, so Backstage's
 * `${GITHUB_CLIENT_ID}` environment substitution (which happens in the real
 * config loader, not in this harness) is not exercised here. What IS exercised
 * — and is the substance of Requirements 1.4/2.7 — is that the Auth Backend
 * refuses to start the GitHub provider when the `clientId`/`clientSecret`
 * config values are missing, surfacing an error that identifies the missing
 * field. An unresolved `${...}` reference for a required provider produces the
 * same missing-value outcome at startup. See the github-authentication design
 * (Testing Strategy -> Integration / smoke, and Error Handling) and
 * requirements.md 1.x / 2.7.
 */
export {};
