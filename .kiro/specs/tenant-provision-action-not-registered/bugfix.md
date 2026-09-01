# Bugfix Requirements Document

## Introduction

Running the tenant-provisioning software template fails at runtime during the "Provision tenant Terragrunt config" step with:

```
NotFoundError: Template action with ID 'tenant:provision' is not registered.
```

(thrown from `DefaultTemplateActionRegistry.get` in `@backstage/plugin-scaffolder-backend`).

The backend module that supplies the `tenant:provision` action is wired into the backend (`packages/backend/src/index.ts` calls `backend.add(import('@internal/backstage-plugin-platform-backend-module-tenant-provisioning'))`, and it is a declared workspace dependency). The module loads without error at startup, so the failure only surfaces when a tenant actually runs the template step. This makes the tenant-provisioning template unusable and blocks the core self-service provisioning flow the app exists to provide.

The root cause is a plugin-id mismatch. The module is created with `createBackendModule({ pluginId: 'platform', moduleId: 'tenant-provisioning', ... })`, but its `registerInit` depends on `scaffolderActionsExtensionPoint` (from `@backstage/plugin-scaffolder-node`), which is provided by the `scaffolder` plugin. A backend module only attaches to extension points of the plugin named by its `pluginId`. Because no `platform` plugin provides the scaffolder actions extension point, the module's `addActions()` call never reaches the scaffolder's real action registry, and `tenant:provision` is never registered.

The existing registration smoke test (`src/module.test.ts`) did not catch this because it boots `startTestBackend` with a hand-provided fake `scaffolderActionsExtensionPoint` supplied directly via `extensionPoints`. The test harness attaches that fake regardless of the module's `pluginId`, so the plugin-id association is never exercised.

## Bug Analysis

### Current Behavior (Defect)

What currently happens as a result of the module declaring the wrong `pluginId`.

1.1 WHEN the backend starts with the tenant-provisioning module registered THEN the system loads the module without error but never registers the `tenant:provision` action in the scaffolder's real action registry.

1.2 WHEN a tenant runs the tenant-provisioning template and it reaches the "Provision tenant Terragrunt config" step THEN the system throws `NotFoundError: Template action with ID 'tenant:provision' is not registered.` from `DefaultTemplateActionRegistry.get` and the template run fails.

1.3 WHEN the registration smoke test in `src/module.test.ts` runs against a hand-provided fake `scaffolderActionsExtensionPoint` THEN the test passes even though the module's `pluginId` does not match the plugin that owns the scaffolder actions extension point, so the defect is not detected.

### Expected Behavior (Correct)

What should happen instead.

2.1 WHEN the backend starts with the tenant-provisioning module registered THEN the system SHALL register the `tenant:provision` action in the scaffolder's real action registry.

2.2 WHEN a tenant runs the tenant-provisioning template and it reaches the "Provision tenant Terragrunt config" step THEN the system SHALL resolve the `tenant:provision` action and execute the step without a `NotFoundError`.

2.3 WHEN the registration test runs THEN the system SHALL fail if the module is configured with a `pluginId` that does not attach it to the scaffolder actions extension point, so that a wrong `pluginId` is caught before runtime.

### Unchanged Behavior (Regression Prevention)

Existing behavior that must be preserved.

3.1 WHEN the tenant-provisioning module is registered THEN the system SHALL CONTINUE TO expose the action under the exact id `tenant:provision` (the id used by the template step SHALL NOT change).

3.2 WHEN `createTenantProvisionAction({ config, logger })` is called THEN the system SHALL CONTINUE TO build the action using the same `config` and `logger` dependencies without altering its behavior.

3.3 WHEN the backend starts THEN the system SHALL CONTINUE TO register all other stock and custom plugins/modules in `packages/backend/src/index.ts` exactly as before, with no change to their wiring.

3.4 WHEN other scaffolder actions and templates run THEN the system SHALL CONTINUE TO resolve and execute them unchanged.

## Bug Condition Definition

The following pseudocode captures the bug condition and the properties to validate. The "input" here is the module's backend registration configuration.

**Bug Condition Function** — identifies the configuration that triggers the bug:

```pascal
FUNCTION isBugCondition(M)
  INPUT: M, the backend module registration for tenant-provisioning
  OUTPUT: boolean

  // The module depends on scaffolderActionsExtensionPoint, which is owned by
  // the 'scaffolder' plugin. The bug is triggered when the module's pluginId
  // is NOT the plugin that provides that extension point.
  RETURN M.dependsOn(scaffolderActionsExtensionPoint)
         AND M.pluginId <> ownerPluginId(scaffolderActionsExtensionPoint)
END FUNCTION
```

For this codebase `ownerPluginId(scaffolderActionsExtensionPoint) = 'scaffolder'`, and the current module has `pluginId = 'platform'`, so `isBugCondition` is currently true.

**Property Specification — Fix Checking** (correct behavior for the buggy configuration):

```pascal
// Property: Fix Checking - tenant:provision reaches the real registry
FOR ALL M WHERE isBugCondition(M) DO
  // After the fix, this configuration must not exist; the module must attach
  // to the scaffolder plugin and its action must reach the real registry.
  backend ← startBackend(M')
  ASSERT realScaffolderRegistry(backend).has('tenant:provision')
  ASSERT NOT throws(runTemplateStep('tenant:provision'))
END FOR
```

**Property Specification — Preservation Checking** (unchanged behavior for non-buggy configuration):

```pascal
// Property: Preservation Checking
FOR ALL M WHERE NOT isBugCondition(M) DO
  ASSERT F(M) = F'(M)
  // e.g. action id remains 'tenant:provision', createTenantProvisionAction
  // behaves identically, and all other backend registrations are unchanged.
END FOR
```

Where **F** is the module/backend as it exists before the fix and **F'** is the fixed version.
