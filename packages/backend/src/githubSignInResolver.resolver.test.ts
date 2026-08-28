import type {
  AuthResolverContext,
  BackstageSignInResult,
  OAuthAuthenticatorResult,
  SignInInfo,
} from '@backstage/plugin-auth-node';
import type { GithubProfile } from '@backstage/plugin-auth-backend-module-github-provider';
import {
  AMBIGUOUS_ERROR,
  NO_MATCH_ERROR,
  createGithubSignInResolver,
} from './githubSignInResolver';

/**
 * Unit tests for the custom GitHub sign-in resolver's issue and deny paths.
 *
 * These exercise the resolver wiring (not the pure `resolveGithubUser` helper,
 * which is property-tested elsewhere) with a mocked catalog lookup and a mocked
 * auth resolver context:
 *   - exactly-one match issues an identity for the matched user   (Req 3.2)
 *   - zero matches deny with the no-match error                    (Req 3.3)
 *   - two-or-more matches deny with the ambiguous error            (Req 3.4)
 *
 * The catalog-timeout deny path (Req 3.5) is covered by a sibling integration
 * test to avoid overlapping ownership of the timeout behavior here.
 */

/**
 * Builds a minimal `SignInInfo` carrying just the GitHub username the resolver
 * reads from `info.result.fullProfile.username`. Fields the resolver never
 * touches are omitted and the value is cast to the full type.
 */
function makeSignInInfo(
  username: string | undefined,
): SignInInfo<OAuthAuthenticatorResult<GithubProfile>> {
  return {
    result: {
      fullProfile: { username },
    },
  } as unknown as SignInInfo<OAuthAuthenticatorResult<GithubProfile>>;
}

/**
 * A sentinel result returned by the mocked `signInWithCatalogUser` so tests can
 * assert the resolver returned exactly what the context produced for a match.
 */
const ISSUED_IDENTITY = {
  token: 'issued-backstage-token',
} as unknown as BackstageSignInResult;

/**
 * Builds a mocked `AuthResolverContext` whose `signInWithCatalogUser` records
 * its calls and returns the sentinel identity. All other context members are
 * absent because the resolver does not use them.
 */
function makeContext(): {
  context: AuthResolverContext;
  signInWithCatalogUser: jest.Mock;
} {
  const signInWithCatalogUser = jest
    .fn()
    .mockResolvedValue(ISSUED_IDENTITY);
  const context = { signInWithCatalogUser } as unknown as AuthResolverContext;
  return { context, signInWithCatalogUser };
}

describe('createGithubSignInResolver - issue and deny paths', () => {
  it('issues an identity for the matched user when exactly one candidate matches (Req 3.2)', async () => {
    // Candidate differs only in case from the GitHub username, so the
    // case-insensitive match must select it and issue an identity.
    const lookupCandidateUserNames = jest
      .fn()
      .mockResolvedValue(['VietVuh']);
    const resolver = createGithubSignInResolver({ lookupCandidateUserNames });
    const { context, signInWithCatalogUser } = makeContext();

    const result = await resolver(makeSignInInfo('vietvuh'), context);

    expect(lookupCandidateUserNames).toHaveBeenCalledWith('vietvuh', context);
    expect(signInWithCatalogUser).toHaveBeenCalledTimes(1);
    expect(signInWithCatalogUser).toHaveBeenCalledWith({
      entityRef: 'user:default/VietVuh',
    });
    expect(result).toBe(ISSUED_IDENTITY);
  });

  it('denies with the no-match error and issues no identity when zero candidates match (Req 3.3)', async () => {
    const lookupCandidateUserNames = jest
      .fn()
      .mockResolvedValue(['someone-else', 'another-user']);
    const resolver = createGithubSignInResolver({ lookupCandidateUserNames });
    const { context, signInWithCatalogUser } = makeContext();

    await expect(
      resolver(makeSignInInfo('vietvuh'), context),
    ).rejects.toThrow(NO_MATCH_ERROR);

    expect(signInWithCatalogUser).not.toHaveBeenCalled();
  });

  it('denies with the ambiguous error and issues no identity when multiple candidates match (Req 3.4)', async () => {
    // Two candidates that both match the username case-insensitively.
    const lookupCandidateUserNames = jest
      .fn()
      .mockResolvedValue(['vietvuh', 'VietVuh']);
    const resolver = createGithubSignInResolver({ lookupCandidateUserNames });
    const { context, signInWithCatalogUser } = makeContext();

    await expect(
      resolver(makeSignInInfo('vietvuh'), context),
    ).rejects.toThrow(AMBIGUOUS_ERROR);

    expect(signInWithCatalogUser).not.toHaveBeenCalled();
  });
});
