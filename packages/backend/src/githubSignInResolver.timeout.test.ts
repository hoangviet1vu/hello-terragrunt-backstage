import type {
  AuthResolverContext,
  BackstageSignInResult,
  OAuthAuthenticatorResult,
  SignInInfo,
} from '@backstage/plugin-auth-node';
import type { GithubProfile } from '@backstage/plugin-auth-backend-module-github-provider';
import {
  createGithubSignInResolver,
  UNRESOLVED_ERROR,
} from './githubSignInResolver';

/**
 * Integration test for the catalog-timeout deny path of the custom GitHub
 * sign-in resolver.
 *
 * Validates: Requirement 3.5 — when the catalog lookup cannot complete within
 * the configured timeout (10s in production; a small injected value here so the
 * test does not actually wait), the resolver denies the sign-in with the
 * "identity could not be resolved" error and issues no identity/session.
 *
 * These live in a dedicated file (separate from githubSignInResolver.test.ts /
 * the resolver's match/no-match/ambiguous unit tests) to avoid a file collision
 * with the sibling task working against the same resolver.
 */

/**
 * Builds a minimal successful GitHub sign-in result carrying the given
 * username. Only the fields the resolver reads are populated; the rest is cast
 * to satisfy the type without pulling in the full OAuth result shape.
 */
function makeSignInInfo(
  username: string,
): SignInInfo<OAuthAuthenticatorResult<GithubProfile>> {
  return {
    profile: {},
    result: {
      fullProfile: { username },
    },
  } as unknown as SignInInfo<OAuthAuthenticatorResult<GithubProfile>>;
}

/**
 * Builds a mock resolver context whose token-issuance helpers are jest mocks so
 * the test can assert no identity/session was issued on the deny path.
 */
function makeContext(): {
  context: AuthResolverContext;
  signInWithCatalogUser: jest.Mock;
  issueToken: jest.Mock;
} {
  const signInWithCatalogUser = jest.fn(
    async (): Promise<BackstageSignInResult> => ({
      token: 'should-not-be-issued',
    }),
  );
  const issueToken = jest.fn(async () => ({
    token: 'should-not-be-issued',
  }));

  const context = {
    signInWithCatalogUser,
    issueToken,
  } as unknown as AuthResolverContext;

  return { context, signInWithCatalogUser, issueToken };
}

describe('createGithubSignInResolver - catalog timeout deny path (Requirement 3.5)', () => {
  it('denies with the unresolved error when the catalog lookup stalls beyond the timeout', async () => {
    const { context, signInWithCatalogUser, issueToken } = makeContext();

    // A lookup that never settles: it simulates an unreachable/stalled catalog.
    // With a small injected timeoutMs the resolver rejects without waiting 10s.
    const lookupCandidateUserNames = jest.fn(
      () => new Promise<string[]>(() => {}),
    );

    const resolver = createGithubSignInResolver({
      lookupCandidateUserNames,
      timeoutMs: 20,
    });

    await expect(
      resolver(makeSignInInfo('octocat'), context),
    ).rejects.toThrow(UNRESOLVED_ERROR);

    // The lookup was attempted, but no identity/session was ever issued.
    expect(lookupCandidateUserNames).toHaveBeenCalledTimes(1);
    expect(signInWithCatalogUser).not.toHaveBeenCalled();
    expect(issueToken).not.toHaveBeenCalled();
  });

  it('denies with the unresolved error when the catalog lookup rejects', async () => {
    const { context, signInWithCatalogUser, issueToken } = makeContext();

    // A lookup that rejects: simulates the catalog being unreachable/erroring.
    const lookupCandidateUserNames = jest.fn(async (): Promise<string[]> => {
      throw new Error('ECONNREFUSED: catalog unreachable');
    });

    const resolver = createGithubSignInResolver({
      lookupCandidateUserNames,
      timeoutMs: 10_000,
    });

    await expect(
      resolver(makeSignInInfo('octocat'), context),
    ).rejects.toThrow(UNRESOLVED_ERROR);

    expect(lookupCandidateUserNames).toHaveBeenCalledTimes(1);
    expect(signInWithCatalogUser).not.toHaveBeenCalled();
    expect(issueToken).not.toHaveBeenCalled();
  });

  it('does not leak the underlying catalog error message on rejection', async () => {
    const { context } = makeContext();

    const secretish = 'sensitive-underlying-detail';
    const lookupCandidateUserNames = jest.fn(async (): Promise<string[]> => {
      throw new Error(secretish);
    });

    const resolver = createGithubSignInResolver({
      lookupCandidateUserNames,
      timeoutMs: 10_000,
    });

    // The denial surfaces only the generic unresolved error, never the
    // underlying cause.
    await expect(
      resolver(makeSignInInfo('octocat'), context),
    ).rejects.toThrow(UNRESOLVED_ERROR);
    await expect(
      resolver(makeSignInInfo('octocat'), context),
    ).rejects.not.toThrow(secretish);
  });
});
