import { InstanceId, RELAY_PATH_PREFIX } from '@shinsa/core';
import { Schema } from 'effect';

export const RELAY_ROUTE = `${RELAY_PATH_PREFIX}:instanceId/*` as const;

export const RelayParams = Schema.Struct({ instanceId: InstanceId });

export const RELAY_FORWARDED_AWAY: ReadonlySet<string> = new Set(['cookie', 'authorization']);

export const RELAY_OFFLINE_MESSAGE = 'This machine is offline. Try again later.';

export const RELAY_SOCKETS_ONLY_MESSAGE = 'The relay only takes WebSocket upgrades.';
