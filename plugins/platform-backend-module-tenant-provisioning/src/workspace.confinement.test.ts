/**
 * Property-based test for {@link Workspace.resolveWithin} path confinement.
 *
 * `resolveWithin(relPath)` resolves a repository-relative target path against
 * the per-execution working-directory root and MUST guarantee that the result
 * either stays inside that root or is rejected before any file read or write.
 * No resolved path may escape the working directory.
 *
 * This exercises the pure path logic against a *real* workspace directory
 * created under the OS temp dir (via `createWorkspace`), which is torn down
 * afterwards. No git/network/terragrunt operations are performed.
 *
 * See the tenant-provision-action design ("Correctness Properties" -> Property 3,
 * and "Testing Strategy" -> Property-based tests, mapping sub-task 7.2).
 */

import { promises as fs } from 'fs';
import path from 'path';

import fc from 'fast-check';

import { createWorkspace, Workspace } from './workspace';

/**
 * Returns true when `child` is `root` itself or a descendant of `root`.
 * Segment-based (via `path.relative`) so a sibling whose name merely shares a
 * prefix with `root` is correctly treated as outside.
 */
function isInside(root: string, child: string): boolean {
  const relative = path.relative(root, child);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== '..' &&
      !path.isAbsolute(relative))
  );
}

/**
 * Arbitrary path segments biased toward the confinement-breaking cases:
 * `..`, separators, absolute-path prefixes, plus a few ordinary names.
 */
const pathSegmentArb = fc.oneof(
  fc.constantFrom(
    '..',
    '.',
    '/',
    '//',
    '\\',
    '../',
    '/..',
    '/etc',
    '/etc/passwd',
    'C:\\',
    'C:\\Windows',
    '~',
    '',
    'tenant',
    'dev',
    'terragrunt.hcl',
    '....//',
  ),
  fc.string({ maxLength: 12 }),
);

/**
 * Arbitrary relative-path input string, joined from 1..6 segments with mixed
 * separators, biased toward `..`, `/`, and absolute prefixes.
 */
const relPathArb = fc
  .array(pathSegmentArb, { minLength: 1, maxLength: 6 })
  .chain(segments =>
    fc.constantFrom('/', '\\', '').map(sep => segments.join(sep)),
  );

describe('Workspace.resolveWithin: path confinement', () => {
  let workspace: Workspace;

  beforeAll(async () => {
    // Create a real per-execution workspace under os.tmpdir() (baseDir
    // undefined). No secrets are needed for confinement checks.
    workspace = await createWorkspace({
      tenantName: 'acme',
      environment: 'dev',
    });
  });

  afterAll(async () => {
    // Best-effort teardown of the temp workspace.
    if (workspace) {
      try {
        await workspace.cleanup();
      } catch {
        // Fall back to a direct recursive removal if cleanup reports residue.
        await fs.rm(workspace.root, { recursive: true, force: true });
      }
    }
  });

  // Feature: tenant-provision-action, Property 3: Target path stays confined to the working directory
  // Validates: Requirements 3.4, 3.7, 7.4, 7.5
  it('resolveWithin output is inside root or throws — no resolved path escapes root (Property 3)', () => {
    const root = workspace.root;

    fc.assert(
      fc.property(relPathArb, relPath => {
        let resolved: string | undefined;
        try {
          resolved = workspace.resolveWithin(relPath);
        } catch {
          // Rejection is an acceptable outcome (path escaped root).
          return;
        }

        // If it returned a path, that path MUST be confined to root.
        expect(path.isAbsolute(resolved)).toBe(true);
        expect(isInside(root, resolved)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});
