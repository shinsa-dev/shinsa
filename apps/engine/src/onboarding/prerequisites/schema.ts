import type { PrerequisiteId } from '../schema.ts';

export const NOT_FOUND_CODE = 127;

export const BUN_FILES = ['bun.lock', 'bun.lockb', 'bunfig.toml'];

export const MISSING_TOOLS = /xcrun: error|invalid active developer path/;

const BREW_PATH = 'eval "$(/opt/homebrew/bin/brew shellenv 2>/dev/null || /usr/local/bin/brew shellenv)"';

export const INSTALL_ORDER: readonly PrerequisiteId[] = ['git', 'brew', 'gh', 'claude', 'bun'];

export const FIXES: Record<PrerequisiteId, string> = {
  git: 'Install Apple’s command line tools, which include Git.',
  brew: 'Install Homebrew, which installs the GitHub CLI.',
  gh: 'Install the GitHub CLI with Homebrew.',
  claude: 'Install Claude Code, which agents run on.',
  bun: 'Your repositories use Bun. Install it so agents can run their checks.',
  codex: 'Only for agents you run on Codex.',
};

export const OPTIONAL_BUN_FIX = 'Only for repositories that use Bun.';

export const GITHUB_SIGN_IN_FIX = 'Sign in to GitHub, so Shinsa can open and merge pull requests.';

export const GITHUB_SIGN_IN = 'gh auth login';

export const COMMANDS: Record<PrerequisiteId, string> = {
  git: 'xcode-select --install',
  brew: '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"',
  gh: 'brew install gh',
  claude: 'curl -fsSL https://claude.ai/install.sh | bash',
  bun: 'curl -fsSL https://bun.sh/install | bash',
  codex: 'npm install -g @openai/codex',
};

export const SCRIPTS: Partial<Record<PrerequisiteId, string>> = {
  git: "xcode-select --install; echo 'Finish the install in the window macOS opened.'; until xcode-select -p >/dev/null 2>&1; do sleep 5; done",
  brew: `${COMMANDS.brew} && ${BREW_PATH}`,
  gh: `{ command -v gh >/dev/null 2>&1 || ${COMMANDS.gh}; } && { gh auth status >/dev/null 2>&1 || ${GITHUB_SIGN_IN}; }`,
};

export const LABELS: Record<PrerequisiteId, string> = {
  git: 'Git',
  brew: 'Homebrew',
  gh: 'GitHub CLI',
  claude: 'Claude Code',
  bun: 'Bun',
  codex: 'Codex',
};
