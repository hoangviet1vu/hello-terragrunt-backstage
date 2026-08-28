/**
 * Pure decision helper for the GitHub sign-in resolver.
 *
 * This module intentionally contains no catalog access, token issuance, or
 * timers so that the matching decision can be unit- and property-tested in
 * isolation from the surrounding resolver machinery. See the
 * github-authentication design (Components and Interfaces) for context.
 */

import type {
  AuthResolverContext,
  BackstageSignInResult,
  OAuthAuthenticatorResult,
  SignInInfo,
  SignInResolver,
} from '@backstage/plugin-auth-node';
import type { GithubProfile } from '@backstage/plugin-auth-backend-module-github-provider';

/**
 * The outcome of resolving a GitHub username against a set of candidate
 * catalog `User` entity names.
 *
 * - `match`: exactly one candidate matched (case-insensitively); `userRef` is
 *   the `user:default/<name>` reference for that entity.
 * - `no-match`: zero candidates matched.
 * - `ambiguous`: two or more candidates matched; `count` is how many.
 */
export type ResolveOutcome =
  | { kind: 'match'; userRef: string }
  | { kind: 'no-match' }
  | { kind: 'ambiguous'; count: number };

/**
 * Decide the sign-in outcome for a GitHub username against a list of candidate
 * catalog `User` entity names, using a case-insensitive comparison.
 *
 * The comparison lowercases both the username and each candidate name and
 * counts matches. An identity is issued (`match`) only when exactly one
 * candidate matches; zero matches yield `no-match` and two or more yield
 * `ambiguous`.
 *
 * This function is pure: it performs no I/O and depends only on its arguments.
 *
 * @param githubUsername - The authenticated GitHub username (login).
 * @param candidateUserEntityNames - Candidate catalog `User` entity names.
 * @returns The resolve outcome derived from the case-insensitive match count.
 */
export function resolveGithubUser(
  githubUsername: string,
  candidateUserEntityNames: string[],
): ResolveOutcome {
  const target = githubUsername.toLowerCase();

  const matches = candidateUserEntityNames.filter(
    name => name.toLowerCase() === target,
  );

  if (matches.length === 1) {
    return { kind: 'match', userRef: `user:default/${matches[0]}` };
  }

  if (matches.length === 0) {
    return { kind: 'no-match' };
  }

  return { kind: 'ambiguous', count: matches.length };
}

/*
 * ---------------------------------------------------------------------------
 * Custom GitHub sign-in resolver
 * ---------------------------------------------------------------------------
 *
 * The resolver below wires the pure `resolveGithubUser` decision helper above
 * to the software catalog and to Backstage token issuance. It implements the
 * full deny semantics from the github-authentication design (Requirement 3):
 *
 *   - exactly one case-insensitive match  -> issue an identity           (3.2)
 *   - zero matches                         -> deny "no matching ..."       (3.3)
 *   - two or more matches                  -> deny "ambiguous ..."         (3.4)
 *   - catalog unreachable within 10s       -> deny "identity could not ..." (3.5)
 *
 * The `resolveGithubUser` helper above is intentionally left pure and
 * untouched; all catalog access, timing, and token issuance live here.
 */

/**
 * The maximum time, in milliseconds, that the catalog lookup for candidate
 * `User` entity names is allowed to take before the sign-in is denied with an
 * "identity could not be resolved" error (Requirement 3.5).
 */
export const CATALOG_LOOKUP_TIMEOUT_MS = 10_000;

/** Denial error message emitted when no catalog `User` entity matches (3.3). */
export const NO_MATCH_ERROR = 'no matching catalog User entity';
/** Denial error message emitted when more than one entity matches (3.4). */
export const AMBIGUOUS_ERROR = 'ambiguous GitHub identity';
/**
 * Denial error message emitted when the catalog lookup cannot complete within
 * {@link CATALOG_LOOKUP_TIMEOUT_MS} (3.5). Also used for any catalog failure so
 * that credential values are never surfaced.
 */
export const UNRESOLVED_ERROR = 'identity could not be resolved';

/**
 * Looks up the candidate catalog `User` entity names to compare against the
 * authenticated GitHub username.
 *
 * This is provided as an injectable dependency so the resolver can be tested
 * with a mock catalog and so the pure matching decision stays isolated from
 * catalog wiring. Implementations must return the `metadata.name` of candidate
 * `User` entities; they should not perform token issuance.
 *
 * @param githubUsername - The authenticated GitHub username (login).
 * @param context - The auth resolver context (catalog access lives here).
 * @returns The candidate `User` entity names to match against.
 */
export type CandidateUserLookup = (
  githubUsername: string,
  context: AuthResolverContext,
) => Promise<string[]>;

/**
 * Options for {@link createGithubSignInResolver}.
 */
export interface GithubSignInResolverOptions {
  /**
   * Looks up candidate `User` entity names for the given GitHub username.
   */
  lookupCandidateUserNames: CandidateUserLookup;
  /**
   * Timeout, in milliseconds, applied to {@link lookupCandidateUserNames}.
   * Defaults to {@link CATALOG_LOOKUP_TIMEOUT_MS}.
   */
  timeoutMs?: number;
}

/**
 * Reads the GitHub username (login) from a successful GitHub sign-in result.
 *
 * @throws If the result does not carry a username, in which case the identity
 * cannot be resolved. The message references only structural information and
 * never credential values.
 */
function readGithubUsername(
  info: SignInInfo<OAuthAuthenticatorResult<GithubProfile>>,
): string {
  const username = info.result.fullProfile.username;
  if (!username) {
    throw new Error(UNRESOLVED_ERROR);
  }
  return username;
}

/**
 * Runs a promise with a timeout. If the promise does not settle within
 * `timeoutMs`, the returned promise rejects. The pending timer is always
 * cleared so it cannot keep the process alive.
 */
async function withTimeout<T>(
  work: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(UNRESOLVED_ERROR)), timeoutMs);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

/**
 * Builds the custom GitHub sign-in resolver.
 *
 * The returned resolver reads the GitHub username from the sign-in result,
 * looks up candidate catalog `User` entity names (bounded by a 10-second
 * timeout), delegates the matching decision to the pure
 * {@link resolveGithubUser} helper, and translates the {@link ResolveOutcome}
 * into either an issued Backstage identity (the `match` case) or a distinct
 * denial for each failure case. No identity or session is issued in any deny
 * case.
 *
 * Credential values (`GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`) are never
 * read or logged here; denial messages reference structural reasons only.
 *
 * @param options - Catalog lookup dependency and optional timeout.
 * @returns A {@link SignInResolver} for the GitHub provider.
 */
export function createGithubSignInResolver(
  options: GithubSignInResolverOptions,
): SignInResolver<OAuthAuthenticatorResult<GithubProfile>> {
  const { lookupCandidateUserNames, timeoutMs = CATALOG_LOOKUP_TIMEOUT_MS } =
    options;

  return async (
    info: SignInInfo<OAuthAuthenticatorResult<GithubProfile>>,
    context: AuthResolverContext,
  ): Promise<BackstageSignInResult> => {
    const githubUsername = readGithubUsername(info);

    // Bound the catalog lookup: on timeout or any catalog failure, deny with a
    // generic "identity could not be resolved" error (3.5). We do not surface
    // the underlying error to avoid leaking sensitive details.
    let candidateNames: string[];
    try {
      candidateNames = await withTimeout(
        lookupCandidateUserNames(githubUsername, context),
        timeoutMs,
      );
    } catch {
      throw new Error(UNRESOLVED_ERROR);
    }

    const outcome = resolveGithubUser(githubUsername, candidateNames);

    switch (outcome.kind) {
      case 'match':
        // Exactly one match: issue a Backstage identity for that user (3.2).
        return context.signInWithCatalogUser({ entityRef: outcome.userRef });
      case 'no-match':
        // Zero matches: deny, issue no identity/session (3.3).
        throw new Error(NO_MATCH_ERROR);
      case 'ambiguous':
      default:
        // Two or more matches: deny, issue no identity/session (3.4).
        throw new Error(AMBIGUOUS_ERROR);
    }
  };
}
