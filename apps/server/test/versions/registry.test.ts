import { describe, expect, test } from 'bun:test';
import { requestLatestVersion } from '../../src/versions/registry.ts';

describe('requestLatestVersion', () => {
  test('reads the latest dist-tag of a package from the npm registry', async () => {
    const asked: string[] = [];
    const version = await requestLatestVersion('@openai/codex', (url) => {
      asked.push(url);
      return Promise.resolve(Response.json({ name: '@openai/codex', version: '0.164.0' }));
    });
    expect(version).toBe('0.164.0');
    expect(asked).toEqual(['https://registry.npmjs.org/@openai/codex/latest']);
  });

  test('a refusal or an answer without a version is an error', async () => {
    await expect(
      requestLatestVersion('missing', () => Promise.resolve(new Response('nope', { status: 404 })))
    ).rejects.toThrow('The npm registry answered 404 for missing.');
    await expect(requestLatestVersion('odd', () => Promise.resolve(Response.json(null)))).rejects.toThrow(
      'The npm registry gave no version for odd.'
    );
  });
});
