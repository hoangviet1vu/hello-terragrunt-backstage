/**
 * Custom GitHub authentication provider backend module.
 *
 * This module registers the GitHub OAuth provider with the Auth Backend using
 * a code-defined sign-in resolver (Approach B from the github-authentication
 * design). It targets `pluginId: 'auth'`, `providerId: 'github'`, builds the
 * provider with {@link createOAuthProviderFactory} + {@link githubAuthenticator},
 * and supplies the custom resolver from {@link createGithubSignInResolver}.
 *
 * The resolver's catalog lookup is implemented here: it lists `kind=User`
 * catalog entities and returns their `metadata.name` values as the candidate
 * set. Case-insensitive matching and the deny semantics live in the pure
 * helper and resolver in `githubSignInResolver.ts` (which is left unchanged).
 *
 * Credential values (`GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`) are never
 * read or logged in this module; they are resolved by the provider factory
 * from `app-config` `${...}` references.
 */
/**
 * Backend module that registers the GitHub provider (`providerId: 'github'`)
 * with the Auth Backend, wired to the custom sign-in resolver.
 */
export declare const authModuleGithubProvider: import("@backstage/backend-plugin-api").BackendFeature;
