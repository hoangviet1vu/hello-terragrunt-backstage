/**
 * Bug condition exploration test for the tenant-provisioning "Tenant name"
 * BACKEND validation (spec: tenant-name-allow-uppercase).
 *
 * This test encodes the EXPECTED (post-fix) behavior described in the bugfix
 * design's "Correctness Properties" -> Property 1: any `tenantName` that is 1
 * to 32 characters of letters/digits/hyphens and contains at least one
 * uppercase letter (`A-Z`) must be ACCEPTED by the `tenant:provision` action's
 * zod input schema AND its fail-fast guard (`TENANT_NAME_PATTERN`).
 *
 * The FRONTEND half of Property 1 (the committed template.yaml `pattern`,
 * validated with ajv) is exercised in the backend package:
 * `packages/backend/src/tenantProvisioningTemplate.tenantNameUppercase.bug.property.test.ts`.
 *
 * IMPORTANT: This test is EXPECTED TO FAIL on the current (unfixed) code.
 * `TENANT_NAME_PATTERN` is `^[a-z0-9-]{1,32}$`, whose `[a-z0-9-]` character
 * class excludes `A-Z`, so uppercase-containing names like `MYCOMPANY`,
 * `MyTenant`, `Tenant-01`, and `A` are rejected by the zod schema and the
 * fail-fast guard. That failure is the proof the bug exists. Do NOT fix the
 * test or the action in this task -- once the fix (task 3) broadens the pattern
 * to `^[A-Za-z0-9-]{1,32}$`, this same test will pass.
 *
 * The side-effecting collaborators are mocked so that a bug-condition name that
 * PASSES the guard is distinguishable from one that is rejected: on acceptance,
 * the handler proceeds into the (mocked, throwing) side-effecting phase, whose
 * error does not mention `tenantName`; on rejection, the guard throws an error
 * that DOES mention `tenantName`.
 */

import fc from 'fast-check';
import { mockServices } from '@backstage/backend-test-utils';

// --- Mock the side-effecting collaborators so no real work happens ----------
jest.mock('../workspace', () => ({
  __esModule: true,
  createWorkspace: jest.fn(),
}));
jest.mock('../git', () => ({
  __esModule: true,
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

/** The original (unfixed) lowercase-only pattern. */
const OLD_PATTERN = /^[a-z0-9-]{1,32}$/;
/** The fixed pattern that also permits uppercase letters. */
const FIXED_PATTERN = /^[A-Za-z0-9-]{1,32}$/;

/**
 * isBugCondition(input) from the design: input matches the fixed pattern
 * `^[A-Za-z0-9-]{1,32}$` but NOT the original `^[a-z0-9-]{1,32}$` -- i.e. it is
 * 1-32 chars of letters/digits/hyphens and contains at least one uppercase.
 */
function isBugCondition(input: string): boolean {
  return FIXED_PATTERN.test(input) && !OLD_PATTERN.test(input);
}

/** Builds a minimal ActionContext sufficient to drive the handler. */
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

/**
 * True iff the backend accepted `tenantName` (i.e. no `tenantName` validation
 * error surfaced). A tenantName rejection throws an error mentioning
 * `tenantName`; anything else (or no error) means the name passed the guard.
 */
async function backendAcceptsTenantName(tenantName: string): Promise<boolean> {
  const error = await runHandler({
    tenantName,
    environment: 'dev',
    selectedComponents: [],
  });
  if (!error) {
    return true;
  }
  return !/tenantName/i.test(error.message);
}

/** Deterministic bug-condition names from the design, for reproducibility. */
const CONCRETE_BUG_NAMES = ['MYCOMPANY', 'MyTenant', 'Tenant-01', 'A'];

describe('createTenantProvisionAction: uppercase tenantName is accepted (bug condition)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Valid config so a name that passes the guard fails later for reasons
    // unrelated to tenantName (the mocked git helper is undefined and throws).
    mockedReadConfig.mockReturnValue({
      liveRepoUrl: 'https://github.com/example/hello-terragrunt-live',
      liveRepoBranch: 'main',
      moduleSource: 'git::https://example.com/modules//tenant?ref=v1',
      allowedComponents: ['dynamodb', 'ecr'],
    });
    // Return a token so the pre-workspace phase does not fail on auth.
    mockedResolveLiveRepoToken.mockResolvedValue('ghp_token');
  });

  // Guard: confirms the concrete cases really are bug-condition inputs.
  it('classifies the concrete cases as bug-condition inputs', () => {
    for (const name of CONCRETE_BUG_NAMES) {
      expect(isBugCondition(name)).toBe(true);
    }
  });

  // Property 1 (Bug Condition), backend: each concrete uppercase-containing
  // name must be ACCEPTED by the zod schema + fail-fast guard. On unfixed code
  // these FAIL because TENANT_NAME_PATTERN is `^[a-z0-9-]{1,32}$`.
  // Validates: Requirements 1.2, 2.2
  it.each(CONCRETE_BUG_NAMES)(
    'backend guard accepts uppercase-containing name %p (Req 1.2, 2.2)',
    async name => {
      expect(await backendAcceptsTenantName(name)).toBe(true);
    },
  );

  // Property 1 (Bug Condition), scoped PBT (backend): generate random 1-32 char
  // letters/digits/hyphens strings containing at least one uppercase and assert
  // the backend guard accepts every one. On unfixed code this FAILS, surfacing
  // counterexamples that prove the bug.
  // Validates: Requirements 1.2, 2.2
  it('backend guard accepts every bug-condition name (Property 1)', async () => {
    const alphabet = fc.constantFrom(
      ...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-'.split(
        '',
      ),
    );
    const bugConditionName = fc
      .array(alphabet, { minLength: 1, maxLength: 32 })
      .map(chars => chars.join(''))
      .filter(isBugCondition);

    await fc.assert(
      fc.asyncProperty(bugConditionName, async name => {
        expect(await backendAcceptsTenantName(name)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});

// Silence unused-mock lints: these spies exist to prevent real side effects.
void mockedCreateWorkspace;
void mockedCreateGitHelper;
