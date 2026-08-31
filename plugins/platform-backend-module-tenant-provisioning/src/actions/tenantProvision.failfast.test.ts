/**
 * Property-based test for the `tenant:provision` action's fail-fast input
 * validation (design "Correctness Properties" -> Property 4, "Testing Strategy"
 * -> Property-based tests, mapping sub-task 10.3).
 *
 * Property 4 targets the action handler's own fail-fast guard: for any input
 * where the tenant name is absent, empty, blank, or violates
 * `^[a-z0-9-]{1,32}$`, or the environment is not exactly one of `dev`, `test`,
 * `uat`, `prod`, the handler MUST fail with a validation error identifying the
 * offending input and MUST perform no side effect — no working directory is
 * created, no clone is attempted, and no branch/commit/pull request is created.
 *
 * To assert "no side effects" the side-effecting collaborators are mocked as
 * jest.fn spies: `createWorkspace`/`resolveLiveRepoToken`/`createGitHelper` (and
 * `readTenantProvisioningConfig`). The test asserts the handler rejects AND that
 * none of `createWorkspace`, `resolveLiveRepoToken`, or `createGitHelper` were
 * ever invoked. No real git/network/terragrunt/terraform/AWS operation runs.
 */

import fc from 'fast-check';
import { mockServices } from '@backstage/backend-test-utils';

// --- Mock the side-effecting collaborators as jest.fn spies -----------------
// If the handler's fail-fast guard is correct, none of these are ever called on
// invalid input. They are spies purely so the test can prove that.
jest.mock('../workspace', () => ({
  __esModule: true,
  createWorkspace: jest.fn(),
}));
jest.mock('../git', () => ({
  __esModule: true,
  // Timeout constants are read at module scope by the handler, so keep them.
  CLONE_TIMEOUT_MS: 120_000,
  PUSH_TIMEOUT_MS: 60_000,
  PULL_REQUEST_TIMEOUT_MS: 60_000,
  resolveLiveRepoToken: jest.fn(),
  createGitHelper: jest.fn(),
}));
jest.mock('../config', () => ({
  __esModule: true,
  readTenantProvisioningConfig: jest.fn(),
}));

import { createTenantProvisionAction } from './tenantProvision';
import { createWorkspace } from '../workspace';
import { createGitHelper, resolveLiveRepoToken } from '../git';
import { readTenantProvisioningConfig } from '../config';

const mockedCreateWorkspace = createWorkspace as unknown as jest.Mock;
const mockedResolveLiveRepoToken = resolveLiveRepoToken as unknown as jest.Mock;
const mockedCreateGitHelper = createGitHelper as unknown as jest.Mock;
const mockedReadConfig = readTenantProvisioningConfig as unknown as jest.Mock;

/**
 * Builds a minimal ActionContext sufficient to drive the handler. Only the
 * fields the handler reads (`input`, `logger`, `output`, `workspacePath`) are
 * provided.
 */
function buildCtx(input: unknown) {
  const outputs: Record<string, unknown> = {};
  return {
    input,
    logger: mockServices.logger.mock(),
    workspacePath: '/tmp/scaffolder-workspace',
    output: (name: string, value: unknown) => {
      outputs[name] = value;
    },
    outputs,
  } as any;
}

/** Runs the handler against an input, returning the caught error (or undefined). */
async function runHandler(input: unknown): Promise<Error | undefined> {
  const action = createTenantProvisionAction({
    config: mockServices.rootConfig(),
    logger: mockServices.logger.mock(),
  });
  const ctx = buildCtx(input);
  try {
    await (action as any).handler(ctx);
    return undefined;
  } catch (err) {
    return err as Error;
  }
}

/** Asserts no side-effecting collaborator was invoked. */
function expectNoSideEffects() {
  expect(mockedCreateWorkspace).not.toHaveBeenCalled();
  expect(mockedResolveLiveRepoToken).not.toHaveBeenCalled();
  expect(mockedCreateGitHelper).not.toHaveBeenCalled();
}

const VALID_ENVIRONMENTS = ['dev', 'test', 'uat', 'prod'];
const VALID_TENANT_RE = /^[a-z0-9-]{1,32}$/;

/**
 * Arbitrary tenant-name value that is INVALID against `^[a-z0-9-]{1,32}$`.
 * Covers: absent (undefined), null, empty string, blank/whitespace, too long
 * (>32), and arbitrary strings containing out-of-range characters (uppercase,
 * symbols, spaces, unicode). Any value that happens to be valid is filtered
 * out, so every generated case is genuinely invalid.
 */
const invalidTenantNameArb = fc.oneof(
  fc.constant(undefined),
  fc.constant(null),
  fc.constant(''),
  fc.constantFrom(' ', '   ', '\t', '\n'),
  // Valid-charset but too long (>32).
  fc
    .array(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-'.split('')), {
      minLength: 33,
      maxLength: 64,
    })
    .map(chars => chars.join('')),
  // Arbitrary strings, keep only those that violate the pattern.
  fc.string({ minLength: 1, maxLength: 40 }).filter(s => !VALID_TENANT_RE.test(s)),
  // Non-string types.
  fc.integer(),
  fc.boolean(),
);

/** Arbitrary valid tenant name (used when the environment is the invalid part). */
const validTenantNameArb = fc
  .array(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-'.split('')), {
    minLength: 1,
    maxLength: 32,
  })
  .map(chars => chars.join(''));

/**
 * Arbitrary environment value that is INVALID (not exactly one of the four
 * allowed values): absent, null, empty, wrong case, near-misses, and arbitrary
 * strings/types that are not in the enum.
 */
const invalidEnvironmentArb = fc.oneof(
  fc.constant(undefined),
  fc.constant(null),
  fc.constant(''),
  fc.constantFrom('Dev', 'PROD', 'staging', 'production', 'test ', ' uat', 'qa'),
  fc.string({ maxLength: 20 }).filter(s => !VALID_ENVIRONMENTS.includes(s)),
  fc.integer(),
  fc.boolean(),
);

/** Arbitrary optional selectedComponents array (irrelevant to validation). */
const selectedComponentsArb = fc.oneof(
  fc.constant(undefined),
  fc.array(fc.string({ maxLength: 8 }), { maxLength: 4 }),
);

describe('createTenantProvisionAction: fail-fast input validation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // A valid config so that, if any input somehow slips past the guard, the
    // failure would be attributable to the guard (and this makes the config
    // read a no-op spy rather than throwing for an unrelated reason).
    mockedReadConfig.mockReturnValue({
      liveRepoUrl: 'https://github.com/example/hello-terragrunt-live',
      liveRepoBranch: 'main',
      moduleSource: 'git::https://example.com/modules//tenant?ref=v1',
      allowedComponents: ['dynamodb', 'ecr'],
    });
  });

  // Feature: tenant-provision-action, Property 4: Invalid input is rejected with no side effects
  // Validates: Requirements 1.4, 8.1, 8.2, 8.3, 8.4
  it('rejects an invalid tenantName with a validation error and no side effects (Property 4)', async () => {
    await fc.assert(
      fc.asyncProperty(
        invalidTenantNameArb,
        fc.constantFrom(...VALID_ENVIRONMENTS),
        selectedComponentsArb,
        async (tenantName, environment, selectedComponents) => {
          const error = await runHandler({
            tenantName,
            environment,
            selectedComponents,
          });

          // The handler fails with a validation error identifying the input.
          expect(error).toBeInstanceOf(Error);
          expect(error!.message).toMatch(/tenantName/i);

          // No side effect was performed.
          expectNoSideEffects();

          jest.clearAllMocks();
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: tenant-provision-action, Property 4: Invalid input is rejected with no side effects
  // Validates: Requirements 1.4, 8.1, 8.2, 8.3, 8.4
  it('rejects an invalid environment with a validation error and no side effects (Property 4)', async () => {
    await fc.assert(
      fc.asyncProperty(
        validTenantNameArb,
        invalidEnvironmentArb,
        selectedComponentsArb,
        async (tenantName, environment, selectedComponents) => {
          const error = await runHandler({
            tenantName,
            environment,
            selectedComponents,
          });

          // The handler fails with a validation error identifying the input.
          expect(error).toBeInstanceOf(Error);
          expect(error!.message).toMatch(/environment/i);

          // No side effect was performed.
          expectNoSideEffects();

          jest.clearAllMocks();
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: tenant-provision-action, Property 4: Invalid input is rejected with no side effects
  // Validates: Requirements 1.4, 8.1, 8.2, 8.3, 8.4
  it('rejects when both tenantName and environment are invalid, with no side effects (Property 4)', async () => {
    await fc.assert(
      fc.asyncProperty(
        invalidTenantNameArb,
        invalidEnvironmentArb,
        async (tenantName, environment) => {
          const error = await runHandler({ tenantName, environment });

          expect(error).toBeInstanceOf(Error);
          // tenantName is validated first, so its message surfaces.
          expect(error!.message).toMatch(/tenantName/i);

          expectNoSideEffects();

          jest.clearAllMocks();
        },
      ),
      { numRuns: 100 },
    );
  });
});
