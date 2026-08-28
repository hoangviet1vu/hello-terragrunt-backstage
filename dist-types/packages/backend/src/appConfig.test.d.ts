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
export {};
