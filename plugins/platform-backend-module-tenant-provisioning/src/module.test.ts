/**
 * Registration smoke tests for the tenant-provisioning backend module.
 *
 * Covers the design's "Testing Strategy -> Unit and integration tests"
 * registration bullet: the module registers an action whose id is exactly
 * `tenant:provision`, and that action is handed to the scaffolder actions
 * extension point when the backend starts (Req 1.1, 1.2).
 *
 * Two complementary checks are made:
 *
 * 1. A lightweight, direct check that `createTenantProvisionAction(...)`
 *    produces an action whose `id === 'tenant:provision'` (Req 1.1).
 * 2. A backend-wiring check that boots the module with `startTestBackend` and a
 *    (see the fake `scaffolderActionsExtensionPoint` implementation below)
 *    fake `scaffolderActionsExtensionPoint`, then asserts the module called
 *    `addActions` with an action carrying that id — i.e. the scaffolder makes
 *    the action available once the backend starts (Req 1.1, 1.2).
 *
 * No git/network/terragrunt/AWS operation is exercised: building the action is
 * pure, and the extension point is a capturing mock.
 */

import type { BackendFeature } from '@backstage/backend-plugin-api';
import { mockServices, startTestBackend } from '@backstage/backend-test-utils';

/**
 * Minimal shape of the internal registration objects that a `BackendFeature`
 * created by `createBackendModule` exposes via `getRegistrations()`. This
 * detail is intentionally not part of the public `BackendFeature` type, so the
 * test describes just the fields it inspects (`pluginId`/`moduleId`) and reads
 * them off the feature via this cast — no git/network/terragrunt is involved.
 */
type ModuleRegistrationsFeature = BackendFeature & {
  getRegistrations(): Array<{ pluginId: string; moduleId: string }>;
};
import { scaffolderActionsExtensionPoint } from '@backstage/plugin-scaffolder-node';

import platformModuleTenantProvisioning from './index';
import { platformModuleTenantProvisioning as namedTenantProvisioningModule } from './module';
import { createTenantProvisionAction } from './actions/tenantProvision';

describe('tenant-provisioning module registration', () => {
  it('builds an action whose id is exactly "tenant:provision" (Req 1.1)', () => {
    const action = createTenantProvisionAction({
      config: mockServices.rootConfig(),
      logger: mockServices.logger.mock(),
    });

    expect(action.id).toBe('tenant:provision');
  });

  it('registers the "tenant:provision" action with the scaffolder actions registry when the backend starts (Req 1.1, 1.2)', async () => {
    // Capturing fake for the scaffolder actions extension point: every action
    // the module registers via addActions() is recorded here.
    const addedActions: Array<{ id: string }> = [];
    const addActions = jest.fn((...actions: Array<{ id: string }>) => {
      addedActions.push(...actions);
    });

    await startTestBackend({
      extensionPoints: [[scaffolderActionsExtensionPoint, { addActions }]],
      features: [platformModuleTenantProvisioning],
    });

    // The module handed the scaffolder its action(s) on startup (Req 1.2)...
    expect(addActions).toHaveBeenCalled();
    // ...and exactly one of them is the tenant:provision action (Req 1.1).
    const ids = addedActions.map(action => action.id);
    expect(ids).toContain('tenant:provision');
  });
});

/**
 * Bug condition exploration test (Property 1: Bug Condition).
 *
 * The module depends on `scaffolderActionsExtensionPoint`, which is owned by
 * the `scaffolder` plugin. A backend module only attaches to extension points
 * of the plugin named by its `pluginId`, so the module MUST declare
 * `pluginId: 'scaffolder'` for `tenant:provision` to reach the real scaffolder
 * action registry (Req 2.1, 2.2, 2.3).
 *
 * This is a deterministic configuration defect, so the property is scoped to
 * the module's single concrete registration rather than generated inputs.
 * `getRegistrations()` is a pure, static inspection of the `BackendFeature`:
 * no git/network/terragrunt/terraform/AWS is exercised.
 *
 * On UNFIXED code this pluginId assertion is EXPECTED TO FAIL with actual value
 * `'platform'` — that failure confirms the bug (`isBugCondition` is true).
 */
describe('module pluginId association', () => {
  it('attaches to the scaffolder plugin so tenant:provision reaches the real registry (Req 2.1, 2.2, 2.3)', () => {
    const registrations = (
      namedTenantProvisioningModule as ModuleRegistrationsFeature
    ).getRegistrations();

    // Bug Condition: M.pluginId <> ownerPluginId(scaffolderActionsExtensionPoint)
    // where the owner is 'scaffolder'. Fails on unfixed code with 'platform'.
    expect(registrations[0].pluginId).toBe('scaffolder');
    // Guards against an accidental moduleId change (passes on both).
    expect(registrations[0].moduleId).toBe('tenant-provisioning');
  });
});
