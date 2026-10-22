import { toast } from '@shinsa/ui/components/sonner';

export type OpenTarget = 'editor' | 'finder' | 'terminal';

export async function openWorktree(taskId: string, target: OpenTarget, path?: string, line?: number) {
  try {
    const response = await fetch(`/api/tasks/${taskId}/open`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target, path, line }),
    });
    if (response.ok) return true;
  } catch {
    toast.error('Could not reach Shinsa to open the worktree.');
    return false;
  }
  toast.error('Could not open the worktree.');
  return false;
}
