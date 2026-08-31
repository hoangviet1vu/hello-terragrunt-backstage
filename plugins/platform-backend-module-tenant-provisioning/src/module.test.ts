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

import { mockServices, startTestBackend } from '@backstage/backend-test-utils';
import { scaffolderActionsExtensionPoint } from '@backstage/plugin-scaffolder-node';

import platformModuleTenantProvisioning from './index';
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
