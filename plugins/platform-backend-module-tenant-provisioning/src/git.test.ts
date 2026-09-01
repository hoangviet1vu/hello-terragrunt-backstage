/**
 * Mocked unit tests for the {@link GitHelper} (`createGitHelper`).
 *
 * These example-based tests cover the design's "Testing Strategy -> Unit and
 * integration tests" git bullets for the GitHelper collaborator:
 *
 * - Clone error mapping: network-unreachable, missing-ref, auth-rejected (with
 *   the token redacted / absent from the message), and timeout (Req 2.3-2.6).
 * - Duplicate branch detection via `localBranchOrRemoteExists` — true when the
 *   branch exists locally or on the remote (Req 4.4).
 * - `createBranchCommitPush` commits exactly `terragrunt.hcl` with a message
 *   that includes tenant + environment (Req 4.3), and maps push failure /
 *   push timeout (Req 5.7).
 * - PR happy path returns the created URL (Req 5.2), duplicate-open-PR reuse
 *   returns the existing URL without calling `pulls.create` (Req 5.6), and PR
 *   failure / timeout surface a redacted error reporting the pushed branch
 *   (Req 5.8).
 * - The token never appears in any thrown error message (Req 7.1, 7.3).
 *
 * ALL `isomorphic-git` and Octokit calls are mocked — no real network, git CLI,
 * terragrunt/terraform, or AWS operation is exercised here.
 */

import { createGitHelper } from './git';

// --- Mock the network-touching collaborators --------------------------------
// isomorphic-git's default export is an object of git operations; mock each
// operation the helper uses. `isomorphic-git/http/node` is only passed through
// as the `http` backend, so a trivial mock suffices.
jest.mock('isomorphic-git', () => ({
  __esModule: true,
  default: {
    clone: jest.fn(),
    listBranches: jest.fn(),
    getRemoteInfo: jest.fn(),
    branch: jest.fn(),
    add: jest.fn(),
    commit: jest.fn(),
    push: jest.fn(),
  },
}));
jest.mock('isomorphic-git/http/node', () => ({
  __esModule: true,
  default: {},
}));
jest.mock('@octokit/rest', () => {
  const pullsList = jest.fn();
  const pullsCreate = jest.fn();
  const Octokit = jest.fn().mockImplementation(() => ({
    pulls: { list: pullsList, create: pullsCreate },
  }));
  // Expose the inner mocks so tests can configure/inspect them.
  (Octokit as unknown as { __pullsList: jest.Mock }).__pullsList = pullsList;
  (Octokit as unknown as { __pullsCreate: jest.Mock }).__pullsCreate =
    pullsCreate;
  return { __esModule: true, Octokit };
});

// Import the mocked modules so tests can drive their behavior. The `default`
// export mirrors how git.ts consumes them (`import git from 'isomorphic-git'`).
import git from 'isomorphic-git';
import { Octokit } from '@octokit/rest';

const mockedGit = git as unknown as {
  clone: jest.Mock;
  listBranches: jest.Mock;
  getRemoteInfo: jest.Mock;
  branch: jest.Mock;
  add: jest.Mock;
  commit: jest.Mock;
  push: jest.Mock;
};
const pullsList = (Octokit as unknown as { __pullsList: jest.Mock })
  .__pullsList;
const pullsCreate = (Octokit as unknown as { __pullsCreate: jest.Mock })
  .__pullsCreate;

const URL = 'https://github.com/example/hello-terragrunt-live';
const TOKEN = 'ghp_super_secret_token_value_0123456789';

beforeEach(() => {
  jest.clearAllMocks();
  // Sensible defaults; individual tests override as needed.
  mockedGit.clone.mockResolvedValue(undefined);
  mockedGit.listBranches.mockResolvedValue([]);
  mockedGit.getRemoteInfo.mockResolvedValue({ heads: {} });
  mockedGit.branch.mockResolvedValue(undefined);
  mockedGit.add.mockResolvedValue(undefined);
  mockedGit.commit.mockResolvedValue(undefined);
  mockedGit.push.mockResolvedValue({});
  pullsList.mockResolvedValue({ data: [] });
  pullsCreate.mockResolvedValue({
    data: { html_url: 'https://github.com/example/hello-terragrunt-live/pull/1' },
  });
});

describe('GitHelper.clone error mapping', () => {
  it('maps a network failure to kind "network-unreachable" (Req 2.3)', async () => {
    const helper = createGitHelper({ url: URL, token: TOKEN });
    mockedGit.clone.mockRejectedValueOnce(
      Object.assign(new Error('getaddrinfo ENOTFOUND github.com'), {
        code: 'ENOTFOUND',
      }),
    );

    await expect(
      helper.clone({ url: URL, ref: 'main', dir: '/tmp/x', timeoutMs: 120_000 }),
    ).rejects.toMatchObject({
      name: 'GitOperationError',
      kind: 'network-unreachable',
    });
  });

  it('maps a missing ref to kind "missing-ref" (Req 2.4)', async () => {
    const helper = createGitHelper({ url: URL, token: TOKEN });
    mockedGit.clone.mockRejectedValueOnce(
      Object.assign(new Error("Could not find ref 'nope'"), {
        code: 'NotFoundError',
      }),
    );

    await expect(
      helper.clone({ url: URL, ref: 'nope', dir: '/tmp/x', timeoutMs: 120_000 }),
    ).rejects.toMatchObject({ kind: 'missing-ref' });
  });

  it('maps rejected auth to kind "auth-rejected" and redacts the token (Req 2.5, 7.3)', async () => {
    const helper = createGitHelper({ url: URL, token: TOKEN });
    // The underlying error embeds the token, as a real HTTP client might.
    mockedGit.clone.mockRejectedValueOnce(
      Object.assign(
        new Error(`HTTP Error: 401 Unauthorized for ${TOKEN}@github.com`),
        { code: 'HttpError', data: { statusCode: 401 } },
      ),
    );

    let caught: (Error & { kind?: string }) | undefined;
    try {
      await helper.clone({
        url: URL,
        ref: 'main',
        dir: '/tmp/x',
        timeoutMs: 120_000,
      });
    } catch (err) {
      caught = err as Error & { kind?: string };
    }

    expect(caught).toBeDefined();
    expect(caught!.kind).toBe('auth-rejected');
    expect(caught!.message).not.toContain(TOKEN);
  });

  it('maps a slow clone to kind "timeout" when the timeout wins (Req 2.6)', async () => {
    const helper = createGitHelper({ url: URL, token: TOKEN });
    // Never settle so the internal timeout fires first.
    mockedGit.clone.mockImplementationOnce(() => new Promise(() => {}));

    await expect(
      helper.clone({ url: URL, ref: 'main', dir: '/tmp/x', timeoutMs: 5 }),
    ).rejects.toMatchObject({ kind: 'timeout' });
  });

  it('never leaks the token in a clone error message (Req 7.1, 7.3)', async () => {
    const helper = createGitHelper({ url: URL, token: TOKEN });
    mockedGit.clone.mockRejectedValueOnce(
      new Error(`boom with ${TOKEN} inside`),
    );

    let message = '';
    try {
      await helper.clone({
        url: URL,
        ref: 'main',
        dir: '/tmp/x',
        timeoutMs: 120_000,
      });
    } catch (err) {
      message = (err as Error).message;
    }

    expect(message).not.toContain(TOKEN);
  });
});

describe('GitHelper.localBranchOrRemoteExists (Req 4.4)', () => {
  async function cloneHelper() {
    const helper = createGitHelper({ url: URL, token: TOKEN });
    await helper.clone({
      url: URL,
      ref: 'main',
      dir: '/tmp/x',
      timeoutMs: 120_000,
    });
    return helper;
  }

  it('returns true when the branch exists locally', async () => {
    const helper = await cloneHelper();
    mockedGit.listBranches.mockResolvedValueOnce(['main', 'devops/acme-dev-1']);

    await expect(
      helper.localBranchOrRemoteExists('devops/acme-dev-1'),
    ).resolves.toBe(true);
    // Remote lookup is unnecessary once found locally.
    expect(mockedGit.getRemoteInfo).not.toHaveBeenCalled();
  });

  it('returns true when the branch exists on the remote (short ref key)', async () => {
    const helper = await cloneHelper();
    mockedGit.listBranches.mockResolvedValueOnce(['main']);
    mockedGit.getRemoteInfo.mockResolvedValueOnce({
      heads: { 'devops/acme-dev-1': 'abc123' },
    });

    await expect(
      helper.localBranchOrRemoteExists('devops/acme-dev-1'),
    ).resolves.toBe(true);
  });

  it('returns true when the remote exposes the branch under refs/heads/*', async () => {
    const helper = await cloneHelper();
    mockedGit.listBranches.mockResolvedValueOnce(['main']);
    mockedGit.getRemoteInfo.mockResolvedValueOnce({
      heads: { 'refs/heads/devops/acme-dev-1': 'abc123' },
    });

    await expect(
      helper.localBranchOrRemoteExists('devops/acme-dev-1'),
    ).resolves.toBe(true);
  });

  it('returns false when the branch exists neither locally nor remotely', async () => {
    const helper = await cloneHelper();
    mockedGit.listBranches.mockResolvedValueOnce(['main']);
    mockedGit.getRemoteInfo.mockResolvedValueOnce({ heads: { main: 'abc' } });

    await expect(
      helper.localBranchOrRemoteExists('devops/acme-dev-1'),
    ).resolves.toBe(false);
  });
});

describe('GitHelper.createBranchCommitPush', () => {
  const branch = 'devops/acme-dev-20240101-000000';
  const message = 'Provision tenant acme in environment dev';

  async function cloneHelper() {
    const helper = createGitHelper({ url: URL, token: TOKEN });
    await helper.clone({
      url: URL,
      ref: 'main',
      dir: '/tmp/x',
      timeoutMs: 120_000,
    });
    return helper;
  }

  it('stages exactly terragrunt.hcl and commits with a tenant+env message (Req 4.3)', async () => {
    const helper = await cloneHelper();

    await helper.createBranchCommitPush({
      branch,
      baseBranch: 'main',
      filePath: 'acme/dev/terragrunt.hcl',
      message,
      timeoutMs: 60_000,
    });

    // Exactly one file staged, and it is the tenant terragrunt.hcl.
    expect(mockedGit.add).toHaveBeenCalledTimes(1);
    expect(mockedGit.add).toHaveBeenCalledWith(
      expect.objectContaining({ filepath: 'acme/dev/terragrunt.hcl' }),
    );

    // Commit made with the provided tenant+env message.
    expect(mockedGit.commit).toHaveBeenCalledTimes(1);
    expect(mockedGit.commit).toHaveBeenCalledWith(
      expect.objectContaining({ message }),
    );
    const commitArg = mockedGit.commit.mock.calls[0][0];
    expect(commitArg.message).toContain('acme');
    expect(commitArg.message).toContain('dev');

    // The branch was created and pushed.
    expect(mockedGit.branch).toHaveBeenCalledWith(
      expect.objectContaining({ ref: branch, checkout: true }),
    );
    expect(mockedGit.push).toHaveBeenCalledTimes(1);
  });

  it('maps a rejected push to kind "push-rejected" (Req 5.7)', async () => {
    const helper = await cloneHelper();
    // isomorphic-git surfaces a push rejection via the result.error field.
    mockedGit.push.mockResolvedValueOnce({ error: 'failed to push some refs' });

    await expect(
      helper.createBranchCommitPush({
        branch,
        baseBranch: 'main',
        filePath: 'acme/dev/terragrunt.hcl',
        message,
        timeoutMs: 60_000,
      }),
    ).rejects.toMatchObject({
      name: 'GitOperationError',
      kind: 'push-rejected',
    });
  });

  it('maps a slow push to kind "timeout" (Req 5.7)', async () => {
    const helper = await cloneHelper();
    mockedGit.push.mockImplementationOnce(() => new Promise(() => {}));

    await expect(
      helper.createBranchCommitPush({
        branch,
        baseBranch: 'main',
        filePath: 'acme/dev/terragrunt.hcl',
        message,
        timeoutMs: 5,
      }),
    ).rejects.toMatchObject({ kind: 'timeout' });
  });

  it('never leaks the token when a push is rejected (Req 7.1, 7.3)', async () => {
    const helper = await cloneHelper();
    mockedGit.push.mockResolvedValueOnce({
      error: `remote rejected using ${TOKEN}`,
    });

    let msg = '';
    try {
      await helper.createBranchCommitPush({
        branch,
        baseBranch: 'main',
        filePath: 'acme/dev/terragrunt.hcl',
        message,
        timeoutMs: 60_000,
      });
    } catch (err) {
      msg = (err as Error).message;
    }

    expect(msg).not.toContain(TOKEN);
  });
});

describe('GitHelper pull requests', () => {
  const helper = () => createGitHelper({ url: URL, token: TOKEN });
  const prOpts = {
    head: 'devops/acme-dev-20240101-000000',
    base: 'main',
    title: 'Provision acme / dev',
    timeoutMs: 60_000,
  };

  it('findOpenPullRequest returns the existing PR url when one is open (Req 5.6)', async () => {
    pullsList.mockResolvedValueOnce({
      data: [{ html_url: 'https://github.com/example/hello-terragrunt-live/pull/7' }],
    });

    await expect(
      helper().findOpenPullRequest({ head: prOpts.head, base: prOpts.base }),
    ).resolves.toEqual({
      url: 'https://github.com/example/hello-terragrunt-live/pull/7',
    });
  });

  it('findOpenPullRequest returns undefined when no open PR matches (Req 5.6)', async () => {
    pullsList.mockResolvedValueOnce({ data: [] });

    await expect(
      helper().findOpenPullRequest({ head: prOpts.head, base: prOpts.base }),
    ).resolves.toBeUndefined();
  });

  it('createPullRequest returns the created PR url on the happy path (Req 5.2)', async () => {
    pullsList.mockResolvedValueOnce({ data: [] });
    pullsCreate.mockResolvedValueOnce({
      data: { html_url: 'https://github.com/example/hello-terragrunt-live/pull/42' },
    });

    await expect(helper().createPullRequest(prOpts)).resolves.toEqual({
      url: 'https://github.com/example/hello-terragrunt-live/pull/42',
    });
    expect(pullsCreate).toHaveBeenCalledTimes(1);
  });

  it('createPullRequest reuses an existing open PR without creating a duplicate (Req 5.6)', async () => {
    pullsList.mockResolvedValueOnce({
      data: [{ html_url: 'https://github.com/example/hello-terragrunt-live/pull/9' }],
    });

    await expect(helper().createPullRequest(prOpts)).resolves.toEqual({
      url: 'https://github.com/example/hello-terragrunt-live/pull/9',
    });
    // No duplicate PR is created.
    expect(pullsCreate).not.toHaveBeenCalled();
  });

  it('createPullRequest fails reporting the pushed branch when creation fails (Req 5.8)', async () => {
    pullsList.mockResolvedValueOnce({ data: [] });
    pullsCreate.mockRejectedValueOnce(new Error('422 Unprocessable Entity'));

    let caught: (Error & { kind?: string }) | undefined;
    try {
      await helper().createPullRequest(prOpts);
    } catch (err) {
      caught = err as Error & { kind?: string };
    }

    expect(caught).toBeDefined();
    expect(caught!.name).toBe('GitOperationError');
    // The error reports the pushed feature branch so the operator can find it.
    expect(caught!.message).toContain(prOpts.head);
  });

  it('createPullRequest maps a slow creation to kind "timeout" reporting the branch (Req 5.8)', async () => {
    pullsList.mockResolvedValueOnce({ data: [] });
    pullsCreate.mockImplementationOnce(() => new Promise(() => {}));

    let caught: (Error & { kind?: string }) | undefined;
    try {
      await helper().createPullRequest({ ...prOpts, timeoutMs: 5 });
    } catch (err) {
      caught = err as Error & { kind?: string };
    }

    expect(caught).toBeDefined();
    expect(caught!.kind).toBe('timeout');
    expect(caught!.message).toContain(prOpts.head);
  });

  it('never leaks the token when PR creation fails (Req 7.1, 7.3)', async () => {
    pullsList.mockResolvedValueOnce({ data: [] });
    pullsCreate.mockRejectedValueOnce(
      new Error(`bad credentials ${TOKEN}`),
    );

    let msg = '';
    try {
      await helper().createPullRequest(prOpts);
    } catch (err) {
      msg = (err as Error).message;
    }

    expect(msg).not.toContain(TOKEN);
  });
});
