import { DomainError } from '@shinsa/core';
import { type EngineService, runServiceOrThrow, type ServiceRunner } from '../instance/index.ts';
import { resolveEngineTarget } from './app.ts';

export interface LaunchdOptions {
  uid: number;
  launchctl: ServiceRunner;
  ownsJob: (printed: string) => boolean;
}

export function createLaunchdService({ uid, launchctl, ownsJob }: LaunchdOptions): EngineService {
  const target = resolveEngineTarget(uid);
  const run = (args: string[]) => runServiceOrThrow('launchctl', launchctl, args);

  const assertInstalled = async () => {
    const printed = await launchctl(['print', target]);
    if (!printed.ok) {
      throw new DomainError(
        'engine_not_installed',
        'The engine is not set up yet. Open the Shinsa app once and it sets it up.'
      );
    }
    if (!ownsJob(printed.output)) {
      throw new DomainError(
        'engine_not_this_app',
        'This shinsa is not the one inside the Shinsa app that runs your engine, so it leaves that engine alone. Use `shinsa` from your PATH, which the app keeps pointing at itself.'
      );
    }
  };

  return {
    manager: 'launchd',
    revivesKilled: true,
    prepare: async () => {
      await assertInstalled();
      return null;
    },
    assertInstalled,
    start: () => run(['kickstart', target]),
    stop: () => run(['kill', 'SIGTERM', target]),
    kill: () => run(['kill', 'SIGKILL', target]),
    restart: () => run(['kickstart', '-k', target]),
    kick: async () => {
      const printed = await launchctl(['print', target]);
      if (!printed.ok || !ownsJob(printed.output)) return false;
      return (await launchctl(['kickstart', target])).ok;
    },
  };
}
