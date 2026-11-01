import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

interface WorkflowStep {
  name?: string;
  if?: string;
  run?: string;
  env?: Record<string, string>;
}

interface WorkflowJob {
  needs?: string[];
  permissions?: Record<string, string>;
  outputs?: Record<string, string>;
  'runs-on'?: string;
  strategy?: { matrix: { include: { target: string; runner: string }[] } };
  steps: WorkflowStep[];
}

interface Workflow {
  jobs: Record<'mac' | 'linux' | 'downloads' | 'npm' | 'status', WorkflowJob>;
}

const workflow = Bun.YAML.parse(
  readFileSync(join(import.meta.dirname, '../.github/workflows/release.yml'), 'utf8')
) as Workflow;

function findStep(name: string, job: keyof Workflow['jobs'] = 'mac') {
  const steps = workflow.jobs[job].steps;
  const index = steps.findIndex((candidate) => candidate.name === name);
  const step = steps[index];
  if (!step) throw new Error(`The ${job} job has no step named "${name}".`);
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

function expression(name: string) {
  return `$${'{{'} ${name} }}`;
}

describe('the engine archives', () => {
  const signature = findStep('Check the versions and the signature');
  const macPack = findStep('Pack the engine');
  const publish = findStep('Publish the release');

  it('packs the engine from the signed app after it is checked, and publishes it with the app', () => {
    expect(signature.index).toBeLessThan(macPack.index);
    expect(macPack.index).toBeLessThan(publish.index);
    expect(macPack.step.run).toBe(
      'bun scripts/release-engine.ts bun-darwin-arm64 apps/desktop/release/mac-arm64/Shinsa.app/Contents/Resources/engine apps/desktop/release'
    );
    expect(macPack.step.env?.SHINSA_VERSION).toBe(expression('steps.version.outputs.version'));
    expect(publish.step.run).toContain('shinsa-darwin-arm64.tar.gz shinsa-darwin-arm64.tar.gz.sha256');
  });

  it('hands the version on to the Linux job', () => {
    expect(workflow.jobs.mac.outputs?.version).toBe(expression('steps.version.outputs.version'));
  });

  it('builds each Linux engine on its own CPU, after the release exists', () => {
    const linux = workflow.jobs.linux;
    expect(linux.needs).toEqual(['trigger', 'mac']);
    expect(linux['runs-on']).toBe(expression('matrix.runner'));
    expect(linux.strategy?.matrix.include).toEqual([
      { target: 'bun-linux-x64', runner: 'ubuntu-latest' },
      { target: 'bun-linux-arm64', runner: 'ubuntu-24.04-arm' },
    ]);
  });

  it('builds the web app, then the engine at the release version, packs it and adds it to the release', () => {
    const web = workflow.jobs.linux.steps.findIndex((step) => step.run === 'bun run build');
    const build = findStep('Build the engine', 'linux');
    const pack = findStep('Pack the engine', 'linux');
    const upload = findStep('Add it to the release', 'linux');
    expect(web).toBeGreaterThanOrEqual(0);
    expect(web).toBeLessThan(build.index);
    expect(build.index).toBeLessThan(pack.index);
    expect(pack.index).toBeLessThan(upload.index);
    expect(build.step.env).toEqual({
      SHINSA_VERSION: expression('needs.mac.outputs.version'),
      SHINSA_ENGINE_TARGET: expression('matrix.target'),
    });
    expect(pack.step.run).toBe(
      `bun scripts/release-engine.ts "$TARGET" "apps/engine/dist/engine-$${'{'}TARGET#bun-}" release-engine`
    );
    expect(upload.step.run).toBe(
      'gh release upload "$TAG" release-engine/*.tar.gz release-engine/*.tar.gz.sha256 --clobber'
    );
    expect(upload.step.env?.TAG).toBe(expression('needs.mac.outputs.tag'));
  });

  it('moves the downloads only once every engine is in the release, and reports the Linux job', () => {
    expect(workflow.jobs.downloads.needs).toEqual(['trigger', 'mac', 'linux']);
    expect(workflow.jobs.status.needs).toEqual(['trigger', 'mac', 'linux', 'downloads', 'npm']);
    const report = findStep('Report the release on the commit', 'status');
    expect(report.step.env?.LINUX).toBe(expression('needs.linux.result'));
    expect(report.step.run).toContain('case "$TRIGGER/$MAC/$LINUX/$DOWNLOADS/$NPM" in');
    expect(report.step.run).toContain('but the Linux engines were not added');
  });
});

describe('the npm packages', () => {
  const npm = workflow.jobs.npm;
  const npmCli = findStep('Use an npm that publishes through trusted publishing', 'npm');
  const download = findStep('Download the engines', 'npm');
  const publish = findStep('Publish to npm', 'npm');

  it('publishes once every engine is in the release', () => {
    expect(npm.needs).toEqual(['trigger', 'mac', 'linux']);
    expect(npmCli.index).toBeLessThan(publish.index);
    expect(download.index).toBeLessThan(publish.index);
  });

  it('publishes through npm trusted publishing, with no token', () => {
    expect(npm.permissions).toEqual({ contents: 'read', 'id-token': 'write' });
    expect(npmCli.step.run).toBe('npm install -g npm@^11.5.1');
    expect(JSON.stringify(npm)).not.toContain('NPM_TOKEN');
    for (const step of npm.steps) expect(step.if).toBeUndefined();
  });

  it('repacks the release’s own archives at its version and channel', () => {
    expect(download.step.run).toBe(
      `gh release download "$TAG" --pattern 'shinsa-*.tar.gz' --pattern 'shinsa-*.tar.gz.sha256' --dir release-engine`
    );
    expect(download.step.env?.TAG).toBe(expression('needs.mac.outputs.tag'));
    expect(publish.step.run).toBe('bun scripts/release-npm.ts release-engine npm-packages');
    expect(publish.step.env).toEqual({
      SHINSA_VERSION: expression('needs.mac.outputs.version'),
      RELEASE_CHANNEL: expression('needs.mac.outputs.channel'),
    });
  });

  it('reports npm apart from the downloads', () => {
    const report = findStep('Report the release on the commit', 'status');
    expect(report.step.env?.NPM).toBe(expression('needs.npm.result'));
    expect(report.step.run).toContain('but npm was not updated');
    expect(report.step.run).toContain('but neither the downloads nor npm were updated');
  });
});
