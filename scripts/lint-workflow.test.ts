import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

interface Workflow {
  jobs: {
    lint: {
      steps: {
        name?: string;
        uses?: string;
        with?: Record<string, unknown>;
        env?: Record<string, string>;
        run?: string;
      }[];
    };
  };
}

const workflow = Bun.YAML.parse(
  readFileSync(join(import.meta.dirname, '../.github/workflows/lint.yml'), 'utf8')
) as Workflow;

describe('the lint workflow', () => {
  const steps = workflow.jobs.lint.steps;

  it('checks the changelog against the pull request’s base, with its history fetched', () => {
    const checkout = steps.find((step) => step.uses === 'actions/checkout@v4');
    const changelog = steps.find((step) => step.name === 'Changelog');
    expect(checkout?.with?.['fetch-depth']).toBe(0);
    expect(changelog?.env?.BASE_REF).toBe(`\${{ github.base_ref }}`);
    expect(changelog?.run).toContain('bun scripts/changelog.ts check --base "origin/$BASE_REF"');
    expect(changelog?.run).toContain('bun scripts/changelog.ts check\n');
  });
});
