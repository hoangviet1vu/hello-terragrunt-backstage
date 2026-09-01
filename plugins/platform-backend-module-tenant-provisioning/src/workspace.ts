import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import { redact } from './redact';

/** A per-execution working directory with path-confinement and cleanup. */
export interface Workspace {
  /** Absolute path to the per-execution directory. */
  root: string;
  /** Resolves `relPath` against `root`, throwing if it escapes `root`. */
  resolveWithin(relPath: string): string;
  /** Removes the directory recursively; throws if anything remains. */
  cleanup(): Promise<void>;
}

/** Options for creating a per-execution {@link Workspace}. */
export interface CreateWorkspaceOptions {
  /** Scaffolder working directory when configured; otherwise undefined. */
  baseDir?: string;
  tenantName: string;
  environment: string;
  /**
   * Secret values (e.g. the Git token) to strip from any error message this
   * workspace produces, so cleanup failures cannot leak credentials (Req 7.3).
   */
  secrets?: string[];
}

/**
 * Returns true when `child` is `parent` itself or a descendant of `parent`.
 *
 * Both paths are expected to be absolute and already normalized. The check is
 * done on path segments (via `path.relative`) rather than string prefixes, so a
 * sibling directory whose name merely starts with `parent` (e.g. `/a/rootX`
 * versus `/a/root`) is correctly treated as outside `parent`.
 */
function isWithin(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== '..' &&
      !path.isAbsolute(relative))
  );
}

/**
 * Creates a uniquely named per-execution working directory under `baseDir`
 * when provided, otherwise under the OS temp directory.
 *
 * The directory is created with `fs.mkdtemp`, which appends random characters
 * to the prefix, guaranteeing a distinct path per invocation even for two
 * concurrent executions with identical tenant/environment values (Req 6.4,
 * 6.5). The prefix embeds the tenant and environment purely for operator
 * legibility; uniqueness comes from `mkdtemp`, not from those values.
 *
 * @param opts - Base directory, tenant, environment, and optional secrets.
 * @returns A {@link Workspace} rooted at the freshly created directory.
 */
export async function createWorkspace(
  opts: CreateWorkspaceOptions,
): Promise<Workspace> {
  const { baseDir, tenantName, environment, secrets = [] } = opts;

  const parentDir = baseDir ?? os.tmpdir();
  // Sanitize the human-readable prefix segment; only the random suffix from
  // mkdtemp is relied on for uniqueness. Keep the prefix constrained so it can
  // never introduce path separators.
  const label = `tenant-provision-${tenantName}-${environment}-`.replace(
    /[^a-zA-Z0-9._-]/g,
    '_',
  );

  // Ensure the parent exists (the configured scaffolder working directory may
  // not have been created yet); os.tmpdir() always exists.
  await fs.mkdir(parentDir, { recursive: true });

  const root = await fs.mkdtemp(path.join(parentDir, label));

  const resolveWithin = (relPath: string): string => {
    const resolved = path.resolve(root, relPath);
    if (!isWithin(root, resolved)) {
      throw new Error(
        `Resolved path is outside the working directory: ${redact(
          resolved,
          secrets,
        )}`,
      );
    }
    return resolved;
  };

  const cleanup = async (): Promise<void> => {
    await fs.rm(root, { recursive: true, force: true });

    // Verify the directory is fully gone; if anything remains, surface a
    // redacted error naming the residual path (Req 6.3).
    let stillExists = true;
    try {
      await fs.stat(root);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        stillExists = false;
      } else {
        throw new Error(
          `Failed to verify cleanup of the working directory: ${redact(
            String((err as Error).message ?? err),
            secrets,
          )}`,
        );
      }
    }

    if (stillExists) {
      throw new Error(
        `Cleanup did not complete; the working directory could not be removed: ${redact(
          root,
          secrets,
        )}`,
      );
    }
  };

  return { root, resolveWithin, cleanup };
}
