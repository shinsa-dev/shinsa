import { describeEditorKey, EDITOR_COMMANDS } from '@/lib/code/editor/commands.ts';
import { type CommandSection, RANK } from '@/lib/command/registry.ts';

const LISTED_ELSEWHERE = new Set(['find', 'goto-line']);

export interface EditorCommandContext {
  taskId: string;
  mac: boolean;
  readOnly: string | null;
  run: (id: string) => void;
}

export function listEditorCommands(context: EditorCommandContext): CommandSection {
  const id = `task.${context.taskId}.editor`;
  return {
    id,
    heading: 'Editor',
    rank: RANK.context,
    commands: EDITOR_COMMANDS.filter((command) => !LISTED_ELSEWHERE.has(command.id)).map((command) => ({
      kind: 'run',
      id: `${id}.${command.id}`,
      label: command.label,
      icon: command.icon,
      trailing: describeEditorKey(command.keys[0], context.mac),
      keywords: ['editor', 'code'],
      disabled: command.edits && context.readOnly ? context.readOnly : undefined,
      run: () => context.run(command.id),
    })),
  };
}
