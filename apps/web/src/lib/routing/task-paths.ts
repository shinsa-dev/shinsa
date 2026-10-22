export interface TaskPathOptions {
  tab?: 'code' | 'chat';
  run?: string | null;
  view?: 'changes';
  file?: string;
}

export function resolveTaskPath(taskId: string, options: TaskPathOptions = {}) {
  const params = new URLSearchParams();
  if (options.tab) params.set('tab', options.tab);
  if (options.view) params.set('view', options.view);
  if (options.file) params.set('file', options.file);
  if (options.run) params.set('run', options.run);
  const query = params.toString();
  return `/tasks/${encodeURIComponent(taskId)}${query ? `?${query}` : ''}`;
}
