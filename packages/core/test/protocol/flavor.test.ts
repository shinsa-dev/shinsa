import { describe, expect, test } from 'bun:test';
import {
  APP_FLAVORS,
  parseAppFlavor,
  resolveAppFlavor,
  resolveEngineLabel,
} from '../../src/protocol/flavor.ts';

describe('the app flavors', () => {
  test('Shinsa Canary has an identity of its own wherever two installs could meet', () => {
    const { stable, canary } = APP_FLAVORS;
    for (const key of ['appId', 'appName', 'scheme', 'port', 'configDir', 'command'] as const) {
      expect(canary[key]).not.toBe(stable[key]);
    }
    expect(canary).toMatchObject({
      appId: 'studio.overclock.shinsa.canary',
      appName: 'Shinsa Canary',
      scheme: 'shinsa-canary',
      port: 7447,
      configDir: 'shinsa-canary',
      command: 'shinsa-canary',
    });
    expect(stable).toMatchObject({ appId: 'studio.overclock.shinsa', scheme: 'shinsa', port: 7446 });
  });

  test('reads a flavor and falls back to stable for anything else', () => {
    expect(parseAppFlavor('canary')).toBe('canary');
    expect(parseAppFlavor('stable')).toBe('stable');
    expect(parseAppFlavor('beta')).toBeNull();
    expect(parseAppFlavor(undefined)).toBeNull();
    expect(resolveAppFlavor('canary')).toBe(APP_FLAVORS.canary);
    expect(resolveAppFlavor('')).toBe(APP_FLAVORS.stable);
    expect(resolveAppFlavor(undefined)).toBe(APP_FLAVORS.stable);
  });

  test("names an app's engine job after its bundle id", () => {
    expect(resolveEngineLabel(APP_FLAVORS.canary.appId)).toBe('studio.overclock.shinsa.canary.engine');
  });
});
