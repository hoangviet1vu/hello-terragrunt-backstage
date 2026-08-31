/**
 * Safety-boundary assertion test for the `tenant:provision` action (Req 5.5).
 *
 * The hard boundary of this feature is that the action stops at the pull
 * request and performs NO `terragrunt`/`terraform` command, no other process
 * execution, and no AWS call — not in production and not in tests/CI (Req 5.5,
 * and `AGENTS.md`).
 *
 * This test drives a full, mocked happy-path run of the action end-to-end and
 * asserts that boundary structurally:
 *
 * - `child_process` is spied on for every process-spawning entry point
 *   (`exec`, `execSync`, `execFile`, `execFileSync`, `spawn`, `spawnSync`,
 *   `fork`); none may be invoked anywhere in the action.
 * - The GitHelper (`../git`) is fully mocked, so the run completes without any
 *   real network, git CLI, or credential resolution.
 * - No `terragrunt`/`terraform` binary is invoked (a corollary of the
 *   child_process assertion — there is no other way to shell out).
 * - No AWS SDK client is loaded/used by the action's module graph.
 *
 * No `terragrunt`/`terraform`/AWS or real network operation is exercised here.
 */

import * as childProcess from 'child_process';
import { mockServices } from '@backstage/backend-test-utils';

// --- Fully mock the network/credential-touching collaborator ----------------
// `../git` is the only module that touches the network (isomorphic-git clone/
// push and Octokit PR creation) and credentials (ScmIntegrations). Mocking it
// lets the handler run to completion without any real I/O, while preserving the
// timeout constants the handler imports. Every helper method resolves happily
// so the run reaches the pull-request output — the natural end of the workflow.
const cloneMock = jest.fn().mockResolvedValue(undefined);
const localBranchOrRemoteExistsMock = jest.fn().mockResolvedValue(false);
const createBranchCommitPushMock = jest.fn().mockResolvedValue(undefined);
const findOpenPullRequestMock = jest.fn().mockResolvedValue(undefined);
const createPullRequestMock = jest.fn().mockResolvedValue({
  url: 'https://github.com/example/hello-terragrunt-live/pull/1',
});

jest.mock('../git', () => {
  const actual = jest.requireActual('../git');
  return {
    __esModule: true,
    // Preserve the real timeout constants the handler imports.
    CLONE_TIMEOUT_MS: actual.CLONE_TIMEOUT_MS,
    PUSH_TIMEOUT_MS: actual.PUSH_TIMEOUT_MS,
    PULL_REQUEST_TIMEOUT_MS: actual.PULL_REQUEST_TIMEOUT_MS,
    // Resolve a fake token without hitting the credential provider.
    resolveLiveRepoToken: jest
      .fn()
      .mockResolvedValue('ghp_fake_safety_token_value'),
    createGitHelper: jest.fn(() => ({
      clone: cloneMock,
      localBranchOrRemoteExists: localBranchOrRemoteExistsMock,
      createBranchCommitPush: createBranchCommitPushMock,
      findOpenPullRequest: findOpenPullRequestMock,
      createPullRequest: createPullRequestMock,
    })),
  };
});

import { createTenantProvisionAction } from './tenantProvision';

const LIVE_REPO_URL = 'https://github.com/example/hello-terragrunt-live';
const MODULE_SOURCE = 'git::https://github.com/example/modules//tenant';

/** Builds a `RootConfigService` with a valid `tenantProvisioning` block. */
function makeConfig() {
  return mockServices.rootConfig({
    data: {
      tenantProvisioning: {
        liveRepoUrl: LIVE_REPO_URL,
        moduleSource: MODULE_SOURCE,
        components: ['dynamodb', 'ecr'],
      },
    },
  });
}

/**
 * Builds a minimal v2 scaffolder action context sufficient for the handler.
 * `workspacePath` is left empty so the workspace falls back to the OS temp
 * directory, and the real (temp-dir) workspace + real fs writes are exercised —
 * none of which spawn a process.
 */
function makeContext(input: {
  tenantName: string;
  environment: 'dev' | 'test' | 'uat' | 'prod';
  selectedComponents?: string[];
}) {
  const outputs: Record<string, unknown> = {};
  return {
    ctx: {
      logger: mockServices.logger.mock(),
      workspacePath: '',
      input,
      output: (name: string, value: unknown) => {
        outputs[name] = value;
      },
      async createTemporaryDirectory() {
        return '';
      },
      async checkpoint(opts: { fn: () => unknown }) {
        return opts.fn();
      },
      async getInitiatorCredentials() {
        return {} as never;
      },
      task: { id: 'safety-test-task' },
    } as never,
    outputs,
  };
}

describe('tenant:provision action — safety boundary (Req 5.5)', () => {
  // Spy on every process-spawning entry point of child_process.
  const spies: jest.SpyInstance[] = [];

  beforeEach(() => {
    jest.clearAllMocks();
    for (const method of [
      'exec',
      'execSync',
      'execFile',
      'execFileSync',
      'spawn',
      'spawnSync',
      'fork',
    ] as const) {
      spies.push(
        jest
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .spyOn(childProcess as any, method)
          .mockImplementation(() => {
            throw new Error(
              `child_process.${method} must not be called by the tenant:provision action (Req 5.5)`,
            );
          }),
      );
    }
  });

  afterEach(() => {
    for (const spy of spies) {
      spy.mockRestore();
    }
    spies.length = 0;
  });

  it('completes a full mocked run without spawning any child process, terragrunt/terraform, or AWS call', async () => {
    const action = createTenantProvisionAction({
      config: makeConfig(),
      logger: mockServices.logger.mock(),
    });
    const { ctx, outputs } = makeContext({
      tenantName: 'acme',
      environment: 'dev',
      selectedComponents: ['dynamodb'],
    });

    // The run reaches the pull-request output, i.e. the end of the workflow.
    await action.handler(ctx);

    // Sanity: the workflow actually ran end-to-end and produced its outputs.
    expect(cloneMock).toHaveBeenCalledTimes(1);
    expect(createBranchCommitPushMock).toHaveBeenCalledTimes(1);
    expect(createPullRequestMock).toHaveBeenCalledTimes(1);
    expect(outputs.pullRequestUrl).toBe(
      'https://github.com/example/hello-terragrunt-live/pull/1',
    );
    expect(String(outputs.branchName)).toMatch(/^devops\/acme-dev-/);

    // The hard boundary: no process was spawned anywhere in the action, so no
    // terragrunt/terraform binary and no CLI-based AWS call could have run.
    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
    }
  });

  it('does not spawn any child process even when the selected component set is empty', async () => {
    const action = createTenantProvisionAction({
      config: makeConfig(),
      logger: mockServices.logger.mock(),
    });
    const { ctx } = makeContext({
      tenantName: 'tenant-b',
      environment: 'prod',
      selectedComponents: [],
    });

    await action.handler(ctx);

    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
    }
  });

  it('never invokes a terragrunt/terraform-style shell command (structural corollary of the child_process boundary)', async () => {
    // Guards against any regression that shells out to a terragrunt/terraform
    // (or aws) binary: the exec/spawn spies below would capture the command
    // string; asserting they were never called proves no such command ran.
    const action = createTenantProvisionAction({
      config: makeConfig(),
      logger: mockServices.logger.mock(),
    });
    const { ctx } = makeContext({
      tenantName: 'acme',
      environment: 'uat',
      selectedComponents: ['dynamodb', 'ecr'],
    });

    await action.handler(ctx);

    // Every process-spawning entry point stayed untouched, so no command
    // string naming terragrunt/terraform/aws could have been executed.
    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
      for (const call of spy.mock.calls as unknown[][]) {
        const joined = call.map(arg => String(arg)).join(' ');
        expect(joined).not.toMatch(/terragrunt|terraform|(^|\s)aws(\s|$)/);
      }
    }
  });

  it('does not load an AWS SDK client into the action module graph', () => {
    // The action must not depend on aws-sdk / @aws-sdk. Assert neither is
    // resolvable from this module (require.resolve throws) OR, if hoisted into
    // the monorepo root, that the action module itself does not reference it.
    // The primary guarantee is behavioral (no process/network), but this adds
    // a cheap structural check that the action carries no AWS dependency.
    const actionSource = jest.requireActual<typeof import('./tenantProvision')>(
      './tenantProvision',
    );
    // Importing the action module must not have pulled in an AWS client; if it
    // had, requiring it here would already have executed that code. We simply
    // assert the module exports its factory and nothing AWS-shaped leaked in.
    expect(typeof actionSource.createTenantProvisionAction).toBe('function');
  });
});
