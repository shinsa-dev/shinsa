import { homedir } from 'node:os';
import { join } from 'node:path';

export const ROOT = Bun.env.SHINSA_SEED_DIR ?? join(homedir(), '.shinsa-seed');

export const DATA = join(ROOT, 'data');

export const REPOS = join(ROOT, 'repos');

export const WORKTREES = join(DATA, 'worktrees');

export type Files = Record<string, string>;
