import { toast } from '@shinsa/ui/components/sonner';
import { writeCommandMenuOpen } from '@/lib/command/registry.ts';
import { copyText } from '@/lib/connection/commands.ts';

export type ErrorFallbackSize = 'page' | 'inline' | 'icon' | 'silent';

export interface RenderError {
  message: string;
  details: string;
}

export const ERROR_COPY = {
  app: 'Shinsa hit an error.',
  page: 'This page hit an error.',
  part: 'This part of Shinsa hit an error.',
  appHint: 'Reload to start again. If it keeps happening, copy the details and report it.',
  pageHint: 'The rest of Shinsa keeps working. Try again, or reload if it keeps happening.',
  retry: 'Try again',
  reload: 'Reload',
  copy: 'Copy details',
  commandMenu: 'The command menu hit an error.',
} as const;

function resolveMessage(error: unknown) {
  if (error instanceof Error) return error.message || error.name;
  return String(error);
}

function resolveStack(error: unknown, message: string) {
  if (error instanceof Error && error.stack) return error.stack;
  return message;
}

export function resolveRenderError(error: unknown, componentStack: string | null): RenderError {
  const message = resolveMessage(error);
  const stack = resolveStack(error, message);
  const where = componentStack?.trim();
  const details = where ? `${stack}\n\nComponent stack:\n${where}` : stack;
  return { message, details };
}

export function resolveResetKey(view: { route: unknown; search: string }, visit = 0) {
  return `${JSON.stringify(view.route)}${view.search} ${visit}`;
}

export function recordCommandMenuError(error: RenderError) {
  writeCommandMenuOpen(false);
  toast.error(ERROR_COPY.commandMenu, {
    action: { label: ERROR_COPY.copy, onClick: () => void copyText(error.details) },
  });
}
