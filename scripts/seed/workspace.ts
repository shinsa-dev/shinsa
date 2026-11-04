import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Project, Repo } from '../../packages/core/src/index.ts';
import { runGit } from '../kit/git/index.ts';
import { type Files, REPOS, WORKTREES } from './paths.ts';
import { listCliBaseFiles, listCliNewFiles } from './sources/cli.ts';
import {
  TAB_GROUP_BASE,
  DEFAULTS_BASE,
  KANNA_THEME,
  TAB_GROUP_NEW,
  TAB_GROUP_TEST_NEW,
  DEFAULTS_NEW,
  USAGE_NEW,
  DEFAULTS_TEST_NEW,
} from './sources/kanna.ts';
import {
  EMBEDDED_CHAT_BASE,
  TRANSPORT_BASE,
  DUPLICATE_BASE,
  ERRORS_BASE,
  EMBEDDED_CHAT_NEW,
  MCP_SESSION_NEW,
  MCP_SESSION_TEST_NEW,
  DUPLICATE_NEW,
  ERRORS_NEW,
  DUPLICATE_TEST_NEW,
} from './sources/paywall.ts';
import { EXPORT_FILES_BASE, EXPORT_FILES_NEW } from './tasks/process.ts';

function writeFiles(root: string, files: Files) {
  for (const [path, content] of Object.entries(files)) {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
}

function createRepo(name: string, files: Files) {
  const path = join(REPOS, name);
  mkdirSync(path, { recursive: true });
  runGit(['init', '-q', '-b', 'main'], path);
  runGit(['config', 'user.email', 'seed@shinsa.dev'], path);
  runGit(['config', 'user.name', 'Shinsa seed'], path);
  writeFiles(path, files);
  runGit(['add', '-A'], path);
  runGit(['commit', '-q', '-m', 'chore: initial commit'], path);
  return path;
}

function createWorktree(repoPath: string, taskId: string, branch: string, base: string, files: Files) {
  const path = join(WORKTREES, taskId);
  runGit(['worktree', 'add', '-q', '-b', branch, path, base], repoPath);
  writeFiles(path, files);
  return path;
}

function commitWorktree(path: string, message: string) {
  runGit(['add', '-A'], path);
  runGit(
    ['-c', 'user.email=seed@shinsa.dev', '-c', 'user.name=Shinsa seed', 'commit', '-q', '-m', message],
    path
  );
}

export function createProjects(): Project[] {
  return [
    {
      id: 'project-superwall',
      name: 'Superwall',
      color: 'blue',
      key: 'SW',
      description:
        'Superwall’s paywall editor and its docs. paywall-next is the editor and the embedded chat; docs is the public documentation site.',
      folders: [join(REPOS, 'superwall')],
    },
    {
      id: 'project-basket',
      name: 'Basket',
      color: 'green',
      key: 'BSK',
      description:
        'A grocery list app: the Swift SDK the app and partners use, the Bun API server with its Postgres schema, and the iOS app.',
      folders: [join(REPOS, 'basket')],
    },
    {
      id: 'project-personal',
      name: 'Personal',
      color: 'purple',
      key: 'PER',
      description: 'Side projects: Kanna, the coding agent UI, and prints, the print queue.',
      folders: [],
      usageLimit: 20,
    },
  ];
}

function createSeedRepo(id: string, name: string, path: string, remote: string, projectId: string): Repo {
  return {
    id,
    name,
    path,
    defaultBranch: 'main',
    remote,
    projectId,
    checkCommands: ['bun lint', 'bun check-types'],
  };
}

export interface SeedRepos {
  paywall: Repo;
  kanna: Repo;
  docs: Repo;
  prints: Repo;
  basketSdk: Repo;
  basketServer: Repo;
  basketApp: Repo;
}

export function createRepos(): SeedRepos {
  const paywallBase: Files = {
    'src/chat/embedded-chat.ts': EMBEDDED_CHAT_BASE,
    'src/chat/transport.ts': TRANSPORT_BASE,
    'src/paywalls/duplicate.ts': DUPLICATE_BASE,
    'src/paywalls/errors.ts': ERRORS_BASE,
    'src/ui/tab-group.tsx': TAB_GROUP_BASE,
    ...EXPORT_FILES_BASE,
    ...listCliBaseFiles(),
    'package.json': '{ "name": "paywall-next", "private": true }\n',
  };
  const paywallPath = createRepo('superwall/paywall-next', paywallBase);
  const kannaPath = createRepo('kanna', {
    'src/shared/defaults.ts': DEFAULTS_BASE,
    'src/client/theme.css': KANNA_THEME,
    'package.json': '{ "name": "kanna-code" }\n',
  });
  const docsPath = createRepo('superwall/docs', {
    'framework/access.mdx': '# Access\n\nRequest access from support.\n',
  });
  const printsPath = createRepo('prints', { 'src/queue.ts': 'export const queue: string[] = [];\n' });
  const basketSdkPath = createRepo('basket/basket-ios-sdk', {
    'Sources/Basket/ListSync.swift': 'public struct ListSync {}\n',
    'Package.swift': '// swift-tools-version:5.10\n',
  });
  const basketServerPath = createRepo('basket/basket-server', {
    'src/db/schema.ts': 'export const lists = { id: "uuid", ownerId: "uuid", name: "text" };\n',
    'package.json': '{ "name": "basket-server", "private": true }\n',
  });
  const basketAppPath = createRepo('basket/basket-app', {
    'Basket/ListView.swift': 'struct ListView {}\n',
  });

  const paywall = createSeedRepo(
    'repo-paywall',
    'paywall-next',
    paywallPath,
    'git@github.com:superwall/paywall-next.git',
    'project-superwall'
  );
  const kanna = createSeedRepo(
    'repo-kanna',
    'kanna',
    kannaPath,
    'git@github.com:chroxify/kanna.git',
    'project-personal'
  );
  const docs = createSeedRepo(
    'repo-docs',
    'docs',
    docsPath,
    'git@github.com:superwall/docs.git',
    'project-superwall'
  );
  const prints = createSeedRepo(
    'repo-prints',
    'prints',
    printsPath,
    'git@github.com:chroxify/prints.git',
    'project-personal'
  );

  const basketSdk = createSeedRepo(
    'repo-basket-sdk',
    'basket-ios-sdk',
    basketSdkPath,
    'git@github.com:basket/basket-ios-sdk.git',
    'project-basket'
  );
  const basketServer = createSeedRepo(
    'repo-basket-server',
    'basket-server',
    basketServerPath,
    'git@github.com:basket/basket-server.git',
    'project-basket'
  );
  const basketApp = createSeedRepo(
    'repo-basket-app',
    'basket-app',
    basketAppPath,
    'git@github.com:basket/basket-app.git',
    'project-basket'
  );
  return { paywall, kanna, docs, prints, basketSdk, basketServer, basketApp };
}

export interface SeedWorktrees {
  chat: string;
  duplicate: string;
  tabs: string;
  rounds: string;
  defaults: string;
  exportBackoff: string;
  registry: string;
}

export function createWorktrees({ paywall, kanna }: SeedRepos): SeedWorktrees {
  const paywallPath = paywall.path;
  const kannaPath = kanna.path;
  const chatPath = createWorktree(paywallPath, 'task-embedded-chat', 'feat/embedded-chat-mcp', 'main', {
    'src/chat/embedded-chat.ts': EMBEDDED_CHAT_NEW,
    'src/chat/mcp-session.ts': MCP_SESSION_NEW,
    'src/chat/mcp-session.test.ts': MCP_SESSION_TEST_NEW,
  });
  rmSync(join(chatPath, 'src/chat/transport.ts'));
  commitWorktree(chatPath, 'feat(chat): run the embedded chat on MCP v2');
  const duplicatePath = createWorktree(paywallPath, 'task-duplicate', 'fix/code-first-duplicate', 'main', {
    'src/paywalls/duplicate.ts': DUPLICATE_NEW,
    'src/paywalls/errors.ts': ERRORS_NEW,
    'src/paywalls/duplicate.test.ts': DUPLICATE_TEST_NEW,
  });
  commitWorktree(duplicatePath, 'fix(paywalls): refuse to duplicate code-first paywalls');
  const tabsPath = createWorktree(paywallPath, 'task-tab-scroll', 'fix/tab-group-scroll', 'main', {
    'src/ui/tab-group.tsx': TAB_GROUP_NEW,
    'src/ui/tab-group.test.tsx': TAB_GROUP_TEST_NEW,
  });
  commitWorktree(tabsPath, 'fix(ui): scroll tab groups horizontally');
  const exportBackoffPath = createWorktree(
    paywallPath,
    'task-export-backoff',
    'fix/export-retry-restart',
    'main',
    EXPORT_FILES_NEW
  );
  commitWorktree(exportBackoffPath, 'fix(export): resume retries inside the chunk and after a restart');
  const registryPath = createWorktree(
    paywallPath,
    'task-command-registry',
    'refactor/command-registry',
    'main',
    listCliNewFiles()
  );
  commitWorktree(registryPath, 'refactor(cli): declare every command with defineCommand');
  runGit(['branch', 'feat/mcp-v2-agent-4', 'main'], paywallPath);
  const roundsPath = createWorktree(
    paywallPath,
    'task-mcp-rounds',
    'feat/mcp-v2-agent-5',
    'feat/mcp-v2-agent-4',
    {
      'src/agent/tool-cache.ts': 'export const TOOL_CACHE_TTL_MS = 60 * 60 * 1000;\n',
    }
  );
  const defaultsPath = createWorktree(kannaPath, 'task-usage-defaults', 'feat/usage-aware-defaults', 'main', {
    'src/shared/defaults.ts': DEFAULTS_NEW,
    'src/shared/usage.ts': USAGE_NEW,
    'src/shared/defaults.test.ts': DEFAULTS_TEST_NEW,
  });
  commitWorktree(defaultsPath, 'feat(models): fall back to a cheaper model near the usage limit');
  return {
    chat: chatPath,
    duplicate: duplicatePath,
    tabs: tabsPath,
    rounds: roundsPath,
    defaults: defaultsPath,
    exportBackoff: exportBackoffPath,
    registry: registryPath,
  };
}
