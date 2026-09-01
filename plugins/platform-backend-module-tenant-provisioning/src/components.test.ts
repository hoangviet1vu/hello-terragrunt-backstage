/**
 * Property-based test for `expandComponents` (component expansion).
 *
 * `expandComponents(selected, allowed)` turns the user's selected component
 * names plus the config-driven Allowed_Components into the full boolean record
 * the HCL renderer consumes: one entry per allowed name, `true` iff the name is
 * in `selected`, and it throws for any selected name that is not a member of the
 * allowed set — before producing any record.
 *
 * See the tenant-provision-action design ("Correctness Properties" → Property 9,
 * and "Testing Strategy" → Property-based tests).
 */

import fc from 'fast-check';

import { expandComponents } from './components';

/** Allowed component names must match `^[a-z0-9_]+$` (Req 9.7). */
const componentName = fc
  .array(
    fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789_'.split('')),
    { minLength: 1, maxLength: 12 },
  )
  .map(chars => chars.join(''));

/**
 * An arbitrary allowed set: a de-duplicated array of valid component names,
 * size 0..100. Uniqueness mirrors the config-driven Allowed_Components (a set).
 */
const allowedSet = fc
  .uniqueArray(componentName, { minLength: 0, maxLength: 100 })
  .map(names => names.slice(0, 100));

describe('expandComponents: component expansion', () => {
  // Feature: tenant-provision-action, Property 9: Component expansion is total
  // over the allowed set and rejects unknown selections
  // Validates: Requirements 9.1, 9.5, 9.6, 9.8, 9.9
  it('returns one entry per allowed name, true iff selected (Property 9)', () => {
    // selected is a subset of allowed (possibly with duplicates and reordering).
    const allowedAndSelected = allowedSet.chain(allowed =>
      fc
        .array(
          allowed.length === 0 ? fc.constant<string>('') : fc.constantFrom(...allowed),
          { minLength: 0, maxLength: allowed.length === 0 ? 0 : allowed.length * 2 },
        )
        .map(selected => ({ allowed, selected })),
    );

    fc.assert(
      fc.property(allowedAndSelected, ({ allowed, selected }) => {
        const record = expandComponents(selected, allowed);

        // Exactly one entry per allowed name (totality over the allowed set).
        const keys = Object.keys(record);
        expect(keys.sort()).toEqual([...allowed].sort());
        expect(keys).toHaveLength(allowed.length);

        // Each value is true iff that name is in the selection, false otherwise.
        // (An empty allowed set is already covered above: keys is empty, so the
        // record is the empty record.)
        const selectedSet = new Set(selected);
        for (const name of allowed) {
          expect(record[name]).toBe(selectedSet.has(name));
        }
      }),
      { numRuns: 200 },
    );
  });

  it('throws for a selection containing a name not in the allowed set, before producing a record (Property 9)', () => {
    // Inject at least one name that is guaranteed NOT to be in `allowed`.
    const withUnknown = allowedSet.chain(allowed => {
      const allowedLookup = new Set(allowed);
      // An unknown name: a valid-form component name not present in `allowed`.
      const unknown = componentName.filter(name => !allowedLookup.has(name));
      // A subset of allowed to interleave with the unknown name.
      const known = fc.array(
        allowed.length === 0 ? fc.constant<string>('') : fc.constantFrom(...allowed),
        { minLength: 0, maxLength: allowed.length === 0 ? 0 : allowed.length },
      );
      return fc.tuple(fc.constant(allowed), known, unknown).map(([a, k, u]) => {
        const selected = [...k, u];
        return { allowed: a, selected, unknown: u };
      });
    });

    fc.assert(
      fc.property(withUnknown, ({ allowed, selected, unknown }) => {
        // Expanding with an unknown selection throws, and the error identifies
        // the unrecognized component name.
        expect(() => expandComponents(selected, allowed)).toThrow(unknown);
      }),
      { numRuns: 200 },
    );
  });
});
