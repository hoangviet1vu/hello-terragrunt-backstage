/**
 * Property-based test for per-execution working-directory uniqueness.
 *
 * `createWorkspace(opts)` builds a uniquely named per-execution working
 * directory under the configured scaffolder `baseDir` when supplied, otherwise
 * under the OS temp directory. Uniqueness comes from `fs.mkdtemp`, which
 * appends random characters to the prefix, so two distinct executions — even
 * with identical tenant/environment values and even when the configured
 * working directory is used — MUST receive distinct `root` paths, so one
 * execution's file operations cannot collide with another's.
 *
 * This exercises the real path builder (`createWorkspace`) against actual
 * directories: some under a configured `baseDir` (a temp dir created for the
 * test) and some under `os.tmpdir()` (baseDir undefined). Every workspace
 * created during the run is collected and removed afterwards so the test leaves
 * no residue. No git/network/terragrunt/AWS operations are performed.
 *
 * See the tenant-provision-action design ("Correctness Properties" -> Property 6,
 * and "Testing Strategy" -> Property-based tests, mapping sub-task 7.3).
 */

import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import fc from 'fast-check';

import { createWorkspace, Workspace } from './workspace';

const ENVIRONMENTS = ['dev', 'test', 'uat', 'prod'] as const;

/** Arbitrary valid tenant name matching `^[a-z0-9-]{1,32}$`. */
const tenantNameArb = fc
  .array(
    fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-'.split('')),
    { minLength: 1, maxLength: 32 },
  )
  .map(chars => chars.join(''));

/** Arbitrary environment from the fixed enum. */
const environmentArb = fc.constantFrom<(typeof ENVIRONMENTS)[number]>(
  ...ENVIRONMENTS,
);

describe('createWorkspace: working-directory uniqueness', () => {
  // A configured scaffolder working directory shared by the baseDir cases.
  let configuredBaseDir: string;

  // Every workspace created during the run, so we can tear them all down.
  const created: Workspace[] = [];

  beforeAll(async () => {
    configuredBaseDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'tenant-provision-uniqueness-base-'),
    );
  });

  afterAll(async () => {
    // Clean up every workspace created during the property run so the test
    // leaves no residue, then remove the shared configured base dir.
    for (const workspace of created) {
      try {
        await workspace.cleanup();
      } catch {
        // Fall back to a direct recursive removal if cleanup reports residue.
        await fs.rm(workspace.root, { recursive: true, force: true });
      }
    }
    if (configuredBaseDir) {
      await fs.rm(configuredBaseDir, { recursive: true, force: true });
    }
  });

  // Feature: tenant-provision-action, Property 6: Working directories are unique per execution
  // Validates: Requirements 6.4, 6.5
  it('produces a distinct root path for every execution (configured baseDir and OS temp dir) (Property 6)', async () => {
    const roots: string[] = [];

    await fc.assert(
      fc.asyncProperty(
        tenantNameArb,
        environmentArb,
        // Whether this execution uses the configured working directory
        // (Req 6.4) or falls back to the OS temp directory (Req 6.5).
        fc.boolean(),
        async (tenantName, environment, useConfiguredBaseDir) => {
          const workspace = await createWorkspace({
            baseDir: useConfiguredBaseDir ? configuredBaseDir : undefined,
            tenantName,
            environment,
          });
          created.push(workspace);
          roots.push(workspace.root);

          // Each created root must be an absolute path sitting under the
          // parent it was asked to use.
          const expectedParent = useConfiguredBaseDir
            ? configuredBaseDir
            : os.tmpdir();
          expect(path.isAbsolute(workspace.root)).toBe(true);
          expect(path.dirname(workspace.root)).toBe(expectedParent);
        },
      ),
      { numRuns: 100 },
    );

    // At least 100 executions ran; every generated path must be distinct.
    expect(roots.length).toBeGreaterThanOrEqual(100);
    expect(new Set(roots).size).toBe(roots.length);
  });
});
