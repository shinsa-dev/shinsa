export interface OnBehalfAction {
  at: number;
  command: string;
  taskId: string | null;
  summary: string;
  byTaskId?: string | null;
}

export const ON_BEHALF_ACTION_LIMIT = 100;
