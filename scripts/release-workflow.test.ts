import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

interface WorkflowStep {
  name?: string;
  if?: string;
  run?: string;
  env?: Record<string, string>;
}

interface Workflow {
  jobs: { mac: { steps: WorkflowStep[] } };
}

const workflow = Bun.YAML.parse(
  readFileSync(join(import.meta.dirname, '../.github/workflows/release.yml'), 'utf8')
) as Workflow;

const steps = workflow.jobs.mac.steps;

function findStep(name: string) {
  const index = steps.findIndex((candidate) => candidate.name === name);
  const step = steps[index];
  if (!step) throw new Error(`The mac job has no step named "${name}".`);
  return { index, step };
}

describe('the release workflow', () => {
  const build = findStep('Build and sign the app');
  const notarize = findStep('Notarize and staple');
  const packaging = findStep('Package the disk image and the zip');
  const check = findStep('Check the versions and the signature');

  it('builds, notarizes, packages and checks, in that order', () => {
    expect(build.index).toBeLessThan(notarize.index);
    expect(notarize.index).toBeLessThan(packaging.index);
    expect(packaging.index).toBeLessThan(check.index);
  });

  it('leaves notarizing out of electron-builder', () => {
    for (const { step } of [build, packaging]) {
      expect(step.run).toContain('-c.mac.notarize=false');
      expect(step.run).not.toContain('-c.mac.notarize=true');
      expect(step.env?.APPLE_ID).toBeUndefined();
    }
  });

  it('builds only the app first, then packages that same app', () => {
    expect(build.step.run).toContain('electron-builder --mac dir --arm64');
    expect(packaging.step.run).toContain('electron-builder --mac dmg zip --arm64');
    expect(packaging.step.run).toContain('--prepackaged release/mac-arm64/Shinsa.app');
  });

  it('notarizes the built app with the retrying script, only when signed', () => {
    expect(notarize.step.if).toBe("steps.signing.outputs.mode == 'signed'");
    expect(notarize.step.run).toBe(
      'bun scripts/release-notarize.ts apps/desktop/release/mac-arm64/Shinsa.app'
    );
    expect(Object.keys(notarize.step.env ?? {}).sort()).toEqual([
      'APPLE_APP_SPECIFIC_PASSWORD',
      'APPLE_ID',
      'APPLE_TEAM_ID',
    ]);
  });
});
