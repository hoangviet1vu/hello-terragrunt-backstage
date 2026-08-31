/**
 * Mocked integration tests for the `tenant:provision` action handler
 * (`createTenantProvisionAction`).
 *
 * These example-based tests exercise the action's orchestration end-to-end with
 * the network-touching collaborator (`../git`) mocked, but with a REAL
 * `../workspace` and REAL filesystem, so the create/overwrite/confinement and
 * cleanup behavior is genuinely exercised. They cover the design's
 * "Testing Strategy -> Unit and integration tests" handler bullets:
 *
 * - Push then PR happy path exposes `pullRequestUrl` + `branchName` outputs
 *   (Req 5.1-5.4).
 * - File write creates missing folders and the file (Req 3.5) and overwrites an
 *   existing file (Req 3.6).
 * - A write failure leaves any pre-existing file content unchanged (Req 3.8).
 * - A target path escaping the workspace is rejected before any file I/O
 *   (Req 3.7).
 * - The working directory is cleaned up on both success and failure (Req 6.1,
 *   6.2).
 *
 * NO real git/network/terragrunt/AWS operation is exercised: `createGitHelper`
 * returns a fake GitHelper of `jest.fn`s and `resolveLiveRepoToken` returns a
 * fake token. `../workspace` is real except in the single confinement test,
 * where `createWorkspace` is spied to force `resolveWithin` to throw.
 */

import { promises as fs } from 'fs';
import * as fsSync from 'fs';
import os from 'os';
import path from 'path';
import { mockServices } from '@backstage/backend-test-utils';
import type { JsonObject } from '@backstage/types';

// --- Mock the only network-touching collaborator (../git) -------------------
// createGitHelper returns a fake GitHelper of jest.fns; resolveLiveRepoToken
// returns a fake token. The timeout constants are preserved so the handler's
// imports resolve. No isomorphic-git/Octokit/network is touched.
const gitHelperMock = {
  clone: jest.fn(),
  localBranchOrRemoteExists: jest.fn(),
  createBranchCommitPush: jest.fn(),
  findOpenPullRequest: jest.fn(),
  createPullRequest: jest.fn(),
};
const createGitHelperMock = jest.fn(() => gitHelperMock);
const resolveLiveRepoTokenMock = jest.fn();

jest.mock('../git', () => ({
  __esModule: true,
  CLONE_TIMEOUT_MS: 120_000,
  PUSH_TIMEOUT_MS: 60_000,
  PULL_REQUEST_TIMEOUT_MS: 60_000,
  createGitHelper: (...args: unknown[]) => createGitHelperMock(...(args as [])),
  resolveLiveRepoToken: (...args: unknown[]) =>
    resolveLiveRepoTokenMock(...(args as [])),
}));

// --- Wrap ../workspace so it is REAL by default, but overridable ------------
// The default implementation delegates to the real createWorkspace (so
// create/overwrite/cleanup are genuinely exercised on the real filesystem). A
// single test overrides `createWorkspaceOverride` to force `resolveWithin` to
// reject, which cannot be done with jest.spyOn on the ES module export.
let createWorkspaceOverride:
  | ((opts: workspaceModuleType.CreateWorkspaceOptions) => Promise<
      workspaceModuleType.Workspace
    >)
  | undefined;

jest.mock('../workspace', () => {
  const actual = jest.requireActual('../workspace');
  return {
    __esModule: true,
    ...actual,
    createWorkspace: (opts: unknown) =>
      createWorkspaceOverride
        ? createWorkspaceOverride(
            opts as workspaceModuleType.CreateWorkspaceOptions,
          )
        : actual.createWorkspace(opts),
  };
});

// Import after the mocks are registered.
import { createTenantProvisionAction } from './tenantProvision';
import type * as workspaceModuleType from '../workspace';

const TOKEN = 'ghp_fake_integration_token_0123456789';
const LIVE_REPO_URL = 'https://github.com/example/hello-terragrunt-live';
const MODULE_SOURCE = 'git::https://github.com/example/modules.git//tenant';
const PR_URL = 'https://github.com/example/hello-terragrunt-live/pull/123';

/** Config data for a valid `tenantProvisioning` block. */
function configData(): JsonObject {
  return {
    tenantProvisioning: {
      liveRepoUrl: LIVE_REPO_URL,
      liveRepoBranch: 'main',
      moduleSource: MODULE_SOURCE,
      components: ['dynamodb', 'ecr'],
    },
  };
}

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

/**
 * A minimal scaffolder-style action context. Only the fields the handler uses
 * are populated: `input`, `workspacePath`, and `output` (which records into the
 * provided map). Everything else is cast away.
 */
function buildContext(opts: {
  input: JsonObject;
  workspacePath: string;
  outputs: Map<string, unknown>;
}) {
  const { input, workspacePath, outputs } = opts;
  return {
    input,
    workspacePath,
    logger: mockServices.logger.mock(),
    output: (name: string, value: unknown) => {
      outputs.set(name, value);
    },
    async checkpoint<T>(o: { work: () => Promise<T> }): Promise<T> {
      return o.work();
    },
    async createTemporaryDirectory() {
      return fs.mkdtemp(path.join(os.tmpdir(), 'ctx-tmp-'));
    },
    async getInitiatorCredentials() {
      return {} as never;
    },
    task: { id: 'test-task' },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe('createTenantProvisionAction handler (mocked git, real workspace)', () => {
  let scaffolderWorkdir: string;
  const createdCtxWorkdirs: string[] = [];

  beforeEach(async () => {
    jest.clearAllMocks();
    // Reset the workspace override so the real workspace is used by default.
    createWorkspaceOverride = undefined;
    // Sensible happy-path defaults; individual tests override.
    resolveLiveRepoTokenMock.mockResolvedValue(TOKEN);
    gitHelperMock.clone.mockResolvedValue(undefined);
    gitHelperMock.localBranchOrRemoteExists.mockResolvedValue(false);
    gitHelperMock.createBranchCommitPush.mockResolvedValue(undefined);
    gitHelperMock.findOpenPullRequest.mockResolvedValue(undefined);
    gitHelperMock.createPullRequest.mockResolvedValue({ url: PR_URL });

    // A fresh scaffolder working directory per test; the real workspace creates
    // its unique subdirectory under here.
    scaffolderWorkdir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'tenant-provision-it-'),
    );
    createdCtxWorkdirs.push(scaffolderWorkdir);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    // Clean up any temp dirs this test created.
    for (const dir of createdCtxWorkdirs.splice(0)) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  /** Runs the action handler once with the given input and config. */
  async function runHandler(opts: {
    input: JsonObject;
    outputs: Map<string, unknown>;
    workspacePath?: string;
    configOverride?: JsonObject;
  }) {
    const config = mockServices.rootConfig({
      data: opts.configOverride ?? configData(),
    });
    const action = createTenantProvisionAction({
      config,
      logger: mockServices.logger.mock(),
    });
    const ctx = buildContext({
      input: opts.input,
      workspacePath: opts.workspacePath ?? scaffolderWorkdir,
      outputs: opts.outputs,
    });
    await action.handler(ctx);
    return ctx;
  }

  it('happy path exposes pullRequestUrl and branchName outputs (Req 5.1-5.4)', async () => {
    const outputs = new Map<string, unknown>();

    await runHandler({
      input: {
        tenantName: 'acme',
        environment: 'dev',
        selectedComponents: ['dynamodb'],
      },
      outputs,
    });

    // The full clone -> write -> branch -> push -> PR sequence ran.
    expect(gitHelperMock.clone).toHaveBeenCalledTimes(1);
    expect(gitHelperMock.createBranchCommitPush).toHaveBeenCalledTimes(1);
    expect(gitHelperMock.createPullRequest).toHaveBeenCalledTimes(1);

    // Outputs expose the PR URL and the pushed feature branch (Req 5.4).
    expect(outputs.get('pullRequestUrl')).toBe(PR_URL);
    const branchName = outputs.get('branchName') as string;
    expect(branchName).toMatch(
      /^devops\/acme-dev-\d{8}-\d{6}$/,
    );
    // The same branch name is what was pushed and used for the PR.
    expect(gitHelperMock.createBranchCommitPush).toHaveBeenCalledWith(
      expect.objectContaining({ branch: branchName, baseBranch: 'main' }),
    );
    expect(gitHelperMock.createPullRequest).toHaveBeenCalledWith(
      expect.objectContaining({ head: branchName, base: 'main' }),
    );
  });

  it('creates missing folders and the terragrunt.hcl file (Req 3.5)', async () => {
    const outputs = new Map<string, unknown>();
    let writtenPath: string | undefined;
    let writtenContent: string | undefined;

    // The clone leaves an empty checkout; capture the file the handler writes
    // by reading it back inside createBranchCommitPush before cleanup runs.
    gitHelperMock.createBranchCommitPush.mockImplementation(
      async (o: { filePath: string }) => {
        writtenPath = o.filePath;
        writtenContent = await fs.readFile(o.filePath, 'utf8');
      },
    );

    await runHandler({
      input: {
        tenantName: 'beta',
        environment: 'prod',
        selectedComponents: ['ecr'],
      },
      outputs,
    });

    expect(writtenPath).toBeDefined();
    // The file was created at <workdir>/beta/prod/terragrunt.hcl.
    expect(writtenPath!.split(path.sep).slice(-3)).toEqual([
      'beta',
      'prod',
      'terragrunt.hcl',
    ]);
    // Content is the rendered HCL reflecting the selection.
    expect(writtenContent).toContain('tenant_name');
    expect(writtenContent).toContain('"beta"');
    expect(writtenContent).toContain('"prod"');
    expect(writtenContent).toContain('enable_ecr      = true');
    expect(writtenContent).toContain('enable_dynamodb = false');
  });

  it('overwrites an existing terragrunt.hcl with the rendered content (Req 3.6)', async () => {
    const outputs = new Map<string, unknown>();
    const preexisting = 'inputs = { stale = true }\n';
    let writtenContent: string | undefined;

    // Simulate the cloned repo already having the tenant's file with old
    // content, so the handler's write must overwrite it.
    gitHelperMock.clone.mockImplementation(async (o: { dir: string }) => {
      const target = path.join(o.dir, 'acme', 'dev', 'terragrunt.hcl');
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, preexisting, 'utf8');
    });
    gitHelperMock.createBranchCommitPush.mockImplementation(
      async (o: { filePath: string }) => {
        writtenContent = await fs.readFile(o.filePath, 'utf8');
      },
    );

    await runHandler({
      input: {
        tenantName: 'acme',
        environment: 'dev',
        selectedComponents: [],
      },
      outputs,
    });

    expect(writtenContent).toBeDefined();
    // The stale content is gone; the rendered HCL is present.
    expect(writtenContent).not.toContain('stale');
    expect(writtenContent).toContain('include "root"');
    expect(writtenContent).toContain('"acme"');
    // Empty selection renders every allowed component as false.
    expect(writtenContent).toContain('enable_dynamodb = false');
    expect(writtenContent).toContain('enable_ecr      = false');
  });

  it('leaves a pre-existing terragrunt.hcl unchanged when the write fails (Req 3.8)', async () => {
    const outputs = new Map<string, unknown>();
    const preexisting = 'inputs = { preserved = true }\n';
    let targetPath: string | undefined;

    // Clone leaves an existing file whose content must survive a failed write.
    gitHelperMock.clone.mockImplementation(async (o: { dir: string }) => {
      targetPath = path.join(o.dir, 'acme', 'dev', 'terragrunt.hcl');
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.writeFile(targetPath, preexisting, 'utf8');
    });

    // Force ONLY the handler's write to the tenant terragrunt.hcl to fail,
    // while leaving the clone's earlier pre-write of the existing file intact.
    // The clone writes the pre-existing content first; by rejecting only a
    // write to a target that already exists on disk, the pre-write succeeds and
    // the handler's overwrite fails, so the old content is left unchanged
    // (Req 3.8).
    // Capture the on-disk content at the moment the handler's write is rejected
    // (before the finally-block cleanup removes the whole working directory).
    // If the pre-existing content is still present at that point, the failed
    // write did not corrupt or truncate it (Req 3.8).
    const realWriteFile = fs.writeFile.bind(fs);
    let contentAtWriteFailure: string | undefined;
    const writeSpy = jest
      .spyOn(fs, 'writeFile')
      .mockImplementation(((file: unknown, ...rest: unknown[]) => {
        const isTarget =
          typeof file === 'string' &&
          targetPath &&
          path.resolve(file) === path.resolve(targetPath);
        if (isTarget && fsSync.existsSync(file as string)) {
          // Snapshot the existing content right before failing the write.
          contentAtWriteFailure = fsSync.readFileSync(file as string, 'utf8');
          return Promise.reject(new Error('EACCES: permission denied'));
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (realWriteFile as any)(file, ...rest);
      }) as typeof fs.writeFile);

    await expect(
      runHandler({
        input: {
          tenantName: 'acme',
          environment: 'dev',
          selectedComponents: ['dynamodb'],
        },
        outputs,
      }),
    ).rejects.toThrow(/could not be written|write/i);

    writeSpy.mockRestore();
    // The pre-existing content was intact when the write failed.
    expect(contentAtWriteFailure).toBe(preexisting);

    // No branch/commit/push or PR was attempted after the write failure.
    expect(gitHelperMock.createBranchCommitPush).not.toHaveBeenCalled();
    expect(gitHelperMock.createPullRequest).not.toHaveBeenCalled();
  });

  it('rejects a target path escaping the workspace before any file I/O (Req 3.7)', async () => {
    const outputs = new Map<string, unknown>();

    // Track that no file write happens once resolveWithin rejects.
    const mkdirSpy = jest.spyOn(fs, 'mkdir');
    const writeSpy = jest.spyOn(fs, 'writeFile');

    // Force resolveWithin to reject as if the computed path escaped root, using
    // a real cleanup so the working-directory removal path still runs.
    const realRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'confine-root-'),
    );
    createdCtxWorkdirs.push(realRoot);
    let cleanupCalled = false;
    createWorkspaceOverride = async () => ({
      root: realRoot,
      resolveWithin: () => {
        throw new Error(
          'Resolved path is outside the working directory: /etc/passwd',
        );
      },
      cleanup: async () => {
        cleanupCalled = true;
      },
    });

    await expect(
      runHandler({
        input: {
          tenantName: 'acme',
          environment: 'dev',
          selectedComponents: [],
        },
        outputs,
      }),
    ).rejects.toThrow(/outside the working directory/i);

    // The confinement guard fired before any file create/write occurred.
    expect(mkdirSpy).not.toHaveBeenCalled();
    expect(writeSpy).not.toHaveBeenCalled();
    // No branch/commit/push or PR was attempted.
    expect(gitHelperMock.createBranchCommitPush).not.toHaveBeenCalled();
    expect(gitHelperMock.createPullRequest).not.toHaveBeenCalled();
    // Cleanup still ran on this failure path (Req 6.2).
    expect(cleanupCalled).toBe(true);
  });

  it('cleans up the working directory on the success path (Req 6.1)', async () => {
    const outputs = new Map<string, unknown>();
    let capturedRoot: string | undefined;

    // Capture the per-execution working directory the handler created.
    gitHelperMock.clone.mockImplementation(async (o: { dir: string }) => {
      capturedRoot = o.dir;
    });

    await runHandler({
      input: {
        tenantName: 'acme',
        environment: 'dev',
        selectedComponents: ['dynamodb'],
      },
      outputs,
    });

    expect(capturedRoot).toBeDefined();
    // The working directory was under the scaffolder working directory...
    expect(capturedRoot!.startsWith(scaffolderWorkdir)).toBe(true);
    // ...and has been removed after a successful run.
    expect(await exists(capturedRoot!)).toBe(false);
  });

  it('cleans up the working directory on the failure path (Req 6.2)', async () => {
    const outputs = new Map<string, unknown>();
    let capturedRoot: string | undefined;

    // Capture the working directory, then fail during clone so the handler
    // reaches cleanup via the finally block right after workspace creation.
    gitHelperMock.clone.mockImplementation(async (o: { dir: string }) => {
      capturedRoot = o.dir;
      throw new Error('Could not reach the tenant live repository');
    });

    await expect(
      runHandler({
        input: {
          tenantName: 'acme',
          environment: 'dev',
          selectedComponents: [],
        },
        outputs,
      }),
    ).rejects.toThrow(/could not reach/i);

    expect(capturedRoot).toBeDefined();
    // The working directory was removed despite the failure.
    expect(await exists(capturedRoot!)).toBe(false);
    // No outputs were set on the failure path.
    expect(outputs.size).toBe(0);
  });
});
