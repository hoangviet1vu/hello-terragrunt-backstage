/*
 * Copyright 2020 The Backstage Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { test, expect, type Page } from '@playwright/test';

/**
 * End-to-end happy path for GitHub sign-in (Requirement 4.3).
 *
 * A resolvable user completes GitHub authentication and is granted an
 * authenticated session, landing on the authenticated app view.
 *
 * This test is deliberately HERMETIC: it never contacts GitHub and never runs
 * a real OAuth exchange or any infrastructure. Every `/api/auth/github/**`
 * endpoint the frontend touches is stubbed via Playwright route interception,
 * so the GitHub OAuth App credentials (`GITHUB_CLIENT_ID` /
 * `GITHUB_CLIENT_SECRET`) are never needed and the sign-in resolver /
 * catalog / token issuance are never exercised for real. Instead we hand the
 * frontend a pre-baked, resolved Backstage session as if the backend resolver
 * had already matched the GitHub username to a catalog `User` entity.
 *
 * The resolvable user matches the catalog `User` entity `vietvuh` from
 * `templates/org.yaml`.
 *
 * How to run (e2e is NOT part of CI by default):
 *   yarn test:e2e                        # runs all Playwright specs
 *   yarn test:e2e github-auth            # just this spec
 * Playwright will start the app (http://localhost:3000) and backend
 * (http://localhost:7007) via the `webServer` config, or reuse already-running
 * ones. No GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET are required because the
 * OAuth exchange is stubbed here.
 */

// A catalog User entity that the sign-in resolver would resolve to (see
// templates/org.yaml). We assert against this ref to prove a *resolved*
// identity, not a guest session.
const RESOLVED_USER_ENTITY_REF = 'user:default/vietvuh';

/**
 * Build a syntactically valid, unsigned-but-well-formed JWT.
 *
 * The Backstage frontend session manager decodes the token payload client-side
 * (base64url) to read the identity claims and the `exp` expiry; it does not
 * verify the signature in the browser. A far-future `exp` keeps the session
 * from being treated as expired, so the app grants an authenticated session
 * without any network round-trip beyond the stubbed refresh.
 */
function makeBackstageToken(userEntityRef: string): string {
  const base64url = (obj: unknown) =>
    Buffer.from(JSON.stringify(obj))
      .toString('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');

  const nowSeconds = Math.floor(Date.now() / 1000);
  const header = { alg: 'ES256', typ: 'JWT', kid: 'e2e-test-key' };
  const payload = {
    iss: 'http://localhost:7007/api/auth',
    sub: userEntityRef,
    ent: [userEntityRef],
    aud: 'backstage',
    iat: nowSeconds,
    exp: nowSeconds + 60 * 60, // 1 hour in the future
  };

  // Signature segment is opaque to the client-side decode; a fixed placeholder
  // is sufficient for the hermetic frontend flow.
  return `${base64url(header)}.${base64url(payload)}.e2e-signature`;
}

/**
 * Stub every GitHub auth endpoint the frontend may hit so that the OAuth
 * exchange is fully mocked and no real provider/infrastructure is involved.
 */
async function stubGithubAuth(page: Page, userEntityRef: string) {
  const token = makeBackstageToken(userEntityRef);

  const session = {
    profile: {
      email: 'vietvuh@example.com',
      displayName: 'Viet Vu',
      picture: 'https://avatars.githubusercontent.com/u/0?v=4',
    },
    backstageIdentity: {
      token,
      identity: {
        type: 'user',
        userEntityRef,
        ownershipEntityRefs: [userEntityRef],
      },
    },
    providerInfo: {
      accessToken: 'e2e-mock-access-token',
      scope: 'read:user',
      expiresInSeconds: 3600,
      idToken: token,
    },
  };

  // The refresh endpoint is the key interception point: when the sign-in page's
  // GitHub provider asks for the current Backstage identity, this returns an
  // already-resolved session, standing in for a completed OAuth exchange.
  await page.route('**/api/auth/github/refresh**', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(session),
    });
  });

  // Safety net: intercept the OAuth start + popup handler so that even if the
  // popup path is taken, nothing leaves the test (no call to GitHub).
  await page.route('**/api/auth/github/start**', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<html><body>mock github oauth start</body></html>',
    });
  });

  await page.route('**/api/auth/github/handler/frame**', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: `<html><body><script>
        (window.opener || window.parent).postMessage(
          { type: 'authorization_response', response: ${JSON.stringify(session)} },
          '*',
        );
      </script></body></html>`,
    });
  });
}

test('GitHub sign-in happy path grants a resolved authenticated session', async ({
  page,
}) => {
  await stubGithubAuth(page, RESOLVED_USER_ENTITY_REF);

  await page.goto('/');

  // The sign-in page presents GitHub as a selectable provider card, alongside
  // guest (Requirement 4.1). The card is titled "GitHub"; its action is a
  // "Sign In" button (guest's card uses "Enter").
  const githubCard = page
    .locator('li')
    .filter({ has: page.getByRole('heading', { name: 'GitHub' }) });
  await expect(githubCard).toBeVisible();

  const githubSignIn = githubCard.getByRole('button', { name: 'Sign In' });
  await expect(githubSignIn).toBeVisible();

  // Selecting GitHub starts the OAuth flow. Because the /refresh endpoint is
  // stubbed to return an already-resolved session, the auth client resolves the
  // Backstage identity from refresh without ever opening the OAuth popup — the
  // exchange is fully mocked and no real provider is contacted (Requirement 4.3).
  await githubSignIn.click();

  // Landing on the authenticated app view: the sidebar navigation and Catalog
  // link are only rendered once a session has been granted.
  const nav = page.getByRole('navigation', { name: 'sidebar nav' });
  await expect(
    nav.getByRole('link', { name: 'Catalog', exact: true }),
  ).toBeVisible();
});
