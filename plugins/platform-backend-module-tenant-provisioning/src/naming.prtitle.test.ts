/**
 * Property-based test for the pure pull-request title builder.
 *
 * This exercises `buildPullRequestTitle(tenantName, environment)` (see design
 * "Correctness Properties" -> Property 7, and "Testing Strategy" ->
 * Property-based tests, mapping sub-task 5.3). For any valid tenant name and
 * environment, the generated pull request title must contain both the tenant
 * name and the environment.
 *
 * No I/O: `buildPullRequestTitle` is pure.
 */

import fc from 'fast-check';
import { buildPullRequestTitle } from './naming';

const ENVIRONMENTS = ['dev', 'test', 'uat', 'prod'] as const;

/** Arbitrary valid tenant name matching `^[a-z0-9-]{1,32}$`. */
const tenantNameArb = fc
  .array(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-'.split('')), {
    minLength: 1,
    maxLength: 32,
  })
  .map(chars => chars.join(''));

/** Arbitrary environment from the fixed enum. */
const environmentArb = fc.constantFrom<(typeof ENVIRONMENTS)[number]>(
  ...ENVIRONMENTS,
);

describe('buildPullRequestTitle: PR title identifies tenant and environment', () => {
  // Feature: tenant-provision-action, Property 7: Pull request title identifies tenant and environment
  // Validates: Requirements 5.3
  it('produces a title containing both the tenant name and the environment (Property 7)', () => {
    fc.assert(
      fc.property(
        tenantNameArb,
        environmentArb,
        (tenantName, environment) => {
          const title = buildPullRequestTitle(tenantName, environment);

          expect(title).toContain(tenantName);
          expect(title).toContain(environment);
        },
      ),
      { numRuns: 100 },
    );
  });
});
