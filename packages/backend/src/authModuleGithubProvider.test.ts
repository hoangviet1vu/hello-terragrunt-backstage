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

import { startTestBackend, mockServices } from '@backstage/backend-test-utils';
import authBackend from '@backstage/plugin-auth-backend';
import authGuestProvider from '@backstage/plugin-auth-backend-module-guest-provider';
import request from 'supertest';
import { authModuleGithubProvider } from './authModuleGithubProvider';

/**
 * Base config shared by the boot scenarios. Auth environment is `development`
 * (matching `app-config.yaml`), the guest provider is retained alongside the
 * GitHub provider, and `app.baseUrl` / `backend.baseUrl` are set because the
 * Auth Backend reads them when building its router.
 *
 * The `githubDev` argument is spliced in as the `github.development` block so
 * individual tests can supply valid credentials, omit them, or leave the value
 * unresolved.
 */
function makeConfig(githubDev: Record<string, unknown> | undefined) {
  const github =
    githubDev === undefined ? undefined : { development: githubDev };
  return {
    app: { baseUrl: 'http://localhost:3000' },
    backend: {
      baseUrl: 'http://localhost:7007',
      listen: { port: 0 },
    },
    auth: {
      environment: 'development',
      providers: {
        // Retained alongside GitHub (Requirement 1.2 / 2.5).
        guest: {},
        ...(github ? { github } : {}),
      },
    },
  };
}

/**
 * Builds the feature list for a boot: the real Auth Backend, the stock guest
 * provider module, our custom GitHub provider module, and a root-config mock
 * carrying the supplied config data.
 */
function features(configData: Record<string, unknown>) {
  return [
    authBackend,
    authGuestProvider,
    authModuleGithubProvider,
    mockServices.rootConfig.factory({ data: configData }),
  ];
}

describe('authModuleGithubProvider backend startup smoke', () => {
  it('boots with both the guest and GitHub providers registered and the GitHub endpoint reachable (Req 1.1, 1.2, 1.3)', async () => {
    // Valid (dummy, non-secret) credentials so the provider factory initializes
    // successfully at startup. These are placeholders, not real credentials.
    const backend = await startTestBackend({
      features: features(
        makeConfig({
          clientId: 'test-client-id',
          clientSecret: 'test-client-secret',
        }),
      ),
    });

    try {
      // The GitHub provider endpoint is reachable: hitting its `start` route
      // for the configured environment does NOT yield the 404 that an
      // unregistered provider returns. (A 302 OAuth redirect or a non-404
      // error both prove the provider is wired up.) Requirement 1.3.
      const githubResponse = await request(backend.server).get(
        '/api/auth/github/start?env=development',
      );
      expect(githubResponse.status).not.toBe(404);

      // The guest provider is registered in parallel: its refresh endpoint is
      // also reachable (not 404). Requirement 1.2.
      const guestResponse = await request(backend.server).get(
        '/api/auth/guest/refresh',
      );
      expect(guestResponse.status).not.toBe(404);

      // Control: a provider that was never registered returns 404 with the
      // "Unknown auth provider" message, confirming the checks above are
      // meaningful.
      const unknownResponse = await request(backend.server).get(
        '/api/auth/does-not-exist/start?env=development',
      );
      expect(unknownResponse.status).toBe(404);
    } finally {
      await backend.stop();
    }
  });
});

describe('authModuleGithubProvider missing-credential startup error', () => {
  it('surfaces a configuration error naming the missing credential when clientId/clientSecret are absent (Req 1.4, 2.7)', async () => {
    // The github.development block is present (so the provider is configured
    // and its factory runs at startup) but the credentials are missing — the
    // same outcome as an unresolved `${GITHUB_CLIENT_ID}` reference. The Auth
    // Backend must fail to start rather than run with empty credentials, and
    // the error must identify the missing field.
    await expect(
      startTestBackend({
        features: features(makeConfig({})),
      }),
    ).rejects.toThrow(/clientId/i);
  });

  it('surfaces a configuration error naming the missing secret when only clientId is present (Req 1.4, 2.7)', async () => {
    // Half-configured: clientId present, clientSecret missing. Startup must
    // still fail and name the missing secret rather than proceed with an empty
    // credential.
    await expect(
      startTestBackend({
        features: features(makeConfig({ clientId: 'test-client-id' })),
      }),
    ).rejects.toThrow(/clientSecret/i);
  });
});
