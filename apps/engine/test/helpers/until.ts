export async function until(
  describe: string,
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 5_000
) {
  const deadline = performance.now() + timeoutMs;
  while (!(await predicate())) {
    if (performance.now() > deadline) throw new Error(`Timed out waiting for ${describe}.`);
    await Bun.sleep(10);
  }
}
