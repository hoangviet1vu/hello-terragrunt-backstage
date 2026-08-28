/**
 * Property-based test for the tenant-provisioning template's `tenantName`
 * parameter JSON Schema.
 *
 * This exercises the *committed* `tenantName` sub-schema extracted from
 * `templates/tenant-provisioning/template.yaml` (the same schema react-json
 * schema-form uses in the scaffolder frontend) by validating candidate values
 * with `ajv`, matching the JSON Schema semantics rjsf relies on.
 *
 * See the tenant-provisioning-template design ("Correctness Properties" →
 * Property 1, and "Testing Strategy" → Property-based tests).
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
  const page = pages.find(
    p => p?.properties && 'tenantName' in p.properties,
  );
  if (!page) {
    throw new Error('no parameters page defines a tenantName property');
  }
  const raw = page.properties.tenantName as Record<string, unknown>;
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
 * Reference oracle: a tenant name is valid iff its length is in [1, 32] and
 * every character is in the allowed alphabet [a-z0-9-].
 */
const ALLOWED_CHAR = /^[a-z0-9-]$/;
function isValidTenantName(s: string): boolean {
  if (s.length < 1 || s.length > 32) {
    return false;
  }
  return [...s].every(ch => ALLOWED_CHAR.test(ch));
}

describe('tenant-provisioning template: tenantName parameter schema', () => {
  const tenantNameSchema = extractTenantNameSchema();
  const ajv = new Ajv({ allErrors: true });
  const validate = ajv.compile(tenantNameSchema);

  it('extracts a string schema with the committed 1-32 [a-z0-9-] pattern', () => {
    // Guard: confirms the property test is exercising the real constraint.
    expect(tenantNameSchema.type).toBe('string');
    expect(tenantNameSchema.pattern).toBe('^[a-z0-9-]{1,32}$');
  });

  // Feature: tenant-provisioning-template, Property 1: Tenant name schema
  // accepts exactly the valid names — for all strings s, validation succeeds
  // iff s has length in [1,32] and every character of s is in [a-z0-9-].
  // Validates: Requirements 2.3, 2.4, 2.5, 2.6, 2.7
  it('accepts a value iff length in [1,32] and all chars in [a-z0-9-] (Property 1)', () => {
    const allowedAlphabet = fc.constantFrom(
      ...'abcdefghijklmnopqrstuvwxyz0123456789-'.split(''),
    );

    const candidate = fc.oneof(
      // Arbitrary unicode strings (may include disallowed chars / any length).
      fc.string({ unit: 'grapheme', maxLength: 40 }),
      // Allowed-alphabet strings across lengths 0..40 (covers valid + too-long).
      fc
        .array(allowedAlphabet, { minLength: 0, maxLength: 40 })
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
            .array(allowedAlphabet, { minLength: 0, maxLength: 20 })
            .map(chars => chars.join('')),
          fc.constantFrom('A', 'Z', '_', '.', '/', ' ', 'é', '好'),
          fc
            .array(allowedAlphabet, { minLength: 0, maxLength: 20 })
            .map(chars => chars.join('')),
        )
        .map(([a, bad, b]) => `${a}${bad}${b}`),
    );

    fc.assert(
      fc.property(candidate, s => {
        const ajvResult = validate(s) as boolean;
        expect(ajvResult).toBe(isValidTenantName(s));
      }),
      { numRuns: 500 },
    );
  });
});
