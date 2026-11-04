import { describe, expect, test } from 'bun:test';
import { createHarness } from '../harness.ts';

function listScriptSources(response: Response) {
  const policy = response.headers.get('content-security-policy') ?? '';
  const directive = policy.split('; ').find((entry) => entry.startsWith('script-src ')) ?? '';
  return directive.split(' ').slice(1);
}

describe('the security headers', () => {
  test('let the page compile WebAssembly, which code highlighting runs on, and nothing else from outside', async () => {
    const harness = createHarness();
    const sources = listScriptSources(await harness.call('/tasks/LOC-1/code'));
    expect(sources).toEqual(["'self'", "'wasm-unsafe-eval'"]);
    expect(sources).not.toContain("'unsafe-eval'");
    expect(sources).not.toContain("'unsafe-inline'");
  });

  test('give a worker script the same policy, so highlighting in a worker compiles too', async () => {
    const harness = createHarness();
    const sources = listScriptSources(await harness.call('/assets/tokenize.worker.js'));
    expect(sources).toContain("'wasm-unsafe-eval'");
  });
});
