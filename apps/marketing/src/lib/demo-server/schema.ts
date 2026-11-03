import type { UserCommand } from '@shinsa/core';
import { Schema } from 'effect';

export const DEMO_SOCKET_PATH = '/ws';

export const DEMO_API_PREFIX = '/api/';

export const DEMO_ENGINE_VERSION = '1.0.0';

export const DEMO_ACK_DELAY_MS = 280;

export const DEMO_CONNECTING = 0;

export const DEMO_OPEN = 1;

export const DEMO_CLOSED = 3;

export const CODE_READ_PATH = /^\/api\/tasks\/([^/]+)\/([a-z]+)$/;

export const FILE_WRITE_PATH = /^\/api\/tasks\/([^/]+)\/file$/;

export const DEMO_REFUSAL = { error: { code: 'demo', message: 'This page only shows samples.' } };

export const DEMO_REFUSAL_STATUS = 404;

export const FileWriteText = Schema.fromJsonString(
  Schema.Struct({ path: Schema.String, content: Schema.String, base: Schema.NullOr(Schema.String) })
);

export type CommandListener = (command: UserCommand) => void;
