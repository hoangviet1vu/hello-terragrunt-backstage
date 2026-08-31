/**
 * Property-based test for `buildBranchName` (feature branch name builder).
 *
 * `buildBranchName(tenantName, environment, date)` builds the feature branch
 * name `devops/<tenantName>-<environment>-<yyyymmdd-hhmmss>`, with the
 * timestamp expressed in Coordinated Universal Time (UTC). This test asserts
 * the produced name matches
 * `^devops/[a-z0-9-]{1,32}-(dev|test|uat|prod)-\d{8}-\d{6}$` and that it embeds
 * the tenant name, the environment, and the UTC timestamp components (year,
 * month, day, hour, minute, second from the given Date) in that order.
 *
 * No I/O: `buildBranchName` is pure.
 *
 * See the tenant-provision-action design ("Correctness Properties" → Property 2,
 * and "Testing Strategy" → Property-based tests, mapping sub-task 5.2).
 */

import fc from 'fast-check';

import { buildBranchName } from './naming';

const ENVIRONMENTS = ['dev', 'test', 'uat', 'prod'] as const;

/** Arbitrary valid tenant name matching `^[a-z0-9-]{1,32}$`. */
const tenantNameArb = fc
  .array(
    fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-'.split('')),
    { minLength: 1, maxLength: 32 },
  )
  .map(chars => chars.join(''));

/** Arbitrary environment from the fixed enum. */
const environmentArb = fc.constantFrom<(typeof ENVIRONMENTS)[number]>(
  ...ENVIRONMENTS,
);

/**
 * Arbitrary Date. Restricted to a range comfortably inside the four-digit-year
 * era so the year always renders as exactly four digits (matching the branch
 * regex's `\d{8}` date component).
 */
const dateArb = fc
  .integer({
    // 2000-01-01T00:00:00Z .. 9999-12-31T23:59:59Z (ms since epoch).
    min: Date.UTC(2000, 0, 1, 0, 0, 0),
    max: Date.UTC(9999, 11, 31, 23, 59, 59),
  })
  .map(ms => new Date(ms));

/** Zero-pads a non-negative integer to the requested width. */
function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

describe('buildBranchName: feature branch name', () => {
  // Feature: tenant-provision-action, Property 2: Feature branch name is well-formed
  // Validates: Requirements 4.2
  it('produces a well-formed branch name embedding tenant, environment, and UTC timestamp (Property 2)', () => {
    fc.assert(
      fc.property(
        tenantNameArb,
        environmentArb,
        dateArb,
        (tenantName, environment, date) => {
          const branchName = buildBranchName(tenantName, environment, date);

          // Overall shape.
          expect(branchName).toMatch(
            /^devops\/[a-z0-9-]{1,32}-(dev|test|uat|prod)-\d{8}-\d{6}$/,
          );

          // Embeds the UTC timestamp components in order: yyyymmdd-hhmmss.
          const year = pad(date.getUTCFullYear(), 4);
          const month = pad(date.getUTCMonth() + 1, 2);
          const day = pad(date.getUTCDate(), 2);
          const hours = pad(date.getUTCHours(), 2);
          const minutes = pad(date.getUTCMinutes(), 2);
          const seconds = pad(date.getUTCSeconds(), 2);
          const timestamp = `${year}${month}${day}-${hours}${minutes}${seconds}`;

          // Embeds tenant name, environment, and timestamp in that order.
          expect(branchName).toBe(
            `devops/${tenantName}-${environment}-${timestamp}`,
          );
          expect(branchName).toContain(tenantName);
          expect(branchName).toContain(environment);
          expect(branchName.endsWith(timestamp)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });
});
