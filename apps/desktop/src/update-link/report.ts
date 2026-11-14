import { ENGINE_PROTOCOL } from '@shinsa/core';
import type { AppUpdateReport } from '@shinsa/core/engine-api/schema';
import type { UpdateSnapshot } from '../updates/schema.ts';
import { resolveAppUpdate } from '../updates/state.ts';

export function resolveAppUpdateReport(snapshot: UpdateSnapshot, version: string): AppUpdateReport {
  return {
    version,
    protocol: ENGINE_PROTOCOL,
    channel: snapshot.channel,
    update: resolveAppUpdate(snapshot.state),
  };
}
