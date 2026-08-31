import {
  coreServices,
  createBackendModule,
} from '@backstage/backend-plugin-api';
import { scaffolderActionsExtensionPoint } from '@backstage/plugin-scaffolder-node';

import { createTenantProvisionAction } from './actions/tenantProvision';

export const platformModuleTenantProvisioning = createBackendModule({
  pluginId: 'scaffolder',
  moduleId: 'tenant-provisioning',
  register(reg) {
    reg.registerInit({
      deps: {
        scaffolder: scaffolderActionsExtensionPoint,
        config: coreServices.rootConfig,
        logger: coreServices.logger,
      },
      async init({ scaffolder, config, logger }) {
        scaffolder.addActions(createTenantProvisionAction({ config, logger }));
      },
    });
  },
});
