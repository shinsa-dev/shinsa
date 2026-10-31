export function recordFailure(message: string, detail: Record<string, unknown>) {
  // biome-ignore lint/suspicious/noConsole: Workers Logs keeps what a Worker writes to the console, its only log
  console.error(message, detail);
}
