/** Deployment environment accepted by the tenant-provision action. */
export type Environment = 'dev' | 'test' | 'uat' | 'prod';

/** Input to the pure Terragrunt HCL renderer. */
export interface RenderTerragruntHclInput {
  tenantName: string;
  environment: Environment;
  moduleSource: string;
  /** component name -> enabled; e.g. `{ dynamodb: false, ecr: true }`. */
  components: Record<string, boolean>;
}

/** Pattern every component key must match (defense in depth; Req 9.7). */
const COMPONENT_NAME_PATTERN = /^[a-z0-9_]+$/;

/** Maximum number of component entries permitted (defense in depth; Req 9.8). */
const MAX_COMPONENTS = 100;

/** Ascending lexicographic byte-order comparator for component keys. */
function byteOrder(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
}

/**
 * Renders the tenant `terragrunt.hcl` content from the given inputs.
 *
 * Pure function (no I/O). Emits an `include "root"` block, a `terraform` block
 * whose `source` is the module source, and an `inputs` block containing
 * `tenant_name`, `environment`, and one `enable_<name>` entry per component.
 *
 * The `enable_<name>` entries are produced with the same logic for every key
 * (no per-name branching), sorted by key in ascending lexicographic byte order.
 * A missing/undefined value is treated as `false`. An empty `components` map
 * yields an `inputs` block with only `tenant_name` and `environment`.
 *
 * Defense-in-depth validation runs before any output is produced: the
 * authoritative allowed-name pattern/size checks live in the ConfigReader
 * (Req 9.7/9.8) and the membership check in `expandComponents` (Req 9.6), but
 * this renderer re-checks the component keys and the module source so it can
 * never emit malformed HCL.
 *
 * @throws If any component key does not match `^[a-z0-9_]+$`.
 * @throws If the `components` map has more than 100 entries.
 * @throws If `moduleSource` contains a double quote or newline.
 */
export function renderTerragruntHcl(input: RenderTerragruntHclInput): string {
  const { tenantName, environment, moduleSource, components } = input;

  // Defense-in-depth: reject a module source that would break the quoted HCL string.
  if (moduleSource.includes('"') || /[\r\n]/.test(moduleSource)) {
    throw new Error(
      'Invalid module source: must not contain a double quote or newline',
    );
  }

  const keys = Object.keys(components);

  // Defense-in-depth: reject an oversized component map.
  if (keys.length > MAX_COMPONENTS) {
    throw new Error(
      `Component count exceeds the allowed maximum of ${MAX_COMPONENTS}`,
    );
  }

  // Defense-in-depth: reject any component key that could break the HCL.
  for (const key of keys) {
    if (!COMPONENT_NAME_PATTERN.test(key)) {
      throw new Error(
        `Invalid component name: '${key}' does not match ^[a-z0-9_]+$`,
      );
    }
  }

  // Sort component keys in ascending lexicographic byte order for determinism.
  const sortedKeys = [...keys].sort(byteOrder);

  // Build the list of inputs entries (name -> rendered value), preserving order.
  const entries: Array<{ name: string; value: string }> = [
    { name: 'tenant_name', value: `"${tenantName}"` },
    { name: 'environment', value: `"${environment}"` },
    ...sortedKeys.map(key => ({
      name: `enable_${key}`,
      value: components[key] === true ? 'true' : 'false',
    })),
  ];

  // Align the `=` signs by padding names to the widest name.
  const widest = Math.max(...entries.map(e => e.name.length));
  const inputLines = entries
    .map(e => `  ${e.name.padEnd(widest)} = ${e.value}`)
    .join('\n');

  return `include "root" {
  path = find_in_parent_folders("root.hcl")
}

terraform {
  source = "${moduleSource}"
}

inputs = {
${inputLines}
}
`;
}
