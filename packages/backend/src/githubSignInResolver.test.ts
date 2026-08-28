import fc from 'fast-check';
import { resolveGithubUser } from './githubSignInResolver';

/**
 * Feature: github-authentication, Property 1: Resolver outcome is determined by the case-insensitive match count
 *
 * Validates: Requirements 3.2, 3.3, 3.4
 */

/**
 * Generator: produces a username string consisting of alphanumeric characters
 * (1–20 chars) with mixed case.
 */
const usernameArb = fc.string({
  unit: fc.constantFrom(
    ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split(''),
  ),
  minLength: 1,
  maxLength: 20,
});

describe('resolveGithubUser - Property 1: Resolver outcome is determined by the case-insensitive match count', () => {
  // Feature: github-authentication, Property 1: Resolver outcome is determined by the case-insensitive match count

  it('returns no-match when zero candidates match case-insensitively', () => {
    fc.assert(
      fc.property(
        usernameArb,
        fc.array(usernameArb, { minLength: 0, maxLength: 10 }),
        (username, noiseCandidates) => {
          // Filter out any accidental matches
          const candidates = noiseCandidates.filter(
            n => n.toLowerCase() !== username.toLowerCase(),
          );

          const result = resolveGithubUser(username, candidates);
          expect(result.kind).toBe('no-match');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('returns match with correct userRef when exactly one candidate matches case-insensitively', () => {
    fc.assert(
      fc.property(
        usernameArb.filter(u => u.length > 0 && /[a-zA-Z]/.test(u)),
        fc.array(usernameArb, { minLength: 0, maxLength: 10 }),
        (username, noiseCandidates) => {
          // Ensure no noise candidate matches
          const noise = noiseCandidates.filter(
            n => n.toLowerCase() !== username.toLowerCase(),
          );

          // Create exactly one matching candidate (a case variant of the username)
          const matchingName = username.split('').map((c, i) =>
            i % 2 === 0 ? c.toUpperCase() : c.toLowerCase(),
          ).join('');

          // Insert the matching name at a random-ish position
          const insertIdx = noise.length > 0 ? noise.length % 3 : 0;
          const candidates = [
            ...noise.slice(0, insertIdx),
            matchingName,
            ...noise.slice(insertIdx),
          ];

          const result = resolveGithubUser(username, candidates);
          expect(result.kind).toBe('match');
          if (result.kind === 'match') {
            expect(result.userRef).toBe(`user:default/${matchingName}`);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('returns ambiguous with correct count when two or more candidates match case-insensitively', () => {
    fc.assert(
      fc.property(
        usernameArb.filter(u => u.length > 0 && /[a-zA-Z]/.test(u)),
        fc.integer({ min: 2, max: 5 }),
        fc.array(usernameArb, { minLength: 0, maxLength: 10 }),
        (username, matchCount, noiseCandidates) => {
          // Ensure no noise candidate matches
          const noise = noiseCandidates.filter(
            n => n.toLowerCase() !== username.toLowerCase(),
          );

          // Create multiple distinct matching candidates (case variants)
          const matchingNames: string[] = [];
          for (let i = 0; i < matchCount; i++) {
            // Generate different case variants by toggling the i-th character
            const variant = username.split('').map((c, idx) => {
              if (idx === i % username.length) {
                return c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase();
              }
              return c;
            }).join('');
            matchingNames.push(variant);
          }

          const candidates = [...noise, ...matchingNames];

          const result = resolveGithubUser(username, candidates);
          expect(result.kind).toBe('ambiguous');
          if (result.kind === 'ambiguous') {
            expect(result.count).toBe(matchCount);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('outcome is a total function: exactly one of the three kinds is returned for any input', () => {
    fc.assert(
      fc.property(
        usernameArb,
        fc.array(usernameArb, { minLength: 0, maxLength: 15 }),
        (username, candidates) => {
          const result = resolveGithubUser(username, candidates);

          // Count case-insensitive matches
          const matchCount = candidates.filter(
            c => c.toLowerCase() === username.toLowerCase(),
          ).length;

          if (matchCount === 0) {
            expect(result.kind).toBe('no-match');
          } else if (matchCount === 1) {
            expect(result.kind).toBe('match');
            if (result.kind === 'match') {
              // The userRef must reference the matched entity name (preserving original casing)
              const matchedName = candidates.find(
                c => c.toLowerCase() === username.toLowerCase(),
              );
              expect(result.userRef).toBe(`user:default/${matchedName}`);
            }
          } else {
            expect(result.kind).toBe('ambiguous');
            if (result.kind === 'ambiguous') {
              expect(result.count).toBe(matchCount);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
