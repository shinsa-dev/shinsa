import type { IconName } from '@shinsa/ui/components/icon';

export const hero = {
  headline: 'Hand over the work. Keep the decisions.',
  text: 'Shinsa runs Claude Code and Codex on your own machine, from your request to a merged pull request, checking their work at every step. You step in only for what needs a person: the review, the merge and the odd question.',
  primary: 'Download for Mac',
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
    text: 'The agent hands over a work report: what it did, phase by phase, pointing at the lines that need your eyes, ranked by risk. A second agent reviews it first, with fresh context.',
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
    text: 'One local server and a Mac app. Your repositories never leave your disk, and there is no cloud.',
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
    icon: 'IconCamera1',
    title: 'Evidence',
    text: 'Agents attach screenshots in both themes, recordings, and tests that failed before the change and pass after it.',
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
    icon: 'IconConsole',
    title: 'A command line',
    text: 'The shinsa command does everything the app does, for you and for agents in your own terminal.',
  },
  {
    icon: 'IconKeyboard',
    title: 'One shortcut',
    text: '⌘K reaches every task, every action and the next decision that needs you.',
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
