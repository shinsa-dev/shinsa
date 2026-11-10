import { Option, Schema } from 'effect';
import {
  BROWSER_CDP_PATH,
  CDP_SERVER_ERROR,
  CdpCommand,
  REFUSED_METHOD_MESSAGE,
  REFUSED_METHODS,
} from './schema.ts';

const LOOPBACK_ADDRESSES: ReadonlySet<string> = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

const decodeCommand = Schema.decodeUnknownOption(CdpCommand);

export function resolveBrowserEndpoint(serverUrl: string, key: string) {
  return `${serverUrl.replace(/^http/, 'ws').replace(/\/+$/, '')}${BROWSER_CDP_PATH}${key}`;
}

export function readBrowserKey(pathname: string) {
  if (!pathname.startsWith(BROWSER_CDP_PATH)) return null;
  return pathname.slice(BROWSER_CDP_PATH.length);
}

export function isLoopbackAddress(address: string | null | undefined) {
  return address !== null && address !== undefined && LOOPBACK_ADDRESSES.has(address);
}

export function resolveRefusedReply(text: string) {
  if (!text.includes('"Browser.')) return null;
  const command = Option.getOrNull(decodeCommand(text));
  if (!command || !REFUSED_METHODS.has(command.method)) return null;
  return JSON.stringify({
    id: command.id,
    ...(command.sessionId === undefined ? {} : { sessionId: command.sessionId }),
    error: { code: CDP_SERVER_ERROR, message: REFUSED_METHOD_MESSAGE },
  });
}
