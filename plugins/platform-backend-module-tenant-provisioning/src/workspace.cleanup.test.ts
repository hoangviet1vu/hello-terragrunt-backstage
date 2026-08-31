/**
 * Unit tests for {@link Workspace.cleanup}.
 *
 * `cleanup()` removes the per-execution working directory recursively and, if
 * anything remains after removal, throws an error that names the residual path
 * with all secrets redacted. These example-based tests cover the design's
 * "Testing Strategy -> Unit and integration tests" cleanup bullet:
 *
 * - the directory is removed on the success path (Req 6.1);
 * - the directory is removed regardless of how the action reached cleanup,
 *   i.e. on the failure path too (Req 6.2);
 * - a cleanup that leaves residue yields a redacted error naming the residual
 *   path, without exposing tenant secrets (Req 6.3).
 *
 * No git/network/terragrunt/AWS operation is exercised here. The residue case
 * is simulated by mocking `fs.rm` to a no-op so the directory survives removal.
 */

import { promises as fs } from 'fs';
import path from 'path';

import { createWorkspace } from './workspace';
import { REDACTION_PLACEHOLDER } from './redact';

/** Returns true when the path exists on disk. */
async function exists(target: string): Promise<boolean> {
  try {
    await fs.stat(target);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw err;
  }
}

describe('Workspace.cleanup', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('removes the working directory and its contents on success (Req 6.1)', async () => {
    const workspace = await createWorkspace({
      tenantName: 'acme',
      environment: 'dev',
    });

    // Populate the workspace with a nested file so removal must be recursive.
    const nestedDir = workspace.resolveWithin(path.join('acme', 'dev'));
    await fs.mkdir(nestedDir, { recursive: true });
    await fs.writeFile(
      path.join(nestedDir, 'terragrunt.hcl'),
      'inputs = {}\n',
      'utf8',
    );

    expect(await exists(workspace.root)).toBe(true);

    await expect(workspace.cleanup()).resolves.toBeUndefined();

    expect(await exists(workspace.root)).toBe(false);
  });

  it('removes the working directory even with no files written (failure path) (Req 6.2)', async () => {
    // On the failure path the action may reach cleanup right after the
    // workspace was created (e.g. a clone failure), so an essentially empty
    // directory must still be removed.
    const workspace = await createWorkspace({
      tenantName: 'acme',
      environment: 'prod',
    });

    expect(await exists(workspace.root)).toBe(true);

    await expect(workspace.cleanup()).resolves.toBeUndefined();

    expect(await exists(workspace.root)).toBe(false);
  });

  it('removes the working directory on failure regardless of residual files (Req 6.2)', async () => {
    const workspace = await createWorkspace({
      tenantName: 'beta',
      environment: 'test',
    });

    // Simulate a partial checkout left behind by an aborted clone.
    const nestedDir = workspace.resolveWithin(path.join('beta', 'test'));
    await fs.mkdir(nestedDir, { recursive: true });
    await fs.writeFile(path.join(nestedDir, 'leftover.txt'), 'partial', 'utf8');
    await fs.writeFile(path.join(workspace.root, 'top.txt'), 'partial', 'utf8');

    await expect(workspace.cleanup()).resolves.toBeUndefined();

    expect(await exists(workspace.root)).toBe(false);
  });

  it('throws a redacted error naming the residual path when removal leaves residue (Req 6.3)', async () => {
    // Embed the secret in the tenant name so it appears verbatim in the
    // workspace root path; cleanup names that path when it cannot remove it,
    // which is exactly where redaction must kick in. The secret is composed of
    // `[a-z0-9_]` characters only, so the workspace label sanitizer preserves
    // it verbatim in `root` rather than replacing any of its characters.
    const secret = 'ghp_secret_0123';
    const workspace = await createWorkspace({
      tenantName: `acme${secret}`,
      environment: 'dev',
      secrets: [secret],
    });

    // Simulate residue: make fs.rm a no-op so the directory survives removal
    // and the subsequent fs.stat still finds it, forcing the residue branch.
    const rmSpy = jest
      .spyOn(fs, 'rm')
      .mockResolvedValue(undefined as unknown as void);

    try {
      await expect(workspace.cleanup()).rejects.toThrow(
        /cleanup did not complete/i,
      );

      // Re-run to inspect the message contents directly.
      let caught: Error | undefined;
      try {
        await workspace.cleanup();
      } catch (err) {
        caught = err as Error;
      }

      expect(caught).toBeDefined();
      const message = caught!.message;

      // The residual path is named, but the secret embedded in it is redacted.
      expect(message).toContain(REDACTION_PLACEHOLDER);
      expect(message).not.toContain(secret);
      // fs.rm was actually invoked (the removal was attempted).
      expect(rmSpy).toHaveBeenCalled();
    } finally {
      // Restore fs.rm so the real directory can be cleaned up.
      rmSpy.mockRestore();
      await fs.rm(workspace.root, { recursive: true, force: true });
    }
  });
});
