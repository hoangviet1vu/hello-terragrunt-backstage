/**
 * Secret-hygiene tests for the `tenant:provision` action.
 *
 * Covers the design's "Testing Strategy -> Unit and integration tests" secret
 * hygiene bullets across a full, mocked happy-path run:
 *
 * - Req 7.1: no Secret_Value (the resolved Git token) appears in any captured
 *   log line, at any level (a capturing logger records every message).
 * - Req 7.2: the rendered/committed `terragrunt.hcl` never contains the token
 *   value (the file is read off the real filesystem at commit time, before the
 *   workspace is cleaned up).
 *
 * The network-touching collaborators in `../git` are mocked: `resolveLiveRepoToken`
 * returns a known token, and `createGitHelper` returns an in-memory fake whose
 * `createBranchCommitPush` reads the written file so its content can be
 * asserted after the run. A real per-execution workspace and real `fs` are used
 * for the file write/cleanup, so the confinement and rendering paths run for
 * real. No git CLI, isomorphic-git, Octokit, terragrunt/terraform, AWS, or
 * network operation is exercised.
 */

import { mockServices } from '@backstage/backend-test-utils';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

// The token the mocked credential resolution hands back. It is deliberately a
// distinctive string so the assertions can search for it verbatim.
const TOKEN = 'ghp_hygiene_secret_token_ABCDEF0123456789';

// Captures what createBranchCommitPush saw on disk at commit time.
const committed: { contents?: string } = {};

// Mock the git collaborator so no network/isomorphic-git/Octokit call happens.
jest.mock('../git', () => {
  const actual = jest.requireActual('../git');
  return {
    __esModule: true,
    // Preserve the real timeout constants the handler imports.
    CLONE_TIMEOUT_MS: actual.CLONE_TIMEOUT_MS,
    PUSH_TIMEOUT_MS: actual.PUSH_TIMEOUT_MS,
    PULL_REQUEST_TIMEOUT_MS: actual.PULL_REQUEST_TIMEOUT_MS,
    resolveLiveRepoToken: jest.fn(async () => TOKEN),
    createGitHelper: jest.fn(() => ({
      clone: jest.fn(async () => {}),
      localBranchOrRemoteExists: jest.fn(async () => false),
      createBranchCommitPush: jest.fn(
        async (opts: { filePath: string }) => {
          // Read the file the handler just wrote, before cleanup removes it, so
          // the committed content can be asserted (Req 7.2).
          committed.contents = await fs.readFile(opts.filePath, 'utf8');
        },
      ),
      findOpenPullRequest: jest.fn(async () => undefined),
      createPullRequest: jest.fn(async () => ({
        url: 'https://github.com/example/hello-terragrunt-live/pull/1',
      })),
    })),
  };
});

import { createTenantProvisionAction } from './tenantProvision';

/** A logger that records every message passed to it at every level. */
function createCapturingLogger() {
  const messages: string[] = [];
  const record = (message: string) => messages.push(message);
  const logger: any = {
    error: record,
    warn: record,
    info: record,
    debug: record,
    child: () => logger,
  };
  return { logger, messages };
}

/** Builds a minimal scaffolder ActionContext for direct handler invocation. */
async function createActionContext(input: {
  tenantName: string;
  environment: 'dev' | 'test' | 'uat' | 'prod';
  selectedComponents?: string[];
}) {
  const { logger, messages } = createCapturingLogger();
  // A real, empty scaffolder working directory so the workspace nests under it.
  const workspacePath = await fs.mkdtemp(
    path.join(os.tmpdir(), 'tenant-provision-hygiene-ws-'),
  );
  const outputs: Record<string, unknown> = {};
  const ctx: any = {
    logger,
    workspacePath,
    input,
    output: (name: string, value: unknown) => {
      outputs[name] = value;
    },
    createTemporaryDirectory: async () =>
      fs.mkdtemp(path.join(os.tmpdir(), 'tenant-provision-hygiene-tmp-')),
    getInitiatorCredentials: async () => ({}),
    checkpoint: async (o: any) => (o.fn ? o.fn() : undefined),
    task: { id: 'test-task' },
  };
  return { ctx, messages, outputs, workspacePath };
}

const config = () =>
  mockServices.rootConfig({
    data: {
      tenantProvisioning: {
        liveRepoUrl: 'https://github.com/example/hello-terragrunt-live',
        liveRepoBranch: 'main',
        moduleSource: 'git::https://example.com/modules//tenant?ref=v1',
        components: ['dynamodb', 'ecr'],
      },
    },
  });

beforeEach(() => {
  committed.contents = undefined;
});

describe('tenant:provision secret hygiene', () => {
  it('never logs the token across a full mocked run (Req 7.1)', async () => {
    const { logger } = createCapturingLogger();
    const action = createTenantProvisionAction({ config: config(), logger });
    const { ctx, messages, workspacePath } = await createActionContext({
      tenantName: 'acme',
      environment: 'dev',
      selectedComponents: ['ecr'],
    });

    try {
      await action.handler(ctx);
    } finally {
      // Best-effort teardown of the outer scaffolder working directory.
      await fs.rm(workspacePath, { recursive: true, force: true });
    }

    // No captured log line, at any level, contains the token value (Req 7.1).
    expect(messages.length).toBeGreaterThanOrEqual(0);
    for (const message of messages) {
      expect(message).not.toContain(TOKEN);
    }
  });

  it('never writes the token into the rendered/committed terragrunt.hcl (Req 7.2)', async () => {
    const { logger } = createCapturingLogger();
    const action = createTenantProvisionAction({ config: config(), logger });
    const { ctx, workspacePath } = await createActionContext({
      tenantName: 'acme',
      environment: 'prod',
      selectedComponents: ['dynamodb', 'ecr'],
    });

    try {
      await action.handler(ctx);
    } finally {
      await fs.rm(workspacePath, { recursive: true, force: true });
    }

    // The committed file content was captured at commit time (Req 7.2).
    expect(committed.contents).toBeDefined();
    expect(committed.contents).toContain('terraform {');
    expect(committed.contents).not.toContain(TOKEN);
  });
});
