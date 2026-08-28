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

import {
  coreServices,
  createBackendModule,
} from '@backstage/backend-plugin-api';
import {
  authProvidersExtensionPoint,
  createOAuthProviderFactory,
} from '@backstage/plugin-auth-node';
import { githubAuthenticator } from '@backstage/plugin-auth-backend-module-github-provider';
import { catalogServiceRef } from '@backstage/plugin-catalog-node';
import { createGithubSignInResolver } from './githubSignInResolver';

/**
 * Backend module that registers the GitHub provider (`providerId: 'github'`)
 * with the Auth Backend, wired to the custom sign-in resolver.
 */
export const authModuleGithubProvider = createBackendModule({
  pluginId: 'auth',
  moduleId: 'github-provider',
  register(reg) {
    reg.registerInit({
      deps: {
        providers: authProvidersExtensionPoint,
        catalog: catalogServiceRef,
        auth: coreServices.auth,
      },
      async init({ providers, catalog, auth }) {
        providers.registerProvider({
          providerId: 'github',
          factory: createOAuthProviderFactory({
            authenticator: githubAuthenticator,
            signInResolver: createGithubSignInResolver({
              // Query the catalog for candidate `User` entity names. The pure
              // helper performs the case-insensitive comparison; here we only
              // supply the set of candidate names.
              lookupCandidateUserNames: async () => {
                const credentials = await auth.getOwnServiceCredentials();
                const { items } = await catalog.getEntities(
                  { filter: { kind: 'User' } },
                  { credentials },
                );
                return items.map(entity => entity.metadata.name);
              },
            }),
          }),
        });
      },
    });
  },
});
