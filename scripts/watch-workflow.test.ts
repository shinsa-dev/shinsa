import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

interface Workflow {
  on: { workflow_run: { workflows: string[]; types: string[]; branches: string[] } };
  permissions: Record<string, string>;
  jobs: { report: { if: string; steps: { env: Record<string, string>; run: string }[] } };
}

const workflow = Bun.YAML.parse(
  readFileSync(join(import.meta.dirname, '../.github/workflows/watch.yml'), 'utf8')
) as Workflow;

describe('the watch on main', () => {
  const report = workflow.jobs.report;
  const step = report.steps[0];

  it('runs only once a Test or Release run on main has finished', () => {
    expect(workflow.on.workflow_run).toEqual({
      workflows: ['Test', 'Release'],
      types: ['completed'],
      branches: ['main'],
    });
    expect(workflow.permissions).toEqual({});
  });

  it('reports only a run that failed, timed out or could not start', () => {
    expect(report.if).toBe(
      `contains(fromJSON('["failure", "timed_out", "startup_failure"]'), github.event.workflow_run.conclusion)`
    );
  });

  it('signs the event it sends and names each attempt of a run once', () => {
    expect(step?.env.DELIVERY).toMatch(
      /^\$\{\{ github\.event\.workflow_run\.id \}\}-\$\{\{ github\.event\.workflow_run\.run_attempt \}\}$/
    );
    expect(step?.run).toContain('openssl dgst -sha256 -hmac "$SHINSA_WATCH_SECRET" -r "$GITHUB_EVENT_PATH"');
    expect(step?.run).toContain('-H "x-hub-signature-256: sha256=$signature"');
    expect(step?.run).toContain('-H "x-github-delivery: $DELIVERY"');
    expect(step?.run).toContain('--data-binary "@$GITHUB_EVENT_PATH"');
  });

  it('warns and passes while the secrets are not set', () => {
    expect(step?.run).toContain('if [ -z "$SHINSA_WATCH_URL" ] || [ -z "$SHINSA_WATCH_SECRET" ]; then');
    expect(step?.run).toContain('exit 0');
  });
});
