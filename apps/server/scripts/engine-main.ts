import { runCli } from '../src/cli/index.ts';
import { EUNOE_COMMAND } from '../src/eunoe/command.ts';

if (Bun.argv[2] === EUNOE_COMMAND) {
  process.argv.splice(2, 1);
  await import('@chroxify/eunoe/src/cli/main.ts');
} else {
  process.exitCode = await runCli(Bun.argv.slice(2));
}
