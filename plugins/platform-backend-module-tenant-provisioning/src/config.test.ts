/**
 * Unit tests for the ConfigReader (`readTenantProvisioningConfig`).
 *
 * These are example-based tests covering the config defaults and validation
 * rules described in the design's "Testing Strategy -> Unit and integration
 * tests" section. They use `@backstage/backend-test-utils`'
 * `mockServices.rootConfig` to build the `tenantProvisioning` config block that
 * the reader consumes; it returns a real `RootConfigService` exposing the
 * `getOptionalString`/`getOptionalStringArray` surface the reader depends on.
 *
 * No git/network/terragrunt operation is exercised here.
 */

import { mockServices } from '@backstage/backend-test-utils';
import { JsonObject } from '@backstage/types';
import { readTenantProvisioningConfig } from './config';

/**
 * Build a `RootConfigService` from a `tenantProvisioning` block, as it is
 * supplied to the reader at runtime.
 */
function makeConfig(tenantProvisioning: JsonObject) {
  return mockServices.rootConfig({ data: { tenantProvisioning } });
}

describe('readTenantProvisioningConfig', () => {
  const baseValid = {
    liveRepoUrl: 'https://github.com/example/hello-terragrunt-live',
    moduleSource: 'git::https://github.com/example/modules//tenant',
  };

  it('defaults liveRepoBranch to "main" when the branch is absent (Req 1.7)', () => {
    const config = makeConfig({ ...baseValid });

    const result = readTenantProvisioningConfig(config);

    expect(result.liveRepoBranch).toBe('main');
  });

  it('uses the configured liveRepoBranch when supplied (Req 1.7)', () => {
    const config = makeConfig({ ...baseValid, liveRepoBranch: 'develop' });

    const result = readTenantProvisioningConfig(config);

    expect(result.liveRepoBranch).toBe('develop');
  });

  it('fails with a key-naming error when moduleSource is absent (Req 1.8)', () => {
    const config = makeConfig({ liveRepoUrl: baseValid.liveRepoUrl });

    expect(() => readTenantProvisioningConfig(config)).toThrow(
      /tenantProvisioning\.moduleSource/,
    );
  });

  it('fails with a key-naming error when moduleSource is empty (Req 1.8)', () => {
    const config = makeConfig({ ...baseValid, moduleSource: '' });

    expect(() => readTenantProvisioningConfig(config)).toThrow(
      /tenantProvisioning\.moduleSource/,
    );
  });

  it('defaults allowedComponents to [dynamodb, ecr] when components is absent (Req 1.10)', () => {
    const config = makeConfig({ ...baseValid });

    const result = readTenantProvisioningConfig(config);

    expect(result.allowedComponents).toEqual(['dynamodb', 'ecr']);
  });

  it('uses the configured components list when supplied (Req 1.10)', () => {
    const config = makeConfig({
      ...baseValid,
      components: ['dynamodb', 'ecr', 's3_bucket'],
    });

    const result = readTenantProvisioningConfig(config);

    expect(result.allowedComponents).toEqual(['dynamodb', 'ecr', 's3_bucket']);
  });

  it('fails when an allowed component name violates ^[a-z0-9_]+$ (Req 9.7)', () => {
    const config = makeConfig({
      ...baseValid,
      components: ['dynamodb', 'Invalid-Name'],
    });

    expect(() => readTenantProvisioningConfig(config)).toThrow(
      /Invalid-Name/,
    );
  });

  it('fails when the allowed-set has more than 100 entries (Req 9.8)', () => {
    const oversized = Array.from({ length: 101 }, (_, i) => `component_${i}`);
    const config = makeConfig({ ...baseValid, components: oversized });

    expect(() => readTenantProvisioningConfig(config)).toThrow(
      /exceeds the allowed maximum/,
    );
  });

  it('accepts an allowed-set at the 100-entry boundary (Req 9.8)', () => {
    const atLimit = Array.from({ length: 100 }, (_, i) => `component_${i}`);
    const config = makeConfig({ ...baseValid, components: atLimit });

    const result = readTenantProvisioningConfig(config);

    expect(result.allowedComponents).toHaveLength(100);
  });

  it('resolves all fields for a fully valid config', () => {
    const config = makeConfig({
      ...baseValid,
      liveRepoBranch: 'main',
      components: ['dynamodb', 'ecr'],
    });

    const result = readTenantProvisioningConfig(config);

    expect(result).toEqual({
      liveRepoUrl: baseValid.liveRepoUrl,
      liveRepoBranch: 'main',
      moduleSource: baseValid.moduleSource,
      allowedComponents: ['dynamodb', 'ecr'],
    });
  });
});
