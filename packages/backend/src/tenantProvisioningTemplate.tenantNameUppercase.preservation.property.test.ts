/**
 * Preservation property tests for the tenant-provisioning "Tenant name"
 * FRONTEND validation (spec: tenant-name-allow-uppercase).
 *
 * These tests encode the BASELINE behavior that the fix must PRESERVE, as
 * described in the bugfix design's "Correctness Properties" -> Property 2
 * (Preservation) and the Preservation Requirements (Requirements 3.1-3.5): for
 * any input where the bug condition does NOT hold (isBugCondition returns
 * false), the fixed template must produce the SAME accept/reject result as the
 * original template. Concretely, at the frontend `tenantName` JSON Schema
 * `pattern` in `templates/tenant-provisioning/template.yaml`:
 *   - lowercase-valid names (`sampletenant`, `tenant-01`, generated
 *     `^[a-z0-9-]{1,32}$`) remain ACCEPTED (Req 3.1),
 *   - empty and whitespace-only names remain REJECTED (Req 3.2),
 *   - names longer than 32 characters remain REJECTED (Req 3.3),
 *   - names with characters outside letters/digits/hyphens (space, `_`, `.`,
 *     `/`, unicode) remain REJECTED (Req 3.4), and
 *   - the `environment` enum and the `components` multi-select validate and
 *     collect exactly as today (Req 3.5).
 *
 * Following observation-first methodology, these tests capture behavior
 * observed on the UNFIXED schema. They are EXPECTED TO PASS on the current
 * (unfixed) code -- that pass confirms the baseline that must survive the fix.
 * They are written so they continue to hold after the fix broadens the pattern
 * to `^[A-Za-z0-9-]{1,32}$`, because every case they assert on is NOT a bug
 * condition (no bug-condition inputs are generated), and on non-bug-condition
 * inputs the old and fixed patterns agree by construction.
 *
 * Like the other template tests this mirrors the scaffolder's validation by
 * extracting the committed sub-schemas from `template.yaml` and validating
 * candidate values with `ajv` (the JSON Schema semantics rjsf relies on),
 * using `fast-check` for property-based generation.
 *
 * Bug condition (from design): isBugCondition(input) is true iff input matches
 * `^[A-Za-z0-9-]{1,32}$` but does NOT match `^[a-z0-9-]{1,32}$`.
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

/** The four allowed environment values (unaffected by the tenant name change). */
const ALLOWED_ENVIRONMENTS = ['dev', 'test', 'uat', 'prod'] as const;

/** Read and parse a YAML file at an absolute path into a plain object. */
function loadYaml(filePath: string): any {
  const raw = fs.readFileSync(filePath, 'utf8');
  return yaml.load(raw) as any;
}

/** Load the whole template document once. */
function loadTemplate(): any {
  return loadYaml(templatePath);
}

/**
 * Find the first parameters page that defines the given property name and
 * return that page.
 */
function findPageWithProperty(template: any, propertyName: string): any {
  const pages = template?.spec?.parameters;
  if (!Array.isArray(pages)) {
    throw new Error('template spec.parameters is not an array');
  }
  const page = pages.find(p => p?.properties && propertyName in p.properties);
  if (!page) {
    throw new Error(`no parameters page defines a ${propertyName} property`);
  }
  return page;
}

/**
 * Extract a single property's sub-schema, keeping only recognised JSON Schema
 * keywords for validation of a single value (rjsf `ui:*` hints and `default`
 * are not value-validation keywords and are ignored here).
 */
function extractPropertySchema(
  template: any,
  propertyName: string,
): Record<string, unknown> {
  const page = findPageWithProperty(template, propertyName);
  const raw = page.properties[propertyName] as Record<string, unknown>;
  const schema: Record<string, unknown> = {};
  for (const key of ['type', 'pattern', 'minLength', 'maxLength', 'enum']) {
    if (key in raw) {
      schema[key] = raw[key];
    }
  }
  return schema;
}

/** Read a raw property object (including `default`, `title`, etc.). */
function rawProperty(
  template: any,
  propertyName: string,
): Record<string, unknown> {
  const page = findPageWithProperty(template, propertyName);
  return page.properties[propertyName] as Record<string, unknown>;
}

/**
 * isBugCondition(input) from the design: input matches the fixed pattern
 * `^[A-Za-z0-9-]{1,32}$` but NOT the original `^[a-z0-9-]{1,32}$` -- i.e. it is
 * 1-32 chars of letters/digits/hyphens and contains at least one uppercase.
 */
function isBugCondition(input: string): boolean {
  return FIXED_PATTERN.test(input) && !OLD_PATTERN.test(input);
}

/**
 * Reference oracle for the CURRENT (unfixed) tenantName schema: valid iff
 * length in [1,32] and every character is in [a-z0-9-].
 */
const LOWERCASE_ALLOWED_CHAR = /^[a-z0-9-]$/;
function isValidTenantNameOriginal(s: string): boolean {
  if (s.length < 1 || s.length > 32) {
    return false;
  }
  return [...s].every(ch => LOWERCASE_ALLOWED_CHAR.test(ch));
}

describe('tenant-provisioning template: tenantName preservation (baseline to keep)', () => {
  const template = loadTemplate();
  const ajv = new Ajv({ allErrors: true });

  const tenantNameSchema = extractPropertySchema(template, 'tenantName');
  const validateTenantName = ajv.compile(tenantNameSchema);

  const environmentSchema = extractPropertySchema(template, 'environment');
  const validateEnvironment = ajv.compile(environmentSchema);

  // Property 2 (Preservation), Req 3.1: lowercase-valid names are accepted.
  // Concrete anchors from the design plus generated `^[a-z0-9-]{1,32}$` names.
  // These are NOT bug conditions, so old and fixed patterns agree.
  // Validates: Requirements 3.1
  it.each(['sampletenant', 'tenant-01', 'a', 'z', '0', '-', 'a'.repeat(32)])(
    'frontend schema accepts the lowercase-valid name %p (Req 3.1)',
    name => {
      expect(isBugCondition(name)).toBe(false);
      expect(validateTenantName(name)).toBe(true);
    },
  );

  // Property 2 (Preservation), Req 3.1 (PBT): every generated 1-32 char
  // [a-z0-9-] name is accepted. None are bug conditions.
  // Validates: Requirements 3.1
  it('frontend schema accepts every generated lowercase [a-z0-9-]{1,32} name (Req 3.1)', () => {
    const lowerAlphabet = fc.constantFrom(
      ...'abcdefghijklmnopqrstuvwxyz0123456789-'.split(''),
    );
    const validLowercaseName = fc
      .array(lowerAlphabet, { minLength: 1, maxLength: 32 })
      .map(chars => chars.join(''));

    fc.assert(
      fc.property(validLowercaseName, name => {
        expect(isBugCondition(name)).toBe(false);
        expect(validateTenantName(name)).toBe(true);
      }),
      { numRuns: 500 },
    );
  });

  // Property 2 (Preservation), Req 3.2: empty and whitespace-only names are
  // rejected. Not bug conditions.
  // Validates: Requirements 3.2
  it('frontend schema rejects empty and whitespace-only names (Req 3.2)', () => {
    expect(isBugCondition('')).toBe(false);
    expect(validateTenantName('')).toBe(false);

    const whitespaceName = fc
      .array(fc.constantFrom(' ', '\t', '\n', '\r'), {
        minLength: 1,
        maxLength: 10,
      })
      .map(chars => chars.join(''));

    fc.assert(
      fc.property(whitespaceName, name => {
        expect(isBugCondition(name)).toBe(false);
        expect(validateTenantName(name)).toBe(false);
      }),
      { numRuns: 200 },
    );
  });

  // Property 2 (Preservation), Req 3.3: names longer than 32 characters are
  // rejected, for both all-lowercase and mixed-case alphabets. Over-length
  // names never satisfy the bug condition (which requires length <= 32).
  // Validates: Requirements 3.3
  it('frontend schema rejects names longer than 32 characters (Req 3.3)', () => {
    // Boundary: exactly 33 all-lowercase chars.
    expect(validateTenantName('a'.repeat(33))).toBe(false);
    // Boundary: exactly 33 mixed-case chars.
    expect(validateTenantName(`A${'a'.repeat(32)}`)).toBe(false);

    const overLengthAlphabet = fc.constantFrom(
      ...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-'.split(
        '',
      ),
    );
    const overLengthName = fc
      .array(overLengthAlphabet, { minLength: 33, maxLength: 80 })
      .map(chars => chars.join(''));

    fc.assert(
      fc.property(overLengthName, name => {
        expect(isBugCondition(name)).toBe(false);
        expect(validateTenantName(name)).toBe(false);
      }),
      { numRuns: 300 },
    );
  });

  // Property 2 (Preservation), Req 3.4: names containing a disallowed character
  // (space, `_`, `.`, `/`, or unicode) are rejected. A name with any of these
  // cannot match `^[A-Za-z0-9-]{1,32}$`, so it is never a bug condition.
  // Validates: Requirements 3.4
  it('frontend schema rejects names with a spliced-in disallowed character (Req 3.4)', () => {
    for (const bad of [' ', '_', '.', '/', 'é', '好']) {
      expect(validateTenantName(`tenant${bad}01`)).toBe(false);
    }

    const allowedAlphabet = fc.constantFrom(
      ...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-'.split(
        '',
      ),
    );
    const disallowedChar = fc.constantFrom(' ', '_', '.', '/', 'é', '好');
    const nameWithDisallowedChar = fc
      .tuple(
        fc
          .array(allowedAlphabet, { minLength: 0, maxLength: 15 })
          .map(chars => chars.join('')),
        disallowedChar,
        fc
          .array(allowedAlphabet, { minLength: 0, maxLength: 15 })
          .map(chars => chars.join('')),
      )
      .map(([a, bad, b]) => `${a}${bad}${b}`);

    fc.assert(
      fc.property(nameWithDisallowedChar, name => {
        // Contains a disallowed char => not a bug condition => rejected.
        expect(isBugCondition(name)).toBe(false);
        expect(validateTenantName(name)).toBe(false);
      }),
      { numRuns: 500 },
    );
  });

  // Property 2 (Preservation), broad cross-check: for ANY non-bug-condition
  // input, the committed (unfixed) schema's accept/reject result equals the
  // original oracle. This is the FOR ALL X WHERE NOT isBugCondition(X)
  // direction that the fix must preserve.
  // Validates: Requirements 3.1, 3.2, 3.3, 3.4
  it('frontend schema result equals the original oracle for every non-bug-condition input (Property 2)', () => {
    const allowedAlphabet = fc.constantFrom(
      ...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-'.split(
        '',
      ),
    );

    const candidate = fc.oneof(
      fc.string({ unit: 'grapheme', maxLength: 40 }),
      fc
        .array(allowedAlphabet, { minLength: 0, maxLength: 40 })
        .map(chars => chars.join('')),
      fc
        .array(fc.constantFrom(' ', '\t', '\n', '\r'), {
          minLength: 1,
          maxLength: 10,
        })
        .map(chars => chars.join('')),
      fc
        .tuple(
          fc
            .array(allowedAlphabet, { minLength: 0, maxLength: 20 })
            .map(chars => chars.join('')),
          fc.constantFrom('_', '.', '/', ' ', 'é', '好'),
          fc
            .array(allowedAlphabet, { minLength: 0, maxLength: 20 })
            .map(chars => chars.join('')),
        )
        .map(([a, bad, b]) => `${a}${bad}${b}`),
    );

    fc.assert(
      fc.property(candidate, s => {
        // Restrict to the preservation domain (non-bug-condition inputs).
        fc.pre(!isBugCondition(s));
        expect(validateTenantName(s)).toBe(isValidTenantNameOriginal(s));
      }),
      { numRuns: 1000 },
    );
  });

  // Property 2 (Preservation), Req 3.5: the environment enum and the component
  // flags validate/collect exactly as today, unaffected by the tenant name
  // change.
  // Validates: Requirements 3.5
  it('accepts every valid environment value and rejects out-of-set values (Req 3.5)', () => {
    fc.assert(
      fc.property(fc.constantFrom(...ALLOWED_ENVIRONMENTS), value => {
        expect(validateEnvironment(value)).toBe(true);
      }),
      { numRuns: 100 },
    );
    for (const bad of ['staging', 'production', 'Dev', 'PROD', '']) {
      expect(validateEnvironment(bad)).toBe(false);
    }
  });

  // Property 2 (Preservation), Req 3.5: the `components` multi-select remains a
  // unique-item array over the enum {dynamodb, ecr} defaulting to [] and is
  // collected/validated unchanged.
  // Validates: Requirements 3.5
  it('preserves components as a unique-item array over {dynamodb, ecr} defaulting to [] (Req 3.5)', () => {
    const raw = rawProperty(template, 'components');
    expect(raw.type).toBe('array');
    expect(raw.uniqueItems).toBe(true);
    expect(raw.default).toEqual([]);
    expect((raw.items as Record<string, unknown>).enum).toEqual([
      'dynamodb',
      'ecr',
    ]);

    // Validate the full array schema (type + items enum + uniqueItems) with ajv.
    const componentsSchema: Record<string, unknown> = {};
    for (const key of ['type', 'items', 'uniqueItems']) {
      if (key in raw) {
        componentsSchema[key] = raw[key];
      }
    }
    const validateComponents = ajv.compile(componentsSchema);

    // Every subset of the allowed components (with no duplicates) is accepted.
    const componentSubset = fc.subarray(['dynamodb', 'ecr']);
    fc.assert(
      fc.property(componentSubset, value => {
        expect(validateComponents(value)).toBe(true);
      }),
      { numRuns: 50 },
    );

    // The default [] is accepted; unknown values, duplicates, and non-arrays
    // are rejected exactly as today.
    expect(validateComponents([])).toBe(true);
    expect(validateComponents(['dynamodb'])).toBe(true);
    expect(validateComponents(['dynamodb', 'ecr'])).toBe(true);
    expect(validateComponents(['dynamodb', 'dynamodb'])).toBe(false);
    expect(validateComponents(['unknown'])).toBe(false);
    expect(validateComponents('dynamodb')).toBe(false);
  });
});
