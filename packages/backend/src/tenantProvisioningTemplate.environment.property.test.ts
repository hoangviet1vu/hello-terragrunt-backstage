/**
 * Property-based test for the tenant-provisioning template's `environment`
 * parameter JSON Schema.
 *
 * This exercises the *committed* `environment` sub-schema extracted from
 * `templates/tenant-provisioning/template.yaml` (the same schema react-json
 * schema-form uses in the scaffolder frontend) by validating candidate values
 * with `ajv`, matching the JSON Schema semantics rjsf relies on.
 *
 * See the tenant-provisioning-template design ("Correctness Properties" →
 * Property 2, and "Testing Strategy" → Property-based tests).
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
  const page = pages.find(
    p => p?.properties && 'environment' in p.properties,
  );
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
 * Reference oracle: an environment value is valid iff its length is in [1, 12]
 * and every character is in the allowed alphabet [a-z0-9-].
 */
const ALLOWED_CHAR = /^[a-z0-9-]$/;
function isValidEnvironment(s: string): boolean {
  if (s.length < 1 || s.length > 12) {
    return false;
  }
  return [...s].every(ch => ALLOWED_CHAR.test(ch));
}

describe('tenant-provisioning template: environment parameter schema', () => {
  const environmentSchema = extractEnvironmentSchema();
  const ajv = new Ajv({ allErrors: true });
  const validate = ajv.compile(environmentSchema);

  it('extracts a string schema with the committed 1-12 [a-z0-9-] pattern', () => {
    // Guard: confirms the property test is exercising the real constraint.
    expect(environmentSchema.type).toBe('string');
    expect(environmentSchema.pattern).toBe('^[a-z0-9-]{1,12}$');
  });

  // Feature: tenant-provisioning-template, Property 2: Environment schema
  // accepts exactly the valid values — for all strings v, validation succeeds
  // iff v has length in [1,12] and every character of v is in [a-z0-9-].
  // Validates: Requirements 3.4, 3.5, 3.6, 3.7, 3.8
  it('accepts a value iff length in [1,12] and all chars in [a-z0-9-] (Property 2)', () => {
    const allowedAlphabet = fc.constantFrom(
      ...'abcdefghijklmnopqrstuvwxyz0123456789-'.split(''),
    );

    const candidate = fc.oneof(
      // Arbitrary unicode strings (may include disallowed chars / any length).
      fc.string({ unit: 'grapheme', maxLength: 20 }),
      // Allowed-alphabet strings across lengths 0..20 (covers valid + too-long).
      fc
        .array(allowedAlphabet, { minLength: 0, maxLength: 20 })
        .map(chars => chars.join('')),
      // Whitespace-only strings (must be rejected).
      fc
        .array(fc.constantFrom(' ', '\t', '\n', '\r'), {
          minLength: 1,
          maxLength: 10,
        })
        .map(chars => chars.join('')),
      // Otherwise-valid allowed string with one disallowed char spliced in.
      fc
        .tuple(
          fc
            .array(allowedAlphabet, { minLength: 0, maxLength: 10 })
            .map(chars => chars.join('')),
          fc.constantFrom('A', 'Z', '_', '.', '/', ' ', 'é', '好'),
          fc
            .array(allowedAlphabet, { minLength: 0, maxLength: 10 })
            .map(chars => chars.join('')),
        )
        .map(([a, bad, b]) => `${a}${bad}${b}`),
    );

    fc.assert(
      fc.property(candidate, v => {
        const ajvResult = validate(v) as boolean;
        expect(ajvResult).toBe(isValidEnvironment(v));
      }),
      { numRuns: 500 },
    );
  });
});
