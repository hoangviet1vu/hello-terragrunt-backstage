/**
 * Property-based test for the pure Terragrunt HCL renderer pipeline.
 *
 * This exercises the full `renderTerragruntHcl(expandComponents(selected,
 * allowed), ...)` pipeline (see design "Correctness Properties" -> Property 1,
 * and "Testing Strategy" -> Property-based tests, mapping sub-task 4.2). It
 * renders the `terragrunt.hcl` string and parses `terraform.source`,
 * `inputs.tenant_name`, `inputs.environment`, and each `inputs.enable_<name>`
 * back out, asserting the parsed values round-trip the original inputs.
 *
 * No I/O: both `renderTerragruntHcl` and `expandComponents` are pure.
 */

import fc from 'fast-check';
import { renderTerragruntHcl, Environment } from './hcl';
import { expandComponents } from './components';

const ENVIRONMENTS: Environment[] = ['dev', 'test', 'uat', 'prod'];

/**
 * Parse the `source` attribute out of the rendered `terraform { ... }` block.
 * Returns the unquoted source string, or `undefined` when absent.
 */
function parseTerraformSource(hcl: string): string | undefined {
  const match = hcl.match(
    /terraform\s*\{[^}]*?\bsource\s*=\s*"([^"]*)"[^}]*?\}/,
  );
  return match ? match[1] : undefined;
}

/**
 * Parse a quoted string attribute (e.g. `tenant_name = "acme"`) from anywhere
 * in the rendered HCL. Returns the unquoted value, or `undefined` when absent.
 */
function parseStringAttribute(hcl: string, name: string): string | undefined {
  const re = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`);
  const match = hcl.match(re);
  return match ? match[1] : undefined;
}

/**
 * Parse every `enable_<name> = <true|false>` entry out of the rendered HCL
 * into a map of component name -> boolean.
 */
function parseEnableEntries(hcl: string): Record<string, boolean> {
  const entries: Record<string, boolean> = {};
  const re = /\benable_([a-z0-9_]+)\s*=\s*(true|false)\b/g;
  for (
    let match = re.exec(hcl);
    match !== null;
    match = re.exec(hcl)
  ) {
    entries[match[1]] = match[2] === 'true';
  }
  return entries;
}

/** Arbitrary valid tenant name matching `^[a-z0-9-]{1,32}$`. */
const tenantNameArb = fc
  .array(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-'.split('')), {
    minLength: 1,
    maxLength: 32,
  })
  .map(chars => chars.join(''));

/** Arbitrary environment from the fixed enum. */
const environmentArb = fc.constantFrom<Environment>(...ENVIRONMENTS);

/**
 * Arbitrary well-formed module source: no double quote and no newline (the
 * renderer rejects those). Kept to printable non-quote/non-newline characters.
 */
const moduleSourceArb = fc
  .string({ minLength: 1, maxLength: 60 })
  .filter(s => !s.includes('"') && !/[\r\n]/.test(s));

/** Arbitrary valid allowed-component name matching `^[a-z0-9_]+$`. */
const componentNameArb = fc
  .array(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789_'.split('')), {
    minLength: 1,
    maxLength: 12,
  })
  .map(chars => chars.join(''));

/**
 * Arbitrary `{ allowed, selected }` pair where `allowed` is a de-duplicated set
 * of valid component names (size 0..100 after de-dup) and `selected` is a
 * subset of `allowed`.
 */
const allowedAndSelectedArb = fc
  .uniqueArray(componentNameArb, { minLength: 0, maxLength: 100 })
  .chain(allowed =>
    fc
      .subarray(allowed)
      .map(selected => ({ allowed, selected })),
  );

describe('renderTerragruntHcl x expandComponents: HCL round-trip', () => {
  // Feature: tenant-provision-action, Property 1: Rendered HCL round-trips the inputs
  // Validates: Requirements 3.1, 3.2, 3.3, 1.5, 9.1, 9.3, 9.4, 9.8, 9.9
  it('round-trips tenant name, environment, module source, and per-allowed enable flags (Property 1)', () => {
    fc.assert(
      fc.property(
        tenantNameArb,
        environmentArb,
        moduleSourceArb,
        allowedAndSelectedArb,
        (tenantName, environment, moduleSource, { allowed, selected }) => {
          const components = expandComponents(selected, allowed);
          const hcl = renderTerragruntHcl({
            tenantName,
            environment,
            moduleSource,
            components,
          });

          // Structural blocks are present.
          expect(hcl).toMatch(/include\s+"root"\s*\{/);
          expect(hcl).toMatch(/terraform\s*\{/);
          expect(hcl).toMatch(/inputs\s*=\s*\{/);

          // terraform.source round-trips.
          expect(parseTerraformSource(hcl)).toBe(moduleSource);

          // inputs.tenant_name / inputs.environment round-trip.
          expect(parseStringAttribute(hcl, 'tenant_name')).toBe(tenantName);
          expect(parseStringAttribute(hcl, 'environment')).toBe(environment);

          // Exactly one enable_<name> per allowed component, true iff selected.
          const parsed = parseEnableEntries(hcl);
          const selectedSet = new Set(selected);
          const allowedSet = new Set(allowed);

          // One entry per allowed name (no more, no fewer). An empty allowed
          // set means both sides are empty => no enable_<component> entries.
          expect(Object.keys(parsed).sort()).toEqual([...allowed].sort());

          for (const name of allowed) {
            expect(parsed[name]).toBe(selectedSet.has(name));
          }

          // No enable_<name> for a name outside the allowed set.
          for (const name of Object.keys(parsed)) {
            expect(allowedSet.has(name)).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
