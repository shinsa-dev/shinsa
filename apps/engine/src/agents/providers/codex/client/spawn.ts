export function spawnAppServer(path: string, cwd: string, env: Record<string, string | undefined>) {
  return Bun.spawn([path, 'app-server'], {
    cwd,
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
    detached: true,
    env,
  });
}
