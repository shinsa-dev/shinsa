import { APP_IDENTITY } from '@shinsa/core';
import { Option, Predicate, Schema } from 'effect';
import {
  BUSY_PORT,
  ENGINE_ACTION_LABEL,
  ENGINE_ACTION_LINK,
  EngineAction,
  EngineLogEntry,
  type EngineScreen,
  type EngineScreenView,
  LOG_TAIL_LINES,
} from './schema.ts';

const decodeLogEntry = Schema.decodeUnknownOption(EngineLogEntry);

const decodeEngineAction = Schema.decodeUnknownOption(EngineAction);

function describeLogLine(line: string) {
  if (!line.startsWith('{')) return line;
  return decodeLogEntry(line).pipe(
    Option.match({
      onNone: () => line,
      onSome: (entry) => {
        if (entry.level !== 'warn' && entry.level !== 'error') return null;
        const message = Predicate.isString(entry.message) ? entry.message : '';
        return Predicate.isString(entry.error) ? `${message}: ${entry.error}` : message;
      },
    })
  );
}

export function resolveLogTail(text: string, lines = LOG_TAIL_LINES) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map(describeLogLine)
    .filter((line, index, all): line is string => Boolean(line) && line !== all[index - 1])
    .slice(-lines)
    .join('\n');
}

export function selectBusyPort(log: string) {
  const match = BUSY_PORT.exec(log);
  return match?.[1] ? Number(match[1]) : null;
}

export function parseEngineAction(url: string): EngineAction | null {
  return Option.getOrNull(decodeEngineAction(ENGINE_ACTION_LINK.exec(url)?.[1]));
}

export function describeEngineScreen(screen: EngineScreen): EngineScreenView {
  const name = APP_IDENTITY.appName;
  switch (screen.kind) {
    case 'starting':
      return {
        title: `Starting ${name}`,
        text: `${name}’s engine is starting. It keeps running in the background, also when this window is closed.`,
        actions: [],
        detail: '',
        busy: true,
      };
    case 'dev':
      return {
        title: `Waiting for ${name}`,
        text: `Start the dev servers with “bun dev” in the checkout. The window opens ${name} as soon as they answer.`,
        actions: [],
        detail: '',
        busy: true,
      };
    case 'approval':
      return {
        title: `Allow ${name} to run in the background`,
        text: `${name}’s engine runs your agents and schedules while the app is closed. Turn ${name} on in System Settings → General → Login Items & Extensions, then come back.`,
        actions: ['open-login-items', 'retry'],
        detail: '',
        busy: false,
      };
    case 'crashing':
      return {
        title: `${name}’s engine keeps stopping`,
        text: 'It stopped several times in a row. Start it again, and if it stops again, copy the details below into a bug report.',
        actions: ['restart', 'copy-details'],
        detail: screen.detail,
        busy: false,
      };
    case 'port':
      return {
        title: `Port ${screen.port} is taken`,
        text: `Another program listens on port ${screen.port}, where ${name}’s engine runs. Quit that program and start the engine again, or set another "port" in ${name}’s config.json.`,
        actions: ['restart', 'copy-details'],
        detail: screen.detail,
        busy: false,
      };
    case 'stopped':
      return {
        title: `${name}’s engine is not running`,
        text: `The engine did not start. Start it again; if a folder ${name} works in is in Desktop, Documents or Downloads, give ${name} Full Disk Access first.`,
        actions: ['restart', 'open-privacy', 'copy-details'],
        detail: screen.detail,
        busy: false,
      };
    case 'cloud':
      return {
        title: 'Shinsa Cloud is not answering',
        text: `This window shows a machine through ${screen.host}, which did not answer. It opens again by itself once it answers, or use this Mac’s own engine instead.`,
        actions: ['retry', 'use-local'],
        detail: '',
        busy: false,
      };
  }
}

export function resolveWaitingQuery(view: EngineScreenView): Record<string, string> {
  return {
    title: view.title,
    text: view.text,
    detail: view.detail,
    busy: view.busy ? '1' : '',
    actions: view.actions.map((action) => `${action}:${ENGINE_ACTION_LABEL[action]}`).join('|'),
  };
}
