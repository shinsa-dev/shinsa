const teardowns: (() => void)[] = [];

export function addTeardown(teardown: () => void) {
  teardowns.push(teardown);
}

export function runTeardowns() {
  for (const teardown of teardowns.splice(0)) teardown();
}
