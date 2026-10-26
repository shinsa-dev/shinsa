import { resolveTerminalLabel, type TerminalInfo, type TerminalPlace } from '@shinsa/core';
import type { Command, CommandSection } from '@/lib/command/registry.ts';
import { RANK } from '@/lib/command/registry.ts';
import { describeFindKey } from '@/lib/terminal/keys.ts';
import { PLACE_ICONS, type PlaceGroup } from '@/lib/terminal/tabs.ts';

interface TerminalPageActions {
  open: (place: TerminalPlace) => void;
  select: (terminal: TerminalInfo) => void;
  find: () => void;
  restart: (terminal: TerminalInfo) => void;
  rename: (terminal: TerminalInfo, name: string) => Promise<unknown>;
  close: (terminal: TerminalInfo) => void;
}

export interface TerminalPageContext {
  terminals: TerminalInfo[];
  active: TerminalInfo | null;
  groups: PlaceGroup[];
  fallback: TerminalPlace | null;
  mac: boolean;
  actions: TerminalPageActions;
}

function listNewCommand({ groups, fallback, actions }: TerminalPageContext): Command[] {
  const places = groups.flatMap((group) => group.places);
  const only = places.length <= 1 ? (places[0] ?? fallback) : null;
  if (only)
    return [
      {
        kind: 'run',
        id: 'terminal.new',
        label: 'New terminal',
        icon: 'IconPlusMedium',
        hint: only.label,
        run: () => actions.open(only),
      },
    ];
  if (places.length === 0) return [];
  return [
    {
      kind: 'page',
      id: 'terminal.new',
      label: 'New terminal…',
      icon: 'IconPlusMedium',
      page: {
        kind: 'list',
        crumb: 'New terminal',
        placeholder: 'Open a terminal in…',
        sections: groups.map((group, index) => ({
          id: `terminal.places.${group.kind}`,
          heading: group.heading,
          rank: index,
          commands: group.places.map((place) => ({
            kind: 'run',
            id: `terminal.place.${place.path}`,
            label: place.label,
            hint: place.path,
            icon: PLACE_ICONS[place.kind],
            run: () => actions.open(place),
          })),
        })),
      },
    },
  ];
}

function listActiveCommands({ active, mac, actions }: TerminalPageContext): Command[] {
  if (!active) return [];
  const label = resolveTerminalLabel(active);
  return [
    {
      kind: 'run',
      id: 'terminal.find',
      label: 'Find in the scrollback',
      icon: 'IconMagnifyingGlass',
      trailing: describeFindKey(mac),
      run: actions.find,
    },
    ...(active.status === 'running'
      ? []
      : [
          {
            kind: 'run',
            id: 'terminal.restart',
            label: 'Start the shell again',
            icon: 'IconArrowRotateClockwise',
            run: () => actions.restart(active),
          } satisfies Command,
        ]),
    {
      kind: 'page',
      id: 'terminal.rename',
      label: 'Rename this terminal…',
      icon: 'IconPencil',
      page: {
        kind: 'compose',
        crumb: 'Rename',
        placeholder: 'A name for this terminal',
        submit: 'Rename',
        prefill: label,
        send: (text) => actions.rename(active, text),
      },
    },
    {
      kind: 'run',
      id: 'terminal.close',
      label: 'Close this terminal',
      icon: 'IconCrossSmall',
      destructive: true,
      run: () => actions.close(active),
    },
  ];
}

function listSwitchCommands({ terminals, active, actions }: TerminalPageContext): Command[] {
  return terminals
    .filter((terminal) => terminal.id !== active?.id)
    .map((terminal) => ({
      kind: 'run',
      id: `terminal.switch.${terminal.id}`,
      label: resolveTerminalLabel(terminal),
      hint: terminal.cwd,
      icon: 'IconConsole',
      run: () => actions.select(terminal),
    }));
}

export function listTerminalPageCommands(context: TerminalPageContext): CommandSection[] {
  return [
    {
      id: 'terminal.page',
      heading: 'Terminal',
      rank: RANK.context,
      commands: [...listNewCommand(context), ...listActiveCommands(context)],
    },
    { id: 'terminal.switch', heading: 'Terminals', rank: RANK.page, commands: listSwitchCommands(context) },
  ];
}
