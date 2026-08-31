export interface Config {
  /**
   * Configuration for the `tenant:provision` scaffolder action.
   */
  tenantProvisioning?: {
    /**
     * URL of the tenant "live" Git repository that holds tenant Terragrunt
     * configuration (layout `<tenant-name>/<environment>/terragrunt.hcl`).
     * Sourced from `${TENANT_LIVE_REPO_URL}`.
     */
    liveRepoUrl?: string;

    /**
     * Base branch of the live repository to clone from and open the pull
     * request against. Sourced from `${TENANT_LIVE_REPO_BRANCH}`; defaults to
     * `main` when omitted.
     */
    liveRepoBranch?: string;

    /**
     * Terraform module source string written into the generated `terraform`
     * block's `source` attribute. Sourced from `${TERRAGRUNT_MODULE_SOURCE}`;
     * required (the action fails when absent or empty).
     */
    moduleSource?: string;

    /**
     * The authoritative set of allowed component names (Allowed_Components).
     * Each name must match `^[a-z0-9_]+$`. Defaults to `['dynamodb', 'ecr']`
     * when omitted.
     */
    components?: string[];
  };
}
