import { describe, expect, test } from 'bun:test';
import { PREVIEW_ORIGIN, REMOTE_APP_ORIGIN } from '@shinsa/core';
import { ConfigProvider, Effect, Exit, Redacted } from 'effect';
import { CloudConfig } from '../../src/config/service.ts';
import { TEST_ENV } from '../layers.ts';

const readConfig = (env: Record<string, string>) =>
  Effect.runPromiseExit(
    CloudConfig.use(Effect.succeed).pipe(
      Effect.provide(CloudConfig.layer),
      Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(env)))
    )
  );

describe('the Worker reads its configuration once, secrets redacted', () => {
  test('every variable is read, and a secret only opens with Redacted.value', async () => {
    const exit = await readConfig(TEST_ENV);
    if (!Exit.isSuccess(exit)) throw new Error('The configuration did not read.');
    const config = exit.value;
    expect(config.origin).toBe(TEST_ENV.APP_ORIGIN);
    expect(config.previewOrigin).toBe('https://shinsa.page');
    expect(config.maxInstances).toBe(50);
    expect(String(config.githubClientSecret)).not.toContain('client-secret');
    expect(Redacted.value(config.githubClientSecret)).toBe('client-secret');
  });

  test('a Worker with nothing set gets the defaults and empty secrets', async () => {
    const exit = await readConfig({});
    if (!Exit.isSuccess(exit)) throw new Error('The configuration did not read.');
    const config = exit.value;
    expect(config.origin).toBe(REMOTE_APP_ORIGIN);
    expect(config.previewOrigin).toBe(PREVIEW_ORIGIN);
    expect(config.tunnelZone).toBe('shinsa.dev');
    expect(config.maxInstances).toBe(50);
    expect(config.githubClientId).toBe('');
    expect(Redacted.value(config.slackSigningSecret)).toBe('');
  });

  test('a limit that is not a whole number stops the Worker instead of falling back', async () => {
    const exit = await readConfig({ MAX_INSTANCES: 'many' });
    expect(Exit.isFailure(exit)).toBe(true);
  });
});
