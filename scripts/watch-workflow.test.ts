import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

interface Workflow {
  on: { workflow_run: { workflows: string[]; types: string[]; branches: string[] } };
  permissions: Record<string, string>;
  jobs: Record<'rerun' | 'report', Job>;
}

interface Job {
  if: string;
  needs?: string;
  permissions?: Record<string, string>;
  outputs?: Record<string, string>;
  steps: { id?: string; uses?: string; env?: Record<string, string>; run?: string }[];
}

const RUN_CONDITIONS = [
  `contains(fromJSON('["failure", "timed_out", "startup_failure"]'), github.event.workflow_run.conclusion)`,
  `contains(fromJSON('["push", "workflow_dispatch", "workflow_run"]'), github.event.workflow_run.event)`,
  'github.event.workflow_run.head_repository.full_name == github.repository',
] as const;

function expression(path: string) {
  return `\${{ ${path} }}`;
}

const workflow = Bun.YAML.parse(
  readFileSync(join(import.meta.dirname, '../.github/workflows/watch.yml'), 'utf8')
) as Workflow;

describe('the watch on main', () => {
  const { rerun, report } = workflow.jobs;
  const step = report.steps[0];
  const decide = rerun.steps.find((candidate) => candidate.id === 'decide');

  it('runs only once a Test or Release run on main has finished', () => {
    expect(workflow.on.workflow_run).toEqual({
      workflows: ['Test', 'Release'],
      types: ['completed'],
      branches: ['main'],
    });
    expect(workflow.permissions).toEqual({});
  });

  it('reports only a run that failed, timed out or could not start', () => {
    expect(report.if).toContain(RUN_CONDITIONS[0]);
  });

  it('never reports a pull request run, even one from a fork whose branch is named main', () => {
    expect(report.if).toContain(RUN_CONDITIONS[1]);
    expect(report.if).toContain(RUN_CONDITIONS[2]);
  });

  it('decides on a rerun for the same runs it would report', () => {
    for (const condition of RUN_CONDITIONS) expect(rerun.if).toContain(condition);
  });

  it('reruns with the one write permission it needs, through the tested script', () => {
    expect(rerun.permissions).toEqual({ actions: 'write', contents: 'read' });
    expect(decide?.run).toBe('bun scripts/watch-rerun.ts');
    expect(decide?.env).toEqual({
      GH_TOKEN: expression('github.token'),
      GH_REPO: expression('github.repository'),
      RUN_ID: expression('github.event.workflow_run.id'),
      RUN_ATTEMPT: expression('github.event.workflow_run.run_attempt'),
      WORKFLOW_ID: expression('github.event.workflow_run.workflow_id'),
    });
    expect(rerun.outputs).toEqual({ rerun: expression('steps.decide.outputs.rerun') });
  });

  it('reports after the rerun decision, unless it reran, and even when the decision failed', () => {
    expect(report.needs).toBe('rerun');
    expect(report.if).toStartWith("always() && needs.rerun.outputs.rerun != 'true' &&");
    expect(report.permissions).toBeUndefined();
  });

  it('signs the event it sends and names each attempt of a run once', () => {
    expect(step?.env?.DELIVERY).toMatch(
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
