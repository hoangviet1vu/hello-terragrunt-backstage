import {
  coreServices,
  createBackendModule,
} from '@backstage/backend-plugin-api';

export const platformModuleTenantProvisioning = createBackendModule({
  pluginId: 'platform',
  moduleId: 'tenant-provisioning',
  register(reg) {
    reg.registerInit({
      deps: { logger: coreServices.logger },
      async init({ logger }) {
        logger.info('Hello World!');
      },
    });
  },
});
