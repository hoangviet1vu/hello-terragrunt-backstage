/**
 * Structural / schema-validation unit test for the tenant-provisioning
 * Software Template.
 *
 * This loads `templates/tenant-provisioning/template.yaml`, parses YAML to an
 * object, validates it as a `scaffolder.backstage.io/v1beta3` `Template`
 * entity, and asserts the deterministic single-artifact facts described in the
 * design's "Testing Strategy → Example / structural unit tests" section.
 *
 * These facts do not vary with input, so they are covered here as example
 * assertions (one per criterion group) rather than property-based tests.
 */

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
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
 * A minimal JSON Schema describing the structural shape of a
 * `scaffolder.backstage.io/v1beta3` `Template` entity, sufficient to confirm
 * the loaded document is a valid Template of that apiVersion/kind with the
 * required metadata and spec fields. This is not the full Backstage entity
 * schema; it validates the fields this feature is responsible for.
 */
const templateEntitySchema = {
  type: 'object',
  required: ['apiVersion', 'kind', 'metadata', 'spec'],
  properties: {
    apiVersion: { const: 'scaffolder.backstage.io/v1beta3' },
    kind: { const: 'Template' },
    metadata: {
      type: 'object',
      required: ['name', 'title', 'description'],
      properties: {
        name: { type: 'string', minLength: 1 },
        title: { type: 'string', minLength: 1 },
        description: { type: 'string', minLength: 1 },
      },
    },
    spec: {
      type: 'object',
      required: ['owner', 'type', 'parameters', 'steps'],
      properties: {
        owner: { type: 'string', minLength: 1 },
        type: { type: 'string', minLength: 1 },
        parameters: { type: 'array', minItems: 1 },
        steps: { type: 'array' },
      },
    },
  },
} as const;

/** Non-empty-string helper used across assertions. */
function isNonEmptyString(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

describe('tenant-provisioning template: structural / schema validation', () => {
  const template = loadYaml(templatePath);

  // Locate the parameters page that defines the four inputs.
  const parametersPages = template?.spec?.parameters;
  const page = Array.isArray(parametersPages)
    ? parametersPages.find(p => p?.properties && 'tenantName' in p.properties)
    : undefined;
  const properties = page?.properties ?? {};
  const requiredList: string[] = Array.isArray(page?.required)
    ? page.required
    : [];

  it('is a valid scaffolder.backstage.io/v1beta3 Template entity (Req 1.1, 1.9)', () => {
    const ajv = new Ajv({ allErrors: true });
    const validate = ajv.compile(templateEntitySchema);
    const valid = validate(template);
    // Surface ajv errors if validation fails, to make debugging easy.
    expect(validate.errors ?? []).toEqual([]);
    expect(valid).toBe(true);
  });

  it('declares the expected apiVersion and kind (Req 1.1)', () => {
    expect(template.apiVersion).toBe('scaffolder.backstage.io/v1beta3');
    expect(template.kind).toBe('Template');
  });

  it('declares metadata.name of tenant-provisioning-template (Req 1.2)', () => {
    expect(template.metadata.name).toBe('tenant-provisioning-template');
  });

  it('declares a non-empty metadata.title and description (Req 1.3)', () => {
    expect(isNonEmptyString(template.metadata.title)).toBe(true);
    expect(isNonEmptyString(template.metadata.description)).toBe(true);
  });

  it('declares spec.type of service (Req 1.4)', () => {
    expect(template.spec.type).toBe('service');
  });

  it('declares a non-empty spec.owner entity reference (Req 1.5)', () => {
    expect(isNonEmptyString(template.spec.owner)).toBe(true);
  });

  describe('tenantName parameter (Req 2.1, 2.2, 2.4)', () => {
    const tenantName = properties.tenantName ?? {};

    it('is a required string with the committed 1-32 [A-Za-z0-9-] pattern', () => {
      expect(tenantName.type).toBe('string');
      expect(tenantName.pattern).toBe('^[A-Za-z0-9-]{1,32}$');
      expect(requiredList).toContain('tenantName');
    });

    it('has a non-empty title and description', () => {
      expect(isNonEmptyString(tenantName.title)).toBe(true);
      expect(isNonEmptyString(tenantName.description)).toBe(true);
    });
  });

  describe('environment parameter (Req 3.1, 3.2, 3.4, 3.9)', () => {
    const environment = properties.environment ?? {};

    it('is a required string constrained to the dev/test/uat/prod enum', () => {
      expect(environment.type).toBe('string');
      expect(environment.enum).toEqual(['dev', 'test', 'uat', 'prod']);
      expect(requiredList).toContain('environment');
    });

    it('defaults to dev', () => {
      expect(environment.default).toBe('dev');
    });

    it('has a non-empty title and description', () => {
      expect(isNonEmptyString(environment.title)).toBe(true);
      expect(isNonEmptyString(environment.description)).toBe(true);
    });
  });
});
