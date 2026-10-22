import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const home = mkdtempSync(join(tmpdir(), 'shinsa-test-home-'));
const gitConfig = join(home, 'gitconfig');
writeFileSync(
  gitConfig,
  '[user]\n\tname = Shinsa Test\n\temail = test@shinsa.dev\n[init]\n\tdefaultBranch = main\n[commit]\n\tgpgsign = false\n'
);

process.env.GIT_CONFIG_GLOBAL = gitConfig;
process.env.GIT_CONFIG_NOSYSTEM = '1';
process.env.GIT_OPTIONAL_LOCKS = '0';
process.env.PATH = `${resolve(import.meta.dirname, 'bin')}:${process.env.PATH ?? ''}`;
process.env.SHINSA_QUICK = 'off';
