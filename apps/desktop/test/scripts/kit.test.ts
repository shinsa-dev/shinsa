import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BunServices } from '@effect/platform-bun';
import { Effect, type Layer } from 'effect';
import { readMarkPaths } from '../../scripts/kit/marks.ts';
import { inlinePageScript } from '../../scripts/kit/page.ts';
import { runScriptCommand } from '../../scripts/kit/run.ts';

const folders: string[] = [];

afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

function runScript<A, E>(effect: Effect.Effect<A, E, Layer.Success<typeof BunServices.layer>>) {
  return Effect.runPromise(effect.pipe(Effect.provide(BunServices.layer)));
}

function writeLogo(source: string) {
  const folder = mkdtempSync(join(tmpdir(), 'desktop-kit-'));
  folders.push(folder);
  const path = join(folder, 'logo.tsx');
  writeFileSync(path, source);
  return path;
}

describe('runScriptCommand', () => {
  it('runs a command in its folder with the variables it is given', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'desktop-kit-'));
    folders.push(folder);
    await runScript(
      runScriptCommand(
        ['sh', '-c', 'test "$MARK" = set && test "$(pwd -P)" = "$(cd "$1" && pwd -P)"', 'sh', folder],
        {
          cwd: folder,
          env: { MARK: 'set' },
        }
      )
    );
  });

  it('fails with the command and what it wrote to stderr when it exits non-zero', async () => {
    const error = await runScript(Effect.flip(runScriptCommand(['sh', '-c', 'echo broken >&2; exit 3'])));
    expect(error._tag).toBe('ScriptStepFailed');
    expect(error.message).toBe('sh -c echo broken >&2; exit 3 failed: broken\n');
  });

  it('fails naming the command when it cannot be started', async () => {
    const error = await runScript(Effect.flip(runScriptCommand(['shinsa-no-such-tool'])));
    expect(error.message).toStartWith('shinsa-no-such-tool failed: ');
  });
});

describe('readMarkPaths', () => {
  it('reads every path of the logo, in order', async () => {
    const logo = writeLogo("<svg><path d='M0 0h1'/><path d='M2 2h3'/></svg>");
    expect(await runScript(readMarkPaths(logo))).toEqual(['M0 0h1', 'M2 2h3']);
  });

  it('fails when the logo has no paths', async () => {
    const logo = writeLogo('<svg></svg>');
    const error = await runScript(Effect.flip(readMarkPaths(logo)));
    expect(error.message).toBe(`No mark paths found in ${logo}.`);
  });
});

describe('inlinePageScript', () => {
  it('puts the font, the mark and the script into the page, so its CSP needs no file of its own', () => {
    const page = inlinePageScript('<style>/* font */</style><svg><!-- marks --></svg><!-- script -->', {
      script: 'a("$&</script>")',
      marks: ['M0 0', 'M1 1'],
      font: 'AAEC',
    });
    expect(page).toBe(
      "<style>src: url(data:font/woff2;base64,AAEC) format('woff2');</style>" +
        '<svg><path class="piece" style="--piece: 0" d="M0 0" /><path class="piece" style="--piece: 1" d="M1 1" /></svg>' +
        '<script>a("$&<\\/script>")</script>'
    );
  });
});
