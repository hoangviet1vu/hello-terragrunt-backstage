/**
 * Pure decision helper for the GitHub sign-in resolver.
 *
 * This module intentionally contains no catalog access, token issuance, or
 * timers so that the matching decision can be unit- and property-tested in
 * isolation from the surrounding resolver machinery. See the
 * github-authentication design (Components and Interfaces) for context.
 */
import type { AuthResolverContext, OAuthAuthenticatorResult, SignInResolver } from '@backstage/plugin-auth-node';
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
export type ResolveOutcome = {
    kind: 'match';
    userRef: string;
} | {
    kind: 'no-match';
} | {
    kind: 'ambiguous';
    count: number;
};
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
export declare function resolveGithubUser(githubUsername: string, candidateUserEntityNames: string[]): ResolveOutcome;
/**
 * The maximum time, in milliseconds, that the catalog lookup for candidate
 * `User` entity names is allowed to take before the sign-in is denied with an
 * "identity could not be resolved" error (Requirement 3.5).
 */
export declare const CATALOG_LOOKUP_TIMEOUT_MS = 10000;
/** Denial error message emitted when no catalog `User` entity matches (3.3). */
export declare const NO_MATCH_ERROR = "no matching catalog User entity";
/** Denial error message emitted when more than one entity matches (3.4). */
export declare const AMBIGUOUS_ERROR = "ambiguous GitHub identity";
/**
 * Denial error message emitted when the catalog lookup cannot complete within
 * {@link CATALOG_LOOKUP_TIMEOUT_MS} (3.5). Also used for any catalog failure so
 * that credential values are never surfaced.
 */
export declare const UNRESOLVED_ERROR = "identity could not be resolved";
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
export type CandidateUserLookup = (githubUsername: string, context: AuthResolverContext) => Promise<string[]>;
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
export declare function createGithubSignInResolver(options: GithubSignInResolverOptions): SignInResolver<OAuthAuthenticatorResult<GithubProfile>>;
