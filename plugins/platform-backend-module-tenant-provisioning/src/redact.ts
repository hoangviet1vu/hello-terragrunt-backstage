/**
 * Fixed, non-reversible placeholder substituted for every secret occurrence.
 * It carries no information about the original secret (no length, no hash),
 * so redaction cannot be reversed from the output (Req 7.3).
 */
export const REDACTION_PLACEHOLDER = '[REDACTED]';

/**
 * Replaces every occurrence of each secret value in `message` with a fixed,
 * non-reversible placeholder, leaving all non-secret substrings unchanged.
 *
 * Pure function: it reads only its arguments and returns a new string without
 * mutating either input or any external state.
 *
 * Behavior:
 * - Every occurrence of every non-empty secret is replaced with
 *   {@link REDACTION_PLACEHOLDER}. All other characters are preserved exactly.
 * - Secrets are matched as literal strings (not regular expressions), so a
 *   secret containing characters such as `.`, `*`, `(`, or `\` is matched
 *   verbatim rather than interpreted as a pattern.
 * - Empty-string secrets are ignored, since every position of `message`
 *   trivially "contains" the empty string and replacing it would corrupt the
 *   non-secret content.
 * - Longer secrets are applied before shorter ones so that when one secret is a
 *   substring of another, the longer (more specific) value is fully redacted
 *   rather than partially exposed.
 *
 * @param message - The text to redact.
 * @param secrets - The secret values whose occurrences must be removed.
 * @returns A copy of `message` with every secret occurrence replaced.
 */
export function redact(message: string, secrets: string[]): string {
  // Ignore empty secrets and de-duplicate. Sort by descending length so that a
  // secret that is a substring of another is not left partially exposed.
  const effectiveSecrets = Array.from(new Set(secrets))
    .filter(secret => secret.length > 0)
    .sort((a, b) => b.length - a.length);

  let result = message;
  for (const secret of effectiveSecrets) {
    result = result.split(secret).join(REDACTION_PLACEHOLDER);
  }
  return result;
}
