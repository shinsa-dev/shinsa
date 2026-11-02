export function recordFailure(message: string, detail: Record<string, unknown>) {
  // oxlint-disable-next-line eslint/no-console -- Workers Logs keeps what a Worker writes to the console, its only log
  console.error(message, detail);
}
