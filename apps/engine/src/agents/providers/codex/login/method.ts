export function parseLoginMethod(output: string) {
  const method = /logged in (?:using|with|as)\s+(.+)/i.exec(output)?.[1]?.trim();
  if (!method) return null;
  return method.replace(/^an?\s+/i, '').replace(/\s+-\s+.*$/, '');
}
