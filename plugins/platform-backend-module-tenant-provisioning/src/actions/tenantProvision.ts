import {
  LoggerService,
  RootConfigService,
} from '@backstage/backend-plugin-api';
import { createTemplateAction } from '@backstage/plugin-scaffolder-node';
import { promises as fs } from 'fs';
import path from 'path';

import { readTenantProvisioningConfig } from '../config';
import { expandComponents } from '../components';
import { renderTerragruntHcl, type Environment } from '../hcl';
import { buildBranchName, buildPullRequestTitle } from '../naming';
import { redact } from '../redact';
import { createWorkspace } from '../workspace';
import {
  CLONE_TIMEOUT_MS,
  PULL_REQUEST_TIMEOUT_MS,
  PUSH_TIMEOUT_MS,
  createGitHelper,
  resolveLiveRepoToken,
} from '../git';

/** Input accepted by the `tenant:provision` action. */
export interface TenantProvisionInput {
  tenantName: string;
  environment: Environment;
  /** Names the user selected (a subset of the Allowed_Components); default []. */
  selectedComponents?: string[];
}

/** Output produced by the `tenant:provision` action. */
export interface TenantProvisionOutput {
  pullRequestUrl: string;
  branchName: string;
}

/** Options for constructing the `tenant:provision` action. */
export interface CreateTenantProvisionActionOptions {
  config: RootConfigService;
  logger: LoggerService;
}

/** Tenant name pattern shared by the input schema and the fail-fast guard. */
const TENANT_NAME_PATTERN = /^[a-z0-9-]{1,32}$/;

/** The fixed set of valid environments. */
const ENVIRONMENTS = ['dev', 'test', 'uat', 'prod'] as const;

/**
 * Creates the `tenant:provision` custom scaffolder action.
 *
 * The action validates its inputs and configuration and expands the selected
 * components entirely in-process before creating any working directory or
 * touching the network (fail-fast, Req 8.1-8.4). It then clones the tenant live
 * repository, renders and writes `terragrunt.hcl` at
 * `<tenant>/<environment>/terragrunt.hcl`, creates a timestamped feature branch,
 * commits exactly that file, pushes it, and opens (or reuses) a pull request,
 * exposing `pullRequestUrl` and `branchName` as outputs (Req 5.4). Every path
 * after the workspace is created runs inside a `try/finally` so the working
 * directory is always cleaned up, on success and on failure alike (Req 6.1,
 * 6.2). All surfaced errors pass through {@link redact} so the resolved token
 * never appears in a message (Req 7.1, 7.3).
 */
export function createTenantProvisionAction(
  options: CreateTenantProvisionActionOptions,
) {
  const { config } = options;

  return createTemplateAction({
    id: 'tenant:provision',
    description:
      'Renders/updates a tenant terragrunt.hcl in the live repo and opens a pull request.',
    schema: {
      input: {
        tenantName: z =>
          z
            .string()
            .regex(
              TENANT_NAME_PATTERN,
              'tenantName must match ^[a-z0-9-]{1,32}$',
            )
            .describe('Tenant identifier; must match ^[a-z0-9-]{1,32}$'),
        environment: z =>
          z
            .enum(ENVIRONMENTS)
            .describe('Deployment environment: one of dev, test, uat, prod'),
        selectedComponents: z =>
          z
            .array(z.string())
            .optional()
            .describe('Component names the user selected; defaults to []'),
      },
      output: {
        pullRequestUrl: z =>
          z.string().describe('URL of the created or reused pull request'),
        branchName: z =>
          z.string().describe('The devops/... feature branch that was pushed'),
      },
    },
    async handler(ctx) {
      const executionStart = new Date();
      const { tenantName, environment, selectedComponents } = ctx.input;
      const selected = selectedComponents ?? [];

      // --- Fail-fast validation (before any side effect, Req 8.1-8.4) --------

      // Defense in depth beyond the zod schema: reject absent/invalid inputs
      // before any workspace/clone so nothing is created on bad input.
      if (
        typeof tenantName !== 'string' ||
        !TENANT_NAME_PATTERN.test(tenantName)
      ) {
        throw new Error(
          `Invalid input 'tenantName': must match ^[a-z0-9-]{1,32}$`,
        );
      }
      if (!ENVIRONMENTS.includes(environment)) {
        throw new Error(
          `Invalid input 'environment': must be one of ${ENVIRONMENTS.join(
            ', ',
          )}`,
        );
      }

      // Read and validate config (missing/empty moduleSource, invalid allowed
      // component names, oversized allowed-set all fail here, Req 1.6-1.10,
      // 9.7, 9.8) — still before any workspace/clone.
      const provisioningConfig = readTenantProvisioningConfig(config);

      // Expand the selection against the allowed set; unknown selected names
      // fail here (Req 9.6), before any workspace/clone.
      const components = expandComponents(
        selected,
        provisioningConfig.allowedComponents,
      );

      // Resolve the token before creating the workspace so an auth-config
      // problem fails fast too. The token is never logged.
      const token = await resolveLiveRepoToken(
        config,
        provisioningConfig.liveRepoUrl,
      );
      const secrets = [token];

      // --- Side-effecting phase (workspace created; cleanup in finally) ------

      // Use the scaffolder working directory when available, else undefined so
      // the workspace falls back to the OS temp directory (Req 6.4, 6.5).
      const baseDir = ctx.workspacePath || undefined;
      const workspace = await createWorkspace({
        baseDir,
        tenantName,
        environment,
        secrets,
      });

      try {
        const git = createGitHelper({
          url: provisioningConfig.liveRepoUrl,
          token,
        });

        // Clone the live repo at the base branch into the workspace (Req 2.1).
        await git.clone({
          url: provisioningConfig.liveRepoUrl,
          ref: provisioningConfig.liveRepoBranch,
          dir: workspace.root,
          timeoutMs: CLONE_TIMEOUT_MS,
        });

        // Compute the confined target path <tenant>/<env>/terragrunt.hcl. The
        // resolveWithin guard rejects any path escaping the workspace before
        // any file I/O (Req 3.4, 3.7, 7.4, 7.5).
        const relativeTarget = path.join(
          tenantName,
          environment,
          'terragrunt.hcl',
        );
        const targetPath = workspace.resolveWithin(relativeTarget);

        // Render and write the file, creating parent folders and overwriting an
        // existing file (Req 3.1-3.6, 3.8).
        const contents = renderTerragruntHcl({
          tenantName,
          environment,
          moduleSource: provisioningConfig.moduleSource,
          components,
        });
        try {
          await fs.mkdir(path.dirname(targetPath), { recursive: true });
          await fs.writeFile(targetPath, contents, 'utf8');
        } catch (err) {
          throw new Error(
            `Failed to write the tenant terragrunt.hcl: ${redact(
              String((err as Error).message ?? err),
              secrets,
            )}`,
          );
        }

        // Build the feature branch name and fail if it already exists locally
        // or on the remote, before committing (Req 4.2, 4.4).
        const branchName = buildBranchName(
          tenantName,
          environment,
          executionStart,
        );
        if (await git.localBranchOrRemoteExists(branchName)) {
          throw new Error(
            `Feature branch '${branchName}' already exists in the tenant live repository`,
          );
        }

        // Commit exactly the rendered file with a tenant+env message and push
        // the feature branch (Req 4.1, 4.3, 5.1, 5.7).
        const commitMessage = `Provision tenant ${tenantName} (${environment})`;
        await git.createBranchCommitPush({
          branch: branchName,
          baseBranch: provisioningConfig.liveRepoBranch,
          filePath: targetPath,
          message: commitMessage,
          timeoutMs: PUSH_TIMEOUT_MS,
        });

        // Open a pull request from the feature branch toward the base branch,
        // reusing an already-open PR instead of creating a duplicate (Req 5.2,
        // 5.6, 5.8).
        const { url: pullRequestUrl } = await git.createPullRequest({
          head: branchName,
          base: provisioningConfig.liveRepoBranch,
          title: buildPullRequestTitle(tenantName, environment),
          timeoutMs: PULL_REQUEST_TIMEOUT_MS,
        });

        // Expose the outputs (Req 5.4).
        ctx.output('pullRequestUrl', pullRequestUrl);
        ctx.output('branchName', branchName);
      } catch (error) {
        // Redact any surfaced error so the token can never leak, then rethrow
        // after cleanup runs in the finally block (Req 6.2, 7.3).
        const message =
          error instanceof Error ? error.message : String(error ?? '');
        throw new Error(redact(message, secrets));
      } finally {
        // Always remove the working directory (Req 6.1, 6.2); a failure to
        // fully remove it surfaces a redacted cleanup error naming the path
        // (Req 6.3).
        await workspace.cleanup();
      }
    },
  });
}
