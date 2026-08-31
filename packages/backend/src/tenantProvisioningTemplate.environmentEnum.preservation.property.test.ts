/**
 * Preservation property tests for the tenant-provisioning template
 * (spec: environment-enum-validation).
 *
 * These tests encode the BASELINE behavior that the fix must PRESERVE, as
 * described in the bugfix design's "Correctness Properties" → Property 2
 * (Preservation) and the Preservation Requirements (Requirements 3.1-3.4):
 * for any input where `isBugCondition(X)` does NOT hold, the fixed template
 * must behave the same as the original template. In particular:
 *   - the four valid environment values `{dev, test, uat, prod}` remain accepted,
 *   - the `environment` field keeps `default: dev`,
 *   - the other parameters (`tenantName`, `dynamodb`, `ecr`) validate/collect
 *     unchanged, and
 *   - the `debug:log` step and `output.text` block still echo the selected
 *     `environment` (and the other inputs) unchanged.
 *
 * Following observation-first methodology, these tests capture behavior observed
 * on the UNFIXED schema. They are EXPECTED TO PASS on the current (unfixed) code
 * — that pass confirms the baseline that must survive the fix in task 3. They
 * are written so they continue to hold after the fix replaces the `environment`
 * `pattern` with `enum: [dev, test, uat, prod]`, since every value they assert
 * on is a member of that enum.
 *
 * Like task 1's test, this mirrors the scaffolder's validation by extracting the
 * committed sub-schemas from `templates/tenant-provisioning/template.yaml` and
 * validating candidate values with `ajv` (the JSON Schema semantics rjsf relies
 * on in the scaffolder frontend), and uses `fast-check` for property-based
 * generation.
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

/** The four allowed environment values (preserved before and after the fix). */
const ALLOWED_ENVIRONMENTS = ['dev', 'test', 'uat', 'prod'] as const;

/** The old free-text pattern that admits out-of-set values (the bug). */
const OLD_PATTERN = /^[a-z0-9-]{1,12}$/;

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
  const page = pages.find(
    p => p?.properties && propertyName in p.properties,
  );
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
  for (const key of [
    'type',
    'pattern',
    'minLength',
    'maxLength',
    'enum',
    'const',
  ]) {
    if (key in raw) {
      schema[key] = raw[key];
    }
  }
  return schema;
}

/** Read a raw property object (including `default`, `title`, etc.). */
function rawProperty(template: any, propertyName: string): Record<string, unknown> {
  const page = findPageWithProperty(template, propertyName);
  return page.properties[propertyName] as Record<string, unknown>;
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

describe('tenant-provisioning template: preservation (baseline behavior to keep)', () => {
  const template = loadTemplate();
  const ajv = new Ajv({ allErrors: true });

  const environmentSchema = extractPropertySchema(template, 'environment');
  const validateEnvironment = ajv.compile(environmentSchema);

  const tenantNameSchema = extractPropertySchema(template, 'tenantName');
  const validateTenantName = ajv.compile(tenantNameSchema);

  // Property 2 (Preservation): the four valid environment values are NOT bug
  // conditions and must be accepted, identically before and after the fix.
  // Validates: Requirements 3.2
  it('accepts every valid environment value in {dev, test, uat, prod} (Property 2)', () => {
    fc.assert(
      fc.property(fc.constantFrom(...ALLOWED_ENVIRONMENTS), value => {
        // These are, by definition, not bug conditions.
        expect(isBugCondition(value)).toBe(false);
        // Baseline: the unfixed schema accepts them; the fix keeps them in the enum.
        expect(validateEnvironment(value)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  // Requirement 3.1: the environment field keeps `default: dev`.
  it('preserves the environment default of "dev" (Req 3.1)', () => {
    const env = rawProperty(template, 'environment');
    expect(env.default).toBe('dev');
    // The default must be one of the allowed values so it survives the enum fix.
    expect(
      (ALLOWED_ENVIRONMENTS as readonly string[]).includes(env.default as string),
    ).toBe(true);
    // The default itself validates against the environment schema.
    expect(validateEnvironment(env.default)).toBe(true);
  });

  // Requirement 3.3: tenantName is validated/collected unchanged. tenantName is
  // out of scope for the fix, so its acceptance must be identical throughout.
  it('preserves tenantName validation over its pattern ^[A-Za-z0-9-]{1,32}$ (Req 3.3)', () => {
    // The tenantName schema itself must be unchanged (pattern-based, string).
    expect(tenantNameSchema.type).toBe('string');
    expect(tenantNameSchema.pattern).toBe('^[A-Za-z0-9-]{1,32}$');

    const tenantNameValue = fc
      .array(
        fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-'.split('')),
        { minLength: 1, maxLength: 32 },
      )
      .map(chars => chars.join(''));

    fc.assert(
      fc.property(tenantNameValue, value => {
        // Reference expectation = the documented pattern; baseline schema agrees.
        const expected = /^[a-z0-9-]{1,32}$/.test(value);
        expect(validateTenantName(value)).toBe(expected);
        expect(expected).toBe(true);
      }),
      { numRuns: 300 },
    );
  });

  // Requirement 3.3: dynamodb and ecr are boolean flags defaulting to false and
  // must be collected/validated unchanged.
  it('preserves dynamodb and ecr as boolean flags defaulting to false (Req 3.3)', () => {
    for (const name of ['dynamodb', 'ecr']) {
      const raw = rawProperty(template, name);
      expect(raw.type).toBe('boolean');
      expect(raw.default).toBe(false);

      const validate = ajv.compile(extractPropertySchema(template, name));
      fc.assert(
        fc.property(fc.boolean(), value => {
          // Any boolean is accepted; non-booleans are rejected.
          expect(validate(value)).toBe(true);
        }),
        { numRuns: 50 },
      );
      expect(validate('true')).toBe(false);
      expect(validate(1)).toBe(false);
    }
  });

  // Requirement 3.4: the debug:log step and output.text block still reference
  // and echo ${{ parameters.environment }} (and the other inputs) unchanged.
  it('preserves the debug:log step and output echoing the collected inputs (Req 3.4)', () => {
    const steps = template?.spec?.steps;
    expect(Array.isArray(steps)).toBe(true);

    const logStep = steps.find((s: any) => s.action === 'debug:log');
    expect(logStep).toBeDefined();
    const message: string = logStep.input.message;
    expect(message).toContain('${{ parameters.environment }}');
    expect(message).toContain('${{ parameters.tenantName }}');
    expect(message).toContain('${{ parameters.dynamodb }}');
    expect(message).toContain('${{ parameters.ecr }}');

    const outputText = template?.spec?.output?.text;
    expect(Array.isArray(outputText)).toBe(true);
    const content: string = outputText
      .map((entry: any) => entry.content)
      .join('\n');
    expect(content).toContain('${{ parameters.environment }}');
    expect(content).toContain('${{ parameters.tenantName }}');
    expect(content).toContain('${{ parameters.dynamodb }}');
    expect(content).toContain('${{ parameters.ecr }}');
  });

  // Preservation cross-check: for a sample of non-bug-condition environment
  // values (the allowed set), acceptance is identical to the documented
  // reference. This is the FOR ALL X WHERE NOT isBugCondition(X) direction of
  // Property 2 restricted to the environment domain the schema controls.
  it('accepts all non-bug-condition environment draws from the allowed set (Property 2)', () => {
    fc.assert(
      fc.property(fc.constantFrom(...ALLOWED_ENVIRONMENTS), value => {
        fc.pre(!isBugCondition(value));
        expect(validateEnvironment(value)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });
});
