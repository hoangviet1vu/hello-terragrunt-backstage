/**
 * Property-based test for the data-driven behavior of the pure Terragrunt HCL
 * renderer (`renderTerragruntHcl`).
 *
 * This exercises design "Correctness Properties" -> Property 8 (mapping
 * sub-task 4.3): the renderer is data-driven over the `components` map (one
 * `enable_<key>` line per entry, using the same logic for every key with no
 * per-name branching), emits those lines ordered by key in ascending
 * lexicographic byte order with each boolean value matching the map, and
 * validates its input before producing any output (rejecting invalid keys and
 * oversized maps).
 *
 * No I/O: `renderTerragruntHcl` is pure.
 */

import fc from 'fast-check';
import { renderTerragruntHcl, Environment } from './hcl';

const ENVIRONMENTS: Environment[] = ['dev', 'test', 'uat', 'prod'];

/**
 * Parse every `enable_<name> = <true|false>` entry out of the rendered HCL into
 * an ordered list of `{ name, value }` (in the order they appear in the text),
 * so ordering can be asserted, not just membership.
 */
function parseEnableEntriesOrdered(
  hcl: string,
): Array<{ name: string; value: boolean }> {
  const entries: Array<{ name: string; value: boolean }> = [];
  const re = /\benable_([a-z0-9_]+)\s*=\s*(true|false)\b/g;
  for (
    let match = re.exec(hcl);
    match !== null;
    match = re.exec(hcl)
  ) {
    entries.push({ name: match[1], value: match[2] === 'true' });
  }
  return entries;
}

/** Ascending lexicographic byte-order comparator (matches the renderer's sort). */
function byteOrder(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
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
 * renderer rejects those).
 */
const moduleSourceArb = fc
  .string({ minLength: 1, maxLength: 60 })
  .filter(s => !s.includes('"') && !/[\r\n]/.test(s));

/** Arbitrary valid component key matching `^[a-z0-9_]+$`. */
const validKeyArb = fc
  .array(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789_'.split('')), {
    minLength: 1,
    maxLength: 12,
  })
  .map(chars => chars.join(''));

/**
 * Arbitrary valid `components` map: 0..100 entries with unique keys matching
 * `^[a-z0-9_]+$` and arbitrary boolean values.
 */
const validComponentsArb = fc
  .uniqueArray(fc.tuple(validKeyArb, fc.boolean()), {
    minLength: 0,
    maxLength: 100,
    selector: pair => pair[0],
  })
  .map(pairs => Object.fromEntries(pairs) as Record<string, boolean>);

/**
 * Arbitrary key that violates `^[a-z0-9_]+$` (contains uppercase, a hyphen, a
 * dot, whitespace, or another disallowed character), so the renderer must
 * reject the whole map.
 */
const invalidKeyArb = fc
  .string({ minLength: 1, maxLength: 12 })
  .filter(s => s.length > 0 && !/^[a-z0-9_]+$/.test(s));

/**
 * Arbitrary `components` map guaranteed to contain at least one invalid key
 * (mixed with any number of otherwise-valid keys).
 */
const componentsWithInvalidKeyArb = fc
  .record({
    valid: fc.uniqueArray(fc.tuple(validKeyArb, fc.boolean()), {
      minLength: 0,
      maxLength: 20,
      selector: pair => pair[0],
    }),
    invalid: fc.array(fc.tuple(invalidKeyArb, fc.boolean()), {
      minLength: 1,
      maxLength: 5,
    }),
  })
  .map(({ valid, invalid }) => {
    const map: Record<string, boolean> = {};
    for (const [k, v] of valid) map[k] = v;
    for (const [k, v] of invalid) map[k] = v;
    return map;
  })
  // Guard against the (astronomically unlikely) case where every invalid key
  // was overwritten by an identical valid key; keep only maps that still
  // contain a key violating the pattern.
  .filter(map => Object.keys(map).some(k => !/^[a-z0-9_]+$/.test(k)));

/**
 * Arbitrary oversized `components` map: 101..130 unique valid keys, which
 * exceeds the renderer's 100-entry maximum.
 */
const oversizedComponentsArb = fc
  .uniqueArray(validKeyArb, { minLength: 101, maxLength: 130 })
  .map(keys => {
    const map: Record<string, boolean> = {};
    for (const k of keys) map[k] = true;
    return map;
  })
  // De-dup can drop below 101; keep only genuinely oversized maps.
  .filter(map => Object.keys(map).length > 100);

describe('renderTerragruntHcl: data-driven component rendering', () => {
  // Feature: tenant-provision-action, Property 8: Component rendering is data-driven, ordered, and validated
  // Validates: Requirements 9.2, 9.3, 9.4, 9.7, 9.8
  it('emits exactly one enable_<key> per entry, in ascending byte order, with matching values (Property 8)', () => {
    fc.assert(
      fc.property(
        tenantNameArb,
        environmentArb,
        moduleSourceArb,
        validComponentsArb,
        (tenantName, environment, moduleSource, components) => {
          const hcl = renderTerragruntHcl({
            tenantName,
            environment,
            moduleSource,
            components,
          });

          const parsed = parseEnableEntriesOrdered(hcl);
          const keys = Object.keys(components);

          // Exactly one enable_<key> line per entry (no more, no fewer).
          // When the map is empty this also asserts no enable_<component>
          // entries at all (Req 9.9-adjacent).
          expect(parsed).toHaveLength(keys.length);

          // One entry per key, values match the map (Req 9.2, 9.3, 9.4).
          const parsedNames = parsed.map(e => e.name);
          expect([...parsedNames].sort(byteOrder)).toEqual(
            [...keys].sort(byteOrder),
          );
          for (const { name, value } of parsed) {
            expect(value).toBe(components[name] === true);
          }

          // Lines appear in ascending lexicographic byte order of key (Req 9.4).
          const expectedOrder = [...keys].sort(byteOrder);
          expect(parsedNames).toEqual(expectedOrder);
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: tenant-provision-action, Property 8: Component rendering is data-driven, ordered, and validated
  // Validates: Requirements 9.2, 9.3, 9.4, 9.7, 9.8
  it('throws before producing output when a component key violates ^[a-z0-9_]+$ (Property 8)', () => {
    fc.assert(
      fc.property(
        tenantNameArb,
        environmentArb,
        moduleSourceArb,
        componentsWithInvalidKeyArb,
        (tenantName, environment, moduleSource, components) => {
          expect(() =>
            renderTerragruntHcl({
              tenantName,
              environment,
              moduleSource,
              components,
            }),
          ).toThrow();
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: tenant-provision-action, Property 8: Component rendering is data-driven, ordered, and validated
  // Validates: Requirements 9.2, 9.3, 9.4, 9.7, 9.8
  it('throws before producing output when the components map exceeds 100 entries (Property 8)', () => {
    fc.assert(
      fc.property(
        tenantNameArb,
        environmentArb,
        moduleSourceArb,
        oversizedComponentsArb,
        (tenantName, environment, moduleSource, components) => {
          expect(() =>
            renderTerragruntHcl({
              tenantName,
              environment,
              moduleSource,
              components,
            }),
          ).toThrow();
        },
      ),
      { numRuns: 100 },
    );
  });
});
