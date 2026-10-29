import { describe, expect, test } from 'bun:test';
import { APP_IDENTITY, resolveEngineLabel } from '../../src/protocol/identity.ts';

describe('the app identity', () => {
  test('is Shinsa on every channel, so a canary or a beta updates the same app', () => {
    expect(APP_IDENTITY).toEqual({
      appId: 'studio.overclock.shinsa',
      appName: 'Shinsa',
      scheme: 'shinsa',
      port: 7446,
      configDir: 'shinsa',
      command: 'shinsa',
    });
  });

  test("names an app's engine job after its bundle id", () => {
    expect(resolveEngineLabel(APP_IDENTITY.appId)).toBe('studio.overclock.shinsa.engine');
  });
});
