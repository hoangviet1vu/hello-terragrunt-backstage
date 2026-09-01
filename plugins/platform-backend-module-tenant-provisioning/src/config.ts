import { RootConfigService } from '@backstage/backend-plugin-api';

/**
 * Resolved configuration for the tenant-provision action, read from the
 * `tenantProvisioning` app-config block.
 */
export interface TenantProvisioningConfig {
  /** tenantProvisioning.liveRepoUrl (<- ${TENANT_LIVE_REPO_URL}). */
  liveRepoUrl: string;
  /** tenantProvisioning.liveRepoBranch (<- ${TENANT_LIVE_REPO_BRANCH}); defaults to `main`. */
  liveRepoBranch: string;
  /** tenantProvisioning.moduleSource (<- ${TERRAGRUNT_MODULE_SOURCE}); required, non-empty. */
  moduleSource: string;
  /** tenantProvisioning.components; the Allowed_Components list; defaults to `['dynamodb', 'ecr']`. */
  allowedComponents: string[];
}

/** Default base branch used when `tenantProvisioning.liveRepoBranch` is not configured. */
const DEFAULT_LIVE_REPO_BRANCH = 'main';

/** Default Allowed_Components used when `tenantProvisioning.components` is not configured. */
const DEFAULT_ALLOWED_COMPONENTS = ['dynamodb', 'ecr'];

/** Pattern every allowed component name must match. */
const COMPONENT_NAME_PATTERN = /^[a-z0-9_]+$/;

/** Maximum number of entries permitted in the Allowed_Components set. */
const MAX_ALLOWED_COMPONENTS = 100;

/**
 * Reads and validates the `tenantProvisioning` config block.
 *
 * - `liveRepoUrl`, `liveRepoBranch`, and `moduleSource` are read via
 *   `getOptionalString`; `components` via `getOptionalStringArray`.
 * - `liveRepoBranch` defaults to `main` when absent (Req 1.7).
 * - `components` defaults to `['dynamodb', 'ecr']` when absent (Req 1.10).
 * - Throws a config error naming the key when `moduleSource` is absent or empty (Req 1.8).
 * - Rejects an allowed name not matching `^[a-z0-9_]+$` (Req 9.7) and an allowed-set
 *   larger than 100 entries (Req 9.8), before returning.
 *
 * Values come from `${ENV_VAR}` references, never literals (Req 1.9).
 */
export function readTenantProvisioningConfig(
  config: RootConfigService,
): TenantProvisioningConfig {
  const liveRepoUrl = config.getOptionalString('tenantProvisioning.liveRepoUrl');
  const liveRepoBranch =
    config.getOptionalString('tenantProvisioning.liveRepoBranch') ??
    DEFAULT_LIVE_REPO_BRANCH;
  const moduleSource = config.getOptionalString('tenantProvisioning.moduleSource');
  const allowedComponents =
    config.getOptionalStringArray('tenantProvisioning.components') ??
    [...DEFAULT_ALLOWED_COMPONENTS];

  if (moduleSource === undefined || moduleSource.length === 0) {
    throw new Error(
      "Missing required config value 'tenantProvisioning.moduleSource' (TERRAGRUNT_MODULE_SOURCE)",
    );
  }

  if (allowedComponents.length > MAX_ALLOWED_COMPONENTS) {
    throw new Error(
      `Config value 'tenantProvisioning.components' has ${allowedComponents.length} entries, which exceeds the allowed maximum of ${MAX_ALLOWED_COMPONENTS}`,
    );
  }

  for (const name of allowedComponents) {
    if (!COMPONENT_NAME_PATTERN.test(name)) {
      throw new Error(
        `Config value 'tenantProvisioning.components' contains an invalid component name '${name}'; component names must match ${COMPONENT_NAME_PATTERN}`,
      );
    }
  }

  return {
    liveRepoUrl: liveRepoUrl ?? '',
    liveRepoBranch,
    moduleSource,
    allowedComponents,
  };
}
