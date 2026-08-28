import fc from 'fast-check';
import { resolveGithubUser } from './githubSignInResolver';

/**
 * Randomly permute the letter-case of a string. Non-letter characters are left
 * unchanged; each letter is independently upper- or lower-cased based on the
 * provided boolean toggles. The set of characters (ignoring case) is preserved,
 * so this only varies letter-case and nothing else.
 */
function permuteCase(value: string, toggles: boolean[]): string {
  let letterIndex = 0;
  return Array.from(value)
    .map(char => {
      const lower = char.toLowerCase();
      const upper = char.toUpperCase();
      // Only characters whose case actually differs are "letters" we can flip.
      if (lower === upper) {
        return char;
      }
      const toUpper = toggles[letterIndex % Math.max(toggles.length, 1)];
      letterIndex += 1;
      return toUpper ? upper : lower;
    })
    .join('');
}

// A generator for a single name token. Includes mixed case and some non-ASCII
// so the case-insensitive comparison is exercised broadly.
const nameArb = fc
  .string({ minLength: 1, maxLength: 12 })
  .filter(s => s.trim().length > 0);

// Non-empty list of case-flip toggles used to re-case a string.
const togglesArb = fc.array(fc.boolean(), { minLength: 1, maxLength: 16 });

describe('resolveGithubUser - case-insensitivity and determinism', () => {
  // Feature: github-authentication, Property 2: Matching is case-insensitive and deterministic
  it('is invariant to username case, invariant to candidate case (by outcome kind), and deterministic', () => {
    fc.assert(
      fc.property(
        nameArb,
        fc.array(nameArb, { maxLength: 8 }),
        togglesArb,
        togglesArb,
        (username, candidates, usernameToggles, candidateToggles) => {
          const baseline = resolveGithubUser(username, candidates);

          // 1. Determinism: equal inputs yield equal outcomes.
          const repeat = resolveGithubUser(username, candidates);
          expect(repeat).toEqual(baseline);

          // 2. Permuting only the username's letter-case (candidates unchanged)
          //    does not change the outcome at all — the matched candidate's own
          //    casing is untouched, so even userRef is identical.
          const recasedUsername = permuteCase(username, usernameToggles);
          const afterUsernameRecase = resolveGithubUser(
            recasedUsername,
            candidates,
          );
          expect(afterUsernameRecase).toEqual(baseline);

          // 3. Permuting only the letter-case of every candidate name does not
          //    change the matching decision (outcome kind and, for matches,
          //    that a single match is still found). The chosen userRef reflects
          //    the candidate's own casing, so it may differ by case; the
          //    decision must not.
          const recasedCandidates = candidates.map(name =>
            permuteCase(name, candidateToggles),
          );
          const afterCandidateRecase = resolveGithubUser(
            username,
            recasedCandidates,
          );

          expect(afterCandidateRecase.kind).toBe(baseline.kind);
          if (baseline.kind === 'ambiguous' && afterCandidateRecase.kind === 'ambiguous') {
            expect(afterCandidateRecase.count).toBe(baseline.count);
          }
          if (baseline.kind === 'match' && afterCandidateRecase.kind === 'match') {
            // The matched entity ref differs only by letter-case.
            expect(afterCandidateRecase.userRef.toLowerCase()).toBe(
              baseline.userRef.toLowerCase(),
            );
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
