const TASK_ID = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/;

export function resolveTaskLink(search: string) {
  const task = new URLSearchParams(search).get('task');
  if (!task || !TASK_ID.test(task)) return null;
  return `shinsa://task/${task}`;
}
