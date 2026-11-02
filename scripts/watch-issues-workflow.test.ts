import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

interface Workflow {
  on: { issues: { types: string[] } };
  permissions: Record<string, string>;
  jobs: { report: { if: string; steps: { env: Record<string, string>; run: string }[] } };
}

const source = readFileSync(join(import.meta.dirname, '../.github/workflows/watch-issues.yml'), 'utf8');
const workflow = Bun.YAML.parse(source) as Workflow;

describe('the watch on new issues', () => {
  const report = workflow.jobs.report;
  const step = report.steps[0];

  it('runs only when an issue is opened, with no permissions', () => {
    expect(workflow.on).toEqual({ issues: { types: ['opened'] } });
    expect(workflow.permissions).toEqual({});
  });

  it('reports only an issue of this repository', () => {
    expect(report.if).toBe('github.event.repository.full_name == github.repository');
  });

  it('reads the issue only from the event file, never through an expression in the script', () => {
    expect(step?.run).not.toContain('${{');
    expect(source).not.toMatch(/github\.event\.issue\.(title|body)/);
  });

  it('signs the event it sends and names each issue once', () => {
    expect(Object.keys(step?.env ?? {})).toEqual(['SHINSA_ISSUES_URL', 'SHINSA_WATCH_SECRET', 'DELIVERY']);
    expect(step?.env.SHINSA_ISSUES_URL).toMatch(/^\$\{\{ secrets\.SHINSA_ISSUES_URL \}\}$/);
    expect(step?.env.SHINSA_WATCH_SECRET).toMatch(/^\$\{\{ secrets\.SHINSA_WATCH_SECRET \}\}$/);
    expect(step?.env.DELIVERY).toMatch(/^issue-\$\{\{ github\.event\.issue\.number \}\}$/);
    expect(step?.run).toContain('openssl dgst -sha256 -hmac "$SHINSA_WATCH_SECRET" -r "$GITHUB_EVENT_PATH"');
    expect(step?.run).toContain("-H 'content-type: application/json'");
    expect(step?.run).toContain("-H 'x-github-event: issues'");
    expect(step?.run).toContain('-H "x-github-delivery: $DELIVERY"');
    expect(step?.run).toContain('-H "x-hub-signature-256: sha256=$signature"');
    expect(step?.run).toContain('--data-binary "@$GITHUB_EVENT_PATH"');
    expect(step?.run).toContain('curl --fail-with-body --silent --show-error --retry 3 --retry-all-errors');
    expect(step?.run).toContain('"$SHINSA_ISSUES_URL"');
  });

  it('warns and passes while the secrets are not set', () => {
    expect(step?.run).toContain('if [ -z "$SHINSA_ISSUES_URL" ] || [ -z "$SHINSA_WATCH_SECRET" ]; then');
    expect(step?.run).toContain('exit 0');
  });
});
