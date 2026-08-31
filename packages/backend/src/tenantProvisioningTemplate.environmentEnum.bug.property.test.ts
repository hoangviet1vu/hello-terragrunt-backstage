/**
 * Bug condition exploration test for the tenant-provisioning template's
 * `environment` parameter JSON Schema (spec: environment-enum-validation).
 *
 * This test encodes the EXPECTED (post-fix) behavior described in the bugfix
 * design's "Correctness Properties" → Property 1: any `environment` value that
 * matches the old free-text pattern `^[a-z0-9-]{1,12}$` but is NOT one of the
 * four allowed values `{dev, test, uat, prod}` must be REJECTED, and the schema
 * must present a constrained choice (`enum`) rather than a `pattern`/free-text
 * control.
 *
 * IMPORTANT: This test is EXPECTED TO FAIL on the current (unfixed) code. The
 * unfixed `environment` schema uses `pattern: '^[a-z0-9-]{1,12}$'` (no `enum`),
 * so out-of-set values like `staging`, `production`, and `foo` are accepted and
 * the field is free-text. That failure is the proof that the bug exists. Do NOT
 * fix the test or the template in this task — once the fix (task 3) replaces the
 * `pattern` with `enum: [dev, test, uat, prod]`, this same test will pass.
 *
 * It mirrors the scaffolder's validation by extracting the committed
 * `environment` sub-schema from `templates/tenant-provisioning/template.yaml`
 * and validating candidate values with `ajv` (the JSON Schema semantics rjsf
 * relies on in the scaffolder frontend).
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

/** The four allowed environment values (the target `enum` after the fix). */
const ALLOWED_ENVIRONMENTS = ['dev', 'test', 'uat', 'prod'] as const;

/** The old free-text pattern that admits out-of-set values (the bug). */
const OLD_PATTERN = /^[a-z0-9-]{1,12}$/;

/** Read and parse a YAML file at an absolute path into a plain object. */
function loadYaml(filePath: string): any {
  const raw = fs.readFileSync(filePath, 'utf8');
  return yaml.load(raw) as any;
}

/**
 * Extract the committed `environment` property sub-schema from the loaded
 * template's first parameters page. Only the JSON Schema keywords are kept
 * (rjsf `ui:*` hints and `default` are not value-validation keywords and are
 * ignored for single-value validation).
 */
function extractEnvironmentSchema(): Record<string, unknown> {
  const template = loadYaml(templatePath);
  const pages = template?.spec?.parameters;
  if (!Array.isArray(pages)) {
    throw new Error('template spec.parameters is not an array');
  }
  const page = pages.find(p => p?.properties && 'environment' in p.properties);
  if (!page) {
    throw new Error('no parameters page defines an environment property');
  }
  const raw = page.properties.environment as Record<string, unknown>;
  // Keep only recognised JSON Schema keywords for validation of a single value.
  const schema: Record<string, unknown> = {};
  for (const key of ['type', 'pattern', 'minLength', 'maxLength', 'enum']) {
    if (key in raw) {
      schema[key] = raw[key];
    }
  }
  return schema;
}

/**
 * isBugCondition(X) from the design: X matches the old pattern
 * `^[a-z0-9-]{1,12}$` AND X is NOT one of the allowed environment values.
 */
function isBugCondition(x: string): boolean {
  return (
    OLD_PATTERN.test(x) &&
    !(ALLOWED_ENVIRONMENTS as readonly string[]).includes(x)
  );
}

describe('tenant-provisioning template: environment enum validation (bug condition)', () => {
  const environmentSchema = extractEnvironmentSchema();
  const ajv = new Ajv({ allErrors: true });
  const validate = ajv.compile(environmentSchema);

  // Requirement 2.2: the form must present a constrained choice (enum/dropdown)
  // rather than a free-text pattern control. On unfixed code this FAILS because
  // the schema declares `pattern` and no `enum`.
  it('exposes a constrained enum of [dev, test, uat, prod] and no free-text pattern (Req 2.2)', () => {
    expect(environmentSchema.type).toBe('string');
    expect(environmentSchema.enum).toEqual([...ALLOWED_ENVIRONMENTS]);
    expect(environmentSchema.pattern).toBeUndefined();
  });

  // Property 1 (Bug Condition): for all X where isBugCondition(X) holds, the
  // schema must REJECT X. Deterministic counterexamples from the design.
  // On unfixed code these FAIL because the pattern accepts them.
  // Validates: Requirements 2.1, 2.3
  it.each(['staging', 'production', 'foo'])(
    'rejects the out-of-set environment value %p (Req 2.1)',
    value => {
      expect(isBugCondition(value)).toBe(true);
      expect(validate(value)).toBe(false);
    },
  );

  // Property 1 (Bug Condition), scoped PBT: generate random strings matching
  // `^[a-z0-9-]{1,12}$` that are NOT in {dev, test, uat, prod} and assert every
  // one is rejected by the schema. On unfixed code this FAILS (pattern accepts
  // them), surfacing counterexamples that prove the bug.
  // Validates: Requirements 2.1, 2.3
  it('rejects every out-of-set value matching ^[a-z0-9-]{1,12}$ (Property 1)', () => {
    const allowedAlphabet = fc.constantFrom(
      ...'abcdefghijklmnopqrstuvwxyz0123456789-'.split(''),
    );

    // Strings of length 1..12 over [a-z0-9-] that are not one of the allowed
    // values — i.e. exactly the domain where isBugCondition holds.
    const bugConditionValue = fc
      .array(allowedAlphabet, { minLength: 1, maxLength: 12 })
      .map(chars => chars.join(''))
      .filter(isBugCondition);

    fc.assert(
      fc.property(bugConditionValue, value => {
        expect(validate(value)).toBe(false);
      }),
      { numRuns: 500 },
    );
  });
});
