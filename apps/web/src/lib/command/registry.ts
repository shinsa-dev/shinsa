import type { MenuItemIcon } from '@shinsa/ui/components/menu-icon';
import { useEffect, useId, useRef, useSyncExternalStore } from 'react';

export interface ChoiceOption {
  value: string;
  label: string;
  icon?: MenuItemIcon;
  dot?: string;
  keywords?: string[];
  disabled?: string;
}

interface CommandBase {
  id: string;
  label: string;
  hint?: string;
  icon?: MenuItemIcon;
  taskId?: string;
  keywords?: string[];
  destructive?: boolean;
  disabled?: string;
  current?: boolean;
  trailing?: string;
  searchOnly?: boolean;
}

export type Command =
  | (CommandBase & { kind: 'run'; run: () => void })
  | (CommandBase & { kind: 'go'; to: string })
  | (CommandBase & { kind: 'link'; href: string })
  | (CommandBase & { kind: 'page'; page: MenuPage })
  | (CommandBase & { kind: 'search'; search: (text: string) => void })
  | (CommandBase & {
      kind: 'choice';
      heading: string;
      options: ChoiceOption[];
      value: string | string[] | null;
      pick: (value: string) => void;
    });

export function isDisabled(item: { disabled?: string }) {
  return item.disabled !== undefined;
}

export function isChosen(command: { value: string | string[] | null }, value: string) {
  return Array.isArray(command.value) ? command.value.includes(value) : command.value === value;
}

export type MenuPage =
  | { kind: 'list'; crumb: string; placeholder: string; sections: CommandSection[] }
  | {
      kind: 'compose';
      crumb: string;
      placeholder: string;
      submit: string;
      prefill?: string;
      send: (text: string) => Promise<unknown>;
    };

export interface CommandSection {
  id: string;
  heading: string;
  rank: number;
  commands: Command[];
}

export const RANK = {
  context: 0,
  next: 10,
  page: 20,
  global: 50,
} as const;

const owners = new Map<string, { current: CommandSection[] }>();
const listeners = new Set<() => void>();
let version = 0;

function publish() {
  version += 1;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useRegisteredSections(): CommandSection[] {
  useSyncExternalStore(subscribe, () => version);
  return [...owners.values()].flatMap((owner) => owner.current);
}

function serializeSections(sections: CommandSection[]) {
  return JSON.stringify(sections);
}

export function useRegisterCommands(sections: CommandSection[]) {
  const key = useId();
  const latest = useRef(sections);
  latest.current = sections;
  const signature = serializeSections(sections);

  useEffect(() => {
    owners.set(key, latest);
    publish();
    return () => {
      owners.delete(key);
      publish();
    };
  }, [key]);

  useEffect(() => {
    if (signature) publish();
  }, [signature]);
}

let open = false;
const openListeners = new Set<() => void>();

export function writeCommandMenuOpen(next: boolean) {
  if (open === next) return;
  open = next;
  for (const listener of openListeners) listener();
}

export function toggleCommandMenu() {
  writeCommandMenuOpen(!open);
}

export function useCommandMenuOpen() {
  return useSyncExternalStore(
    (listener) => {
      openListeners.add(listener);
      return () => {
        openListeners.delete(listener);
      };
    },
    () => open
  );
}
