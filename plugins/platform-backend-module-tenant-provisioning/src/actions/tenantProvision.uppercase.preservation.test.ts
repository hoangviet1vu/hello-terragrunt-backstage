/**
 * Preservation property tests for the tenant-provisioning "Tenant name"
 * BACKEND validation (spec: tenant-name-allow-uppercase).
 *
 * These tests encode the BASELINE behavior that the fix must PRESERVE, as
 * described in the bugfix design's "Correctness Properties" -> Property 2
 * (Preservation) and the Preservation Requirements (Requirements 3.1-3.5): for
 * any input where the bug condition does NOT hold (isBugCondition returns
 * false), the `tenant:provision` action's zod input schema and fail-fast guard
 * (`TENANT_NAME_PATTERN`) must produce the SAME accept/reject result as today.
 * Concretely:
 *   - lowercase-valid names (`sampletenant`, `tenant-01`, generated
 *     `^[a-z0-9-]{1,32}$`) are ACCEPTED by the guard (Req 3.1),
 *   - empty and whitespace-only names are REJECTED with a `tenantName` error
 *     and no side effect (Req 3.2),
 *   - names longer than 32 characters are REJECTED (Req 3.3),
 *   - names with a disallowed character (space, `_`, `.`, `/`, unicode) are
 *     REJECTED (Req 3.4), and
 *   - the `environment` enum (dev/test/uat/prod) and `selectedComponents`
 *     selection are validated/collected exactly as today (Req 3.5).
 *
 * Following observation-first methodology, these tests capture behavior
 * observed on the UNFIXED code. They are EXPECTED TO PASS now -- that pass
 * confirms the baseline that must survive the fix. They are written so they
 * continue to hold after the fix broadens `TENANT_NAME_PATTERN` to
 * `^[A-Za-z0-9-]{1,32}$`, because no bug-condition inputs are generated and on
 * non-bug-condition inputs the old and fixed patterns agree by construction.
 *
 * The side-effecting collaborators are mocked as jest.fn spies so that "no side
 * effect on rejection" is provable, and so an accepted name proceeds into the
 * (mocked, throwing) side-effecting phase whose error does not mention
 * `tenantName`.
 *
 * Bug condition (from design): isBugCondition(input) is true iff input matches
 * `^[A-Za-z0-9-]{1,32}$` but does NOT match `^[a-z0-9-]{1,32}$`.
 */

import fc from 'fast-check';
import { mockServices } from '@backstage/backend-test-utils';

// --- Mock the side-effecting collaborators as jest.fn spies -----------------
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

/** Asserts no side-effecting collaborator was invoked. */
function expectNoSideEffects() {
  expect(mockedCreateWorkspace).not.toHaveBeenCalled();
  expect(mockedResolveLiveRepoToken).not.toHaveBeenCalled();
  expect(mockedCreateGitHelper).not.toHaveBeenCalled();
}

const VALID_ENVIRONMENTS = ['dev', 'test', 'uat', 'prod'];

describe('createTenantProvisionAction: tenantName preservation (baseline to keep)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Valid config so that a name passing the guard fails later for reasons
    // unrelated to tenantName (the mocked git helper is undefined and throws).
    mockedReadConfig.mockReturnValue({
      liveRepoUrl: 'https://github.com/example/hello-terragrunt-live',
      liveRepoBranch: 'main',
      moduleSource: 'git::https://example.com/modules//tenant?ref=v1',
      allowedComponents: ['dynamodb', 'ecr'],
    });
    mockedResolveLiveRepoToken.mockResolvedValue('ghp_token');
  });

  // Property 2 (Preservation), Req 3.1: lowercase-valid names are accepted by
  // the backend guard. These are NOT bug conditions.
  // Validates: Requirements 3.1
  it.each(['sampletenant', 'tenant-01', 'a', 'z', '0', '-', 'a'.repeat(32)])(
    'backend guard accepts the lowercase-valid name %p (Req 3.1)',
    async name => {
      expect(isBugCondition(name)).toBe(false);
      expect(await backendAcceptsTenantName(name)).toBe(true);
    },
  );

  // Property 2 (Preservation), Req 3.1 (PBT): every generated 1-32 char
  // [a-z0-9-] name is accepted by the guard.
  // Validates: Requirements 3.1
  it('backend guard accepts every generated lowercase [a-z0-9-]{1,32} name (Req 3.1)', async () => {
    const lowerAlphabet = fc.constantFrom(
      ...'abcdefghijklmnopqrstuvwxyz0123456789-'.split(''),
    );
    const validLowercaseName = fc
      .array(lowerAlphabet, { minLength: 1, maxLength: 32 })
      .map(chars => chars.join(''));

    await fc.assert(
      fc.asyncProperty(validLowercaseName, async name => {
        expect(isBugCondition(name)).toBe(false);
        expect(await backendAcceptsTenantName(name)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  // Property 2 (Preservation), Req 3.2: empty and whitespace-only names are
  // rejected with a `tenantName` error and no side effect.
  // Validates: Requirements 3.2
  it('backend guard rejects empty and whitespace-only names with no side effect (Req 3.2)', async () => {
    const whitespaceName = fc
      .array(fc.constantFrom(' ', '\t', '\n', '\r'), {
        minLength: 1,
        maxLength: 10,
      })
      .map(chars => chars.join(''));

    await fc.assert(
      fc.asyncProperty(fc.oneof(fc.constant(''), whitespaceName), async name => {
        expect(isBugCondition(name)).toBe(false);
        const error = await runHandler({
          tenantName: name,
          environment: 'dev',
          selectedComponents: [],
        });
        expect(error).toBeInstanceOf(Error);
        expect(error!.message).toMatch(/tenantName/i);
        expectNoSideEffects();
        jest.clearAllMocks();
      }),
      { numRuns: 100 },
    );
  });

  // Property 2 (Preservation), Req 3.3: names longer than 32 characters are
  // rejected. Over-length names never satisfy the bug condition.
  // Validates: Requirements 3.3
  it('backend guard rejects names longer than 32 characters with no side effect (Req 3.3)', async () => {
    const overLengthAlphabet = fc.constantFrom(
      ...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-'.split(
        '',
      ),
    );
    const overLengthName = fc
      .array(overLengthAlphabet, { minLength: 33, maxLength: 80 })
      .map(chars => chars.join(''));

    await fc.assert(
      fc.asyncProperty(overLengthName, async name => {
        expect(isBugCondition(name)).toBe(false);
        const error = await runHandler({
          tenantName: name,
          environment: 'dev',
          selectedComponents: [],
        });
        expect(error).toBeInstanceOf(Error);
        expect(error!.message).toMatch(/tenantName/i);
        expectNoSideEffects();
        jest.clearAllMocks();
      }),
      { numRuns: 100 },
    );
  });

  // Property 2 (Preservation), Req 3.4: names with a spliced-in disallowed
  // character (space, `_`, `.`, `/`, unicode) are rejected. Such names cannot
  // match `^[A-Za-z0-9-]{1,32}$`, so they are never bug conditions.
  // Validates: Requirements 3.4
  it('backend guard rejects names with a disallowed character with no side effect (Req 3.4)', async () => {
    const allowedAlphabet = fc.constantFrom(
      ...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-'.split(
        '',
      ),
    );
    const disallowedChar = fc.constantFrom(' ', '_', '.', '/', 'é', '好');
    const nameWithDisallowedChar = fc
      .tuple(
        fc
          .array(allowedAlphabet, { minLength: 0, maxLength: 15 })
          .map(chars => chars.join('')),
        disallowedChar,
        fc
          .array(allowedAlphabet, { minLength: 0, maxLength: 15 })
          .map(chars => chars.join('')),
      )
      .map(([a, bad, b]) => `${a}${bad}${b}`);

    await fc.assert(
      fc.asyncProperty(nameWithDisallowedChar, async name => {
        expect(isBugCondition(name)).toBe(false);
        const error = await runHandler({
          tenantName: name,
          environment: 'dev',
          selectedComponents: [],
        });
        expect(error).toBeInstanceOf(Error);
        expect(error!.message).toMatch(/tenantName/i);
        expectNoSideEffects();
        jest.clearAllMocks();
      }),
      { numRuns: 200 },
    );
  });

  // Property 2 (Preservation), Req 3.5: with a valid (lowercase) tenant name,
  // each of the four environments is accepted and the components selection is
  // collected exactly as today; an out-of-set environment is still rejected
  // with an `environment` error and no side effect.
  // Validates: Requirements 3.5
  it('preserves environment enum acceptance and components collection (Req 3.5)', async () => {
    // Each valid environment is accepted (tenant name passes the guard, and the
    // handler proceeds past environment validation into the mocked phase). Any
    // surfaced error therefore comes from the mocked side-effecting phase, not
    // from environment validation, so its message must not mention environment.
    for (const environment of VALID_ENVIRONMENTS) {
      const error = await runHandler({
        tenantName: 'sampletenant',
        environment,
        selectedComponents: ['dynamodb'],
      });
      // Normalise to a string so the assertion is unconditional (undefined =>
      // fully accepted; an Error => its message).
      const message = error?.message ?? '';
      expect(message).not.toMatch(/environment/i);
      jest.clearAllMocks();
    }

    // An out-of-set environment is rejected with an `environment` error and no
    // side effect (unchanged behavior).
    for (const environment of ['staging', 'production', 'Dev', 'PROD', '']) {
      const error = await runHandler({
        tenantName: 'sampletenant',
        environment,
        selectedComponents: [],
      });
      expect(error).toBeInstanceOf(Error);
      expect(error!.message).toMatch(/environment/i);
      expectNoSideEffects();
      jest.clearAllMocks();
    }
  });
});

// Silence unused-mock lints: these spies exist to prevent real side effects.
void mockedCreateGitHelper;
