import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * README content checks for the GitHub authentication environment variables.
 *
 * Validates: Requirements 5.1, 5.2, 5.3, 5.4
 *
 * The repo-root README.md documents GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET in its
 * "Environment variables" section (a Markdown table plus surrounding notes). These tests
 * assert the documented rows, purpose text, OAuth App statement, and do-not-commit coverage
 * are present, so the docs cannot silently regress.
 */

const README_PATH = resolve(__dirname, '..', '..', '..', 'README.md');

// A pipe-delimited Markdown table row, split into trimmed cell values (outer empties dropped).
function parseTableRow(line: string): string[] {
  return line
    .split('|')
    .map(cell => cell.trim())
    .filter((cell, idx, arr) => !(cell === '' && (idx === 0 || idx === arr.length - 1)));
}

// Find the row whose Variable (first) column is exactly `code` (wrapped in backticks).
function findVariableRow(lines: string[], variable: string): string[] | undefined {
  for (const line of lines) {
    if (!line.includes('|')) continue;
    const cells = parseTableRow(line);
    if (cells.length > 0 && cells[0] === `\`${variable}\``) {
      return cells;
    }
  }
  return undefined;
}

describe('README GitHub authentication environment variable docs', () => {
  const readme = readFileSync(README_PATH, 'utf8');
  const lines = readme.split(/\r?\n/);

  it('has an Environment variables section', () => {
    expect(readme).toMatch(/^#+\s+Environment variables\s*$/m);
  });

  // Requirement 5.1: GITHUB_CLIENT_ID row, all three columns populated, purpose = identifies the OAuth App.
  describe('GITHUB_CLIENT_ID row (Requirement 5.1)', () => {
    const row = findVariableRow(lines, 'GITHUB_CLIENT_ID');

    it('exists as a table row', () => {
      expect(row).toBeDefined();
    });

    it('has all three columns (Variable, Purpose, Used in) populated', () => {
      expect(row).toBeDefined();
      expect(row!.length).toBe(3);
      for (const cell of row!) {
        expect(cell.length).toBeGreaterThan(0);
      }
    });

    it('states the purpose is to identify the GitHub OAuth App used for GitHub sign-in', () => {
      expect(row).toBeDefined();
      const purpose = row![1].toLowerCase();
      expect(purpose).toContain('identif');
      expect(purpose).toContain('github oauth app');
      expect(purpose).toContain('github sign-in');
    });

    it('lists both app-config files in the Used in column', () => {
      expect(row).toBeDefined();
      const usedIn = row![2];
      expect(usedIn).toContain('app-config.yaml');
      expect(usedIn).toContain('app-config.production.yaml');
    });
  });

  // Requirement 5.2: GITHUB_CLIENT_SECRET row, all three columns populated, purpose = authenticates the OAuth App.
  describe('GITHUB_CLIENT_SECRET row (Requirement 5.2)', () => {
    const row = findVariableRow(lines, 'GITHUB_CLIENT_SECRET');

    it('exists as a table row', () => {
      expect(row).toBeDefined();
    });

    it('has all three columns (Variable, Purpose, Used in) populated', () => {
      expect(row).toBeDefined();
      expect(row!.length).toBe(3);
      for (const cell of row!) {
        expect(cell.length).toBeGreaterThan(0);
      }
    });

    it('states the purpose is to authenticate the GitHub OAuth App used for GitHub sign-in', () => {
      expect(row).toBeDefined();
      const purpose = row![1].toLowerCase();
      expect(purpose).toContain('authenticat');
      expect(purpose).toContain('github oauth app');
      expect(purpose).toContain('github sign-in');
    });

    it('lists both app-config files in the Used in column', () => {
      expect(row).toBeDefined();
      const usedIn = row![2];
      expect(usedIn).toContain('app-config.yaml');
      expect(usedIn).toContain('app-config.production.yaml');
    });
  });

  // Requirement 5.3: the section states both values come from a GitHub OAuth App.
  it('states both variables are obtained from a GitHub OAuth App (Requirement 5.3)', () => {
    const normalized = readme.replace(/\r?\n/g, ' ');
    // A single statement mentioning both variables and the GitHub OAuth App source.
    const oauthAppStatement = new RegExp(
      'GITHUB_CLIENT_ID`?[^.]*?`?GITHUB_CLIENT_SECRET`?[^.]*?GitHub OAuth App',
      'i',
    );
    expect(normalized).toMatch(oauthAppStatement);
  });

  // Requirement 5.4: the do-not-commit note explicitly covers GITHUB_CLIENT_SECRET.
  it('has a do-not-commit note that covers GITHUB_CLIENT_SECRET (Requirement 5.4)', () => {
    const normalized = readme.replace(/\r?\n/g, ' ');
    const doNotCommitNote = normalized
      .split('. ')
      .find(
        sentence =>
          /never commit|not\s+commit|don'?t\s+commit|do not commit/i.test(sentence),
      );
    expect(doNotCommitNote).toBeDefined();
    expect(doNotCommitNote).toContain('GITHUB_CLIENT_SECRET');
  });
});
