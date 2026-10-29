import type { IconName } from '@shinsa/ui/components/icon';

export const hero = {
  headline: 'Hand over the work.',
  headlineRest: 'Keep the decisions.',
  text: 'Shinsa runs Claude Code and Codex on your own machine, from your request all the way to a merged pull request. Agents research, plan, build and check their own work, and come to you only for the calls that are yours to make.',
  primary: 'Download for Mac',
  beta: 'Or download the beta, with the newest changes first',
  secondary: 'View on GitHub',
};

export interface SectionCopy {
  id: string;
  title: string;
  text: string;
}

export const sections = {
  gates: {
    id: 'gates',
    title: 'You see decisions, not chats.',
    text: 'A task stops for you only at a gate: the review, the merge, a question when the agent is stuck, and the plan when you turn plan approval on. Everything between them is Shinsa’s job. Try it below: take one task from its plan to its merge.',
  },
  kinds: {
    id: 'kinds',
    title: 'Not every request ends in a pull request.',
    text: 'Shinsa reads what you asked for and picks the path. A question gets an answer, a bug gets a diagnosis first, an operation waits for your OK. You never choose a mode.',
  },
  review: {
    id: 'review',
    title: 'Review the change, not the diff.',
    text: 'The agent that built it walks you through it: how it works, the key code explained, the calls it made and what it turned down, what to read carefully and how to test it. Proof comes first: before and after shots in both themes, a recording, the test run, a preview link.',
  },
  code: {
    id: 'code',
    title: 'An IDE in every task.',
    text: 'The Code tab is a full editor, not a diff viewer: the changes side by side, a file tree, ⌘P to any file, search across the repository, at any commit. Edit a line and it saves to the task’s working copy, so you rarely need to open your own editor. Shinsa still makes every commit.',
  },
  roadmap: {
    id: 'roadmap',
    title: 'Many agents at once. One list for you.',
    text: 'Every task runs on its own agent, in its own worktree and branch. A task that depends on another waits until it merges. You work down one list, in the order things need you.',
  },
  loop: {
    id: 'loop',
    title: 'Checked at every step, without you.',
    text: 'Shinsa runs your repository’s own checks itself, so a green build is a fact, not an agent’s claim. A separate agent reviews every change. Failing CI and review-bot comments go back to the agent that built it. You hear about it again when it is ready to merge.',
  },
  guard: {
    id: 'guard',
    title: 'Nothing reaches main without you.',
    text: 'Agents never commit, push or merge. Shinsa does, and only after your review and your merge. Every command an agent runs is checked before it runs, and for the default branch itself Shinsa sets you up with GitHub branch protection.',
  },
} satisfies Record<string, SectionCopy>;

export const principles = [
  {
    title: 'Runs on your machine',
    text: 'Fully local. Your tasks and everything your agents produce stay on your Mac. No account, no telemetry.',
  },
  {
    title: 'Your agents, your accounts',
    text: 'Claude Code and Codex, on the logins you already have. When one account hits its limit, the next one takes over.',
  },
  {
    title: 'Your tools come along',
    text: 'The MCP servers, skills and plugins you set up in Claude Code and Codex load for every agent.',
  },
  {
    title: 'Every decision is a record',
    text: 'Tasks, gates and answers are events in a log. Restart anything and the work carries on where it was.',
  },
];

export const features: { icon: IconName; title: string; text: string }[] = [
  {
    icon: 'IconFilter1',
    title: 'Lean context',
    text: 'MCP servers and skills an agent has not used in 30 days stay out of its context, and load mid-run when it needs one.',
  },
  {
    icon: 'IconGauge',
    title: 'Usage limits handled',
    text: 'A run that hits a limit moves to an account with room. With none left, the task waits for the reset and carries on.',
  },
  {
    icon: 'IconArrowsRepeat',
    title: 'Rounds',
    text: 'A new idea in the chat starts the next round on the same branch and the same agent session, which remembers everything.',
  },
  {
    icon: 'IconEyeOpen',
    title: 'Focus',
    text: 'Say which project you are on. Decisions from the others wait quietly until you switch.',
  },
  {
    icon: 'IconServer',
    title: 'Services',
    text: 'Your dev servers start with one press and keep running when you close the window. Shinsa finds them for you.',
  },
  {
    icon: 'IconBranch',
    title: 'A worktree per task',
    text: 'Every task gets its own worktree and branch, so ten agents never touch the same files.',
  },
  {
    icon: 'IconCalendarClock',
    title: 'Schedules and webhooks',
    text: 'Run a request every night, or when something happens in another service.',
  },
  {
    icon: 'IconRobot',
    title: 'Agents manage Shinsa',
    text: 'An agent can start, prioritise and order tasks for you. The decisions at your gates stay yours.',
  },
  {
    icon: 'IconKeyboard',
    title: 'A command line and ⌘K',
    text: 'The shinsa command does everything the app does, for you and for agents. ⌘K reaches every task and action.',
  },
  {
    icon: 'IconConsole',
    title: 'A terminal per project',
    text: 'Tabs per project, in your shell, with a Mac terminal’s keys. A command an agent needs from you runs in one press.',
  },
  {
    icon: 'IconWindow',
    title: 'A Mac app',
    text: 'A Dock badge with what needs you, notifications, and links that open a task.',
  },
  {
    icon: 'IconGithub',
    title: 'Open source',
    text: 'MIT licensed and free. Read every line, run it, change it.',
  },
];

export const closing = {
  title: 'Hand over your first task.',
  text: 'Shinsa takes it from there.',
};

export const openTask = {
  title: 'A pull request built with Shinsa',
  text: 'An agent planned, built and checked this change in Shinsa, then wrote its review: the evidence first, then how it works, the calls it made and how to test it.',
  missing: 'This link does not name a task. Ask whoever shared it for the pull request’s own link.',
  primary: 'Download Shinsa',
  secondary: 'Open in Shinsa',
};
