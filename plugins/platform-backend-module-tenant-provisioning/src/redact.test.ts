/**
 * Property-based test for the pure secret-redaction helper.
 *
 * This exercises `redact(message, secrets)` (see design "Correctness
 * Properties" -> Property 5, and "Testing Strategy" -> Property-based tests,
 * mapping sub-task 6.2). It builds a message string interleaved with a secret
 * value injected at random positions and asserts that redaction:
 *   - removes every occurrence of the secret value, and
 *   - preserves the non-secret content around those occurrences.
 *
 * No I/O: `redact` is a pure function.
 */

import fc from 'fast-check';
import { redact, REDACTION_PLACEHOLDER } from './redact';

/**
 * Arbitrary non-empty secret value. Constrained to a small alphabet so the
 * generated non-secret "filler" fragments (below) can be built to reliably
 * exclude the secret, letting us assert exact content preservation.
 *
 * The alphabet excludes the characters that make up the redaction placeholder
 * so injected secrets can never be confused with the placeholder itself.
 */
const secretArb = fc
  .string({ minLength: 1, maxLength: 24, unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')) })
  .filter(s => s.length > 0);

describe('redact: secret redaction is total and content-preserving', () => {
  // Feature: tenant-provision-action, Property 5: Secret redaction is total and content-preserving
  // Validates: Requirements 7.3, 7.1
  it('removes every occurrence of the secret and preserves the surrounding content (Property 5)', () => {
    fc.assert(
      fc.property(
        secretArb,
        // A list of non-secret fragments that are guaranteed not to contain the
        // secret. We interleave these with copies of the secret at random
        // positions, so we know exactly where the secret occurs and what the
        // redacted output must look like.
        fc.array(fc.string({ maxLength: 20 }), { minLength: 1, maxLength: 8 }),
        (secret, rawFragments) => {
          // Ensure fragments cannot themselves contain the secret value; if a
          // fragment did, the exact-reconstruction assertion below would be
          // ambiguous. Replacing any accidental secret occurrence keeps each
          // fragment secret-free while remaining an arbitrary string.
          const fragments = rawFragments.map(f =>
            f.includes(secret) ? f.split(secret).join('_') : f,
          );

          // Interleave: fragment, secret, fragment, secret, ..., fragment.
          // This injects the secret at multiple random positions between
          // arbitrary non-secret content.
          const parts: string[] = [];
          fragments.forEach((fragment, index) => {
            parts.push(fragment);
            if (index < fragments.length - 1) {
              parts.push(secret);
            }
          });
          const message = parts.join('');

          const result = redact(message, [secret]);

          // Totality: no occurrence of the secret survives in the output.
          expect(result.includes(secret)).toBe(false);

          // Content preservation: the redacted output is exactly the message
          // with every secret occurrence replaced by the placeholder and every
          // non-secret fragment left byte-for-byte unchanged.
          const expected = fragments.join(REDACTION_PLACEHOLDER);
          expect(result).toBe(expected);
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: tenant-provision-action, Property 5: Secret redaction is total and content-preserving
  // Validates: Requirements 7.3, 7.1
  it('leaves content unchanged when the secret never occurs (Property 5)', () => {
    fc.assert(
      fc.property(secretArb, fc.string({ maxLength: 60 }), (secret, filler) => {
        // Guarantee the message contains no occurrence of the secret.
        const message = filler.includes(secret)
          ? filler.split(secret).join('_')
          : filler;

        const result = redact(message, [secret]);

        // With no occurrence to remove, content is preserved verbatim.
        expect(result).toBe(message);
        expect(result.includes(secret)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});
