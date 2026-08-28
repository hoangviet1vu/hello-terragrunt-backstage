/**
 * Config-shape and no-literal-credential tests for the GitHub authentication
 * feature.
 *
 * These verify the declarative `app-config` parts of the feature (Requirement
 * 2): that the `github` provider blocks exist under the correct environment
 * keys with exact `${...}` credential references, that the guest provider is
 * retained, and that no literal GitHub credential value ever appears in any
 * `app-config*` file.
 *
 * See the github-authentication design (Testing Strategy → Unit / example
 * tests) for how this maps onto Requirements 2.1–2.6.
 */

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

/** Repository root, resolved relative to this test file (packages/backend/src). */
const repoRoot = path.resolve(__dirname, '..', '..', '..');

const devConfigPath = path.join(repoRoot, 'app-config.yaml');
const prodConfigPath = path.join(repoRoot, 'app-config.production.yaml');

/** Read and parse a YAML file at an absolute path into a plain object. */
function loadYaml(filePath: string): any {
  const raw = fs.readFileSync(filePath, 'utf8');
  return yaml.load(raw) as any;
}

/**
 * Find every `app-config*.yaml` / `app-config*.yml` file at the repository
 * root. This covers `app-config.yaml`, `app-config.production.yaml`, and any
 * additional local/env overrides that may be added later.
 */
function findAppConfigFiles(): string[] {
  return fs
    .readdirSync(repoRoot)
    .filter(name => /^app-config.*\.ya?ml$/.test(name))
    .map(name => path.join(repoRoot, name));
}

describe('app-config GitHub provider shape', () => {
  describe('app-config.yaml (development)', () => {
    const config = loadYaml(devConfigPath);

    it('sets auth.environment to development', () => {
      expect(config.auth.environment).toBe('development');
    });

    it('defines the github provider under the development environment key', () => {
      // Requirement 2.1: github block under auth.providers with credentials
      // nested under a `development` environment key.
      expect(config.auth.providers.github).toBeDefined();
      expect(config.auth.providers.github.development).toBeDefined();
    });

    it('uses exact ${GITHUB_CLIENT_ID}/${GITHUB_CLIENT_SECRET} references', () => {
      // Requirements 2.2, 2.3
      const dev = config.auth.providers.github.development;
      expect(dev.clientId).toBe('${GITHUB_CLIENT_ID}');
      expect(dev.clientSecret).toBe('${GITHUB_CLIENT_SECRET}');
    });

    it('retains the guest provider block', () => {
      // Requirement 2.5
      expect(config.auth.providers.guest).toBeDefined();
    });
  });

  describe('app-config.production.yaml (production)', () => {
    const config = loadYaml(prodConfigPath);

    it('sets auth.environment to production', () => {
      expect(config.auth.environment).toBe('production');
    });

    it('defines the github provider under the production environment key', () => {
      // Requirement 2.6
      expect(config.auth.providers.github).toBeDefined();
      expect(config.auth.providers.github.production).toBeDefined();
    });

    it('uses exact ${GITHUB_CLIENT_ID}/${GITHUB_CLIENT_SECRET} references', () => {
      // Requirement 2.6
      const prod = config.auth.providers.github.production;
      expect(prod.clientId).toBe('${GITHUB_CLIENT_ID}');
      expect(prod.clientSecret).toBe('${GITHUB_CLIENT_SECRET}');
    });

    it('retains the guest provider block', () => {
      // Requirement 2.5 (retained across environments)
      expect(config.auth.providers.guest).toBeDefined();
    });
  });
});

describe('app-config no-literal-credential scan', () => {
  // Requirement 2.4: only ${GITHUB_CLIENT_ID}/${GITHUB_CLIENT_SECRET}
  // references may appear for the github credential fields; no literal values.

  const appConfigFiles = findAppConfigFiles();

  it('finds at least the base and production app-config files', () => {
    const names = appConfigFiles.map(f => path.basename(f));
    expect(names).toEqual(
      expect.arrayContaining(['app-config.yaml', 'app-config.production.yaml']),
    );
  });

  it.each(appConfigFiles.map(f => [path.basename(f), f]))(
    '%s uses only ${...} references for github clientId/clientSecret',
    (_name, filePath) => {
      const config = loadYaml(filePath);
      const github = config?.auth?.providers?.github;

      // Not every app-config file must define a github block; only assert on
      // the ones that do.
      if (!github) {
        return;
      }

      const credentialValues: string[] = [];
      // github block is keyed by environment (development/production/...).
      for (const envBlock of Object.values<any>(github)) {
        if (envBlock && typeof envBlock === 'object') {
          if ('clientId' in envBlock) {
            credentialValues.push(envBlock.clientId);
          }
          if ('clientSecret' in envBlock) {
            credentialValues.push(envBlock.clientSecret);
          }
        }
      }

      // There must be at least one credential field to check.
      expect(credentialValues.length).toBeGreaterThan(0);

      for (const value of credentialValues) {
        // Must be exactly a single ${ENV_VAR} reference and nothing else.
        expect(value).toMatch(/^\$\{[A-Z0-9_]+\}$/);
        // And specifically one of the two expected GitHub credential vars.
        expect(['${GITHUB_CLIENT_ID}', '${GITHUB_CLIENT_SECRET}']).toContain(
          value,
        );
      }
    },
  );

  it.each(appConfigFiles.map(f => [path.basename(f), f]))(
    '%s contains no literal GitHub client id/secret patterns',
    (_name, filePath) => {
      const raw = fs.readFileSync(filePath, 'utf8');

      // Scan the raw text for clientId/clientSecret assignments and ensure any
      // value is a ${...} reference rather than a literal credential.
      const credentialLineRegex =
        /\b(clientId|clientSecret)\s*:\s*(?!\$\{[A-Z0-9_]+\}\s*$)(\S.*)$/gm;

      const offenders: string[] = [];
      let match: RegExpExecArray | null;
      // eslint-disable-next-line no-cond-assign
      while ((match = credentialLineRegex.exec(raw)) !== null) {
        offenders.push(match[0].trim());
      }

      expect(offenders).toEqual([]);
    },
  );
});
