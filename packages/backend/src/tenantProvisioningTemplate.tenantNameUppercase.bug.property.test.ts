/**
 * Bug condition exploration test for the tenant-provisioning "Tenant name"
 * FRONTEND validation (spec: tenant-name-allow-uppercase).
 *
 * This test encodes the EXPECTED (post-fix) behavior described in the bugfix
 * design's "Correctness Properties" -> Property 1: any `tenantName` that is 1
 * to 32 characters of letters/digits/hyphens and contains at least one
 * uppercase letter (`A-Z`) must be ACCEPTED by the frontend JSON Schema
 * `pattern` on the `tenantName` parameter in
 * `templates/tenant-provisioning/template.yaml` (validated with ajv, the JSON
 * Schema semantics rjsf relies on in the scaffolder frontend).
 *
 * The BACKEND half of Property 1 (the `tenant:provision` action's zod schema
 * and fail-fast guard) is exercised in the plugin package alongside the other
 * action tests:
 * `plugins/platform-backend-module-tenant-provisioning/src/actions/tenantProvision.uppercase.bug.test.ts`.
 *
 * IMPORTANT: This test is EXPECTED TO FAIL on the current (unfixed) code. The
 * committed pattern is `^[a-z0-9-]{1,32}$`, whose `[a-z0-9-]` character class
 * excludes `A-Z`, so uppercase-containing names like `MYCOMPANY`, `MyTenant`,
 * `Tenant-01`, and `A` are rejected. That failure is the proof the bug exists.
 * Do NOT fix the test or the template in this task -- once the fix (task 3)
 * broadens the pattern to `^[A-Za-z0-9-]{1,32}$`, this same test will pass.
 *
 * Bug condition (from design): isBugCondition(input) is true iff input matches
 * `^[A-Za-z0-9-]{1,32}$` but does NOT match `^[a-z0-9-]{1,32}$` (length 1-32,
 * only letters/digits/hyphens, at least one uppercase letter).
 */

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import fc from 'fast-check';
import Ajv from 'ajv';

/** Repository root, resolved relative to this test file (packages/backend/src). */
const repoRoot = path.resolve(__dirname, '..', '..', '..');

const templatePath = path.join(
  repoRoot,
  'templates',
  'tenant-provisioning',
  'template.yaml',
);

/** The original (unfixed) lowercase-only pattern. */
const OLD_PATTERN = /^[a-z0-9-]{1,32}$/;
/** The fixed pattern that also permits uppercase letters. */
const FIXED_PATTERN = /^[A-Za-z0-9-]{1,32}$/;

/** Read and parse a YAML file at an absolute path into a plain object. */
function loadYaml(filePath: string): any {
  const raw = fs.readFileSync(filePath, 'utf8');
  return yaml.load(raw) as any;
}

/**
 * Extract the committed `tenantName` property sub-schema from the loaded
 * template's first parameters page. Only the JSON Schema keywords are kept
 * (rjsf `ui:*` hints are not JSON Schema and would be ignored by ajv anyway).
 */
function extractTenantNameSchema(): Record<string, unknown> {
  const template = loadYaml(templatePath);
  const pages = template?.spec?.parameters;
  if (!Array.isArray(pages)) {
    throw new Error('template spec.parameters is not an array');
  }
  const page = pages.find(p => p?.properties && 'tenantName' in p.properties);
  if (!page) {
    throw new Error('no parameters page defines a tenantName property');
  }
  const raw = page.properties.tenantName as Record<string, unknown>;
  const schema: Record<string, unknown> = {};
  for (const key of ['type', 'pattern', 'minLength', 'maxLength', 'enum']) {
    if (key in raw) {
      schema[key] = raw[key];
    }
  }
  return schema;
}

/**
 * isBugCondition(input) from the design: input matches the fixed pattern
 * `^[A-Za-z0-9-]{1,32}$` but NOT the original `^[a-z0-9-]{1,32}$` -- i.e. it is
 * 1-32 chars of letters/digits/hyphens and contains at least one uppercase.
 */
function isBugCondition(input: string): boolean {
  return FIXED_PATTERN.test(input) && !OLD_PATTERN.test(input);
}

/** Deterministic bug-condition names from the design, for reproducibility. */
const CONCRETE_BUG_NAMES = ['MYCOMPANY', 'MyTenant', 'Tenant-01', 'A'];

describe('tenant-provisioning template: uppercase tenantName is accepted (bug condition)', () => {
  const tenantNameSchema = extractTenantNameSchema();
  const ajv = new Ajv({ allErrors: true });
  const validateFrontend = ajv.compile(tenantNameSchema);

  // Guard: confirms the concrete cases really are bug-condition inputs.
  it('classifies the concrete cases as bug-condition inputs', () => {
    for (const name of CONCRETE_BUG_NAMES) {
      expect(isBugCondition(name)).toBe(true);
    }
  });

  // Property 1 (Bug Condition), frontend: each concrete uppercase-containing
  // name must be ACCEPTED by the committed template schema. On unfixed code
  // these FAIL because the pattern is `^[a-z0-9-]{1,32}$`.
  // Validates: Requirements 1.1, 2.1
  it.each(CONCRETE_BUG_NAMES)(
    'frontend schema accepts uppercase-containing name %p (Req 1.1, 2.1)',
    name => {
      expect(validateFrontend(name)).toBe(true);
    },
  );

  // Property 1 (Bug Condition), scoped PBT (frontend): generate random 1-32
  // char letters/digits/hyphens strings containing at least one uppercase and
  // assert the frontend schema accepts every one. On unfixed code this FAILS,
  // surfacing counterexamples that prove the bug.
  // Validates: Requirements 1.1, 2.1
  it('frontend schema accepts every bug-condition name (Property 1)', () => {
    const alphabet = fc.constantFrom(
      ...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-'.split(
        '',
      ),
    );
    const bugConditionName = fc
      .array(alphabet, { minLength: 1, maxLength: 32 })
      .map(chars => chars.join(''))
      .filter(isBugCondition);

    fc.assert(
      fc.property(bugConditionName, name => {
        expect(validateFrontend(name)).toBe(true);
      }),
      { numRuns: 500 },
    );
  });
});
