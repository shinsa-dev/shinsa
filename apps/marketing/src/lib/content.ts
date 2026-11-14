import type { IconName } from '@shinsa/ui/components/icon';

export const hero = {
  headline: 'Hand over the work.',
  headlineRest: 'Keep the decisions.',
  text: 'Shinsa runs Claude Code and Codex on your own machine, from your request all the way to a merged pull request. Agents research, plan, build and check their own work, and come to you only for the calls that are yours to make.',
  primary: 'Download for Mac (Canary)',
  beta: 'Or download the beta',
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
  tasks: {
    id: 'tasks',
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
    text: 'Free and open source under the AGPL. Read every line, run it, change it.',
  },
];

export const closing = {
  title: 'Hand over your first task.',
  text: 'Shinsa takes it from there.',
};

export const openTask = {
  untitled: 'A task built with Shinsa',
  unreviewed: 'This link carries no review. Open the task in Shinsa to read it.',
  missingTitle: 'This link does not lead to a review',
  missing:
    'It names no task or pull request. Open the review again from the link in the pull request on GitHub.',
  primary: 'Open in Shinsa',
  secondary: 'Download Shinsa',
  source:
    'Nothing here is stored or sent anywhere: your browser reads this review from the link in the pull request. The pull request on GitHub is the record.',
};

export const koe = {
  headline: 'Talk, point, paste.',
  headlineRest: 'Koe bundles it.',
  text: 'Hold Fn and say what you mean. Comment on the screen, take screenshots, record clips and drop in files as you talk. Let go, and Koe copies one bundle: your words with every attachment where you said it, ready for any agent, issue or chat.',
  primary: 'Download for Mac',
  secondary: 'View on GitHub',
  requirement: 'Free and open source, for macOS 26 and later.',
  soonTitle: 'Koe is almost here.',
  soonText: 'There is no release to download yet. Check back soon.',
  byline: 'by Shinsa',
  demoId: 'demo',
  sessionLabel:
    'A Koe session on Shinsa’s home: talk, pin a comment on the Start button, screenshot the greeting, then finish and Koe copies the bundle',
  sessionCaptions: [
    { start: 0.85, end: 3.4, text: 'The new task box feels a bit flat.' },
    { start: 4.85, end: 6.8, text: 'Make this button stand out.' },
    { start: 11.75, end: 13.9, text: 'Give these lines a little more room.' },
  ],
  closingTitle: 'Say it once.',
  closingText: 'Koe brings the screenshots.',
  callout: 'Also from us',
  launchTag: 'New',
  launchText: 'Koe, dictation for your Mac',
  calloutTitle: 'Koe, talk and point instead of typing.',
  calloutText:
    'Hold Fn and talk. Comment on the screen, take screenshots and clips as you go, and Koe copies it all as one bundle, ready for any agent. Fast, and on your Mac.',
  calloutLink: 'Meet Koe',
};

export const koeSections = {
  bundle: {
    id: 'bundle',
    title: 'A bundle, not a transcript.',
    text: 'Koe puts your words and the files on the clipboard together. Each attachment is numbered where you mentioned it, so the agent reading it knows what you meant.',
  },
  speed: {
    id: 'speed',
    title: 'Faster than you can let go.',
    text: 'Koe is listening before you finish pressing Fn, and your words are on the clipboard before you reach for ⌘V.',
  },
  models: {
    id: 'models',
    title: 'Pick your model.',
    text: 'Every model runs on your Mac. Switch any time in Settings; Koe downloads the one you pick.',
  },
} satisfies Record<string, SectionCopy>;

export interface KoeCaption {
  start: number;
  end: number;
  text: string;
}

const CAPTION_SPOKEN_SHARE = 0.8;

export function resolveCaptionWords(caption: KoeCaption) {
  const words = caption.text.split(' ');
  const total = words.reduce((sum, word) => sum + word.length + 1, 0);
  const spoken = (caption.end - caption.start) * CAPTION_SPOKEN_SHARE;
  let before = 0;
  return words.map((text) => {
    const at = caption.start + (spoken * before) / total;
    before += text.length + 1;
    return { text, at };
  });
}

export const koeTools: {
  id: string;
  title: string;
  text: string;
  video: string;
  label: string;
  captions: KoeCaption[];
}[] = [
  {
    id: 'comment',
    title: 'Comment on anything.',
    text: 'Pin a comment to a button, a line or a cell, then the next one. Koe captures what is under each, and the pins join into one picture.',
    video: 'koe-comment',
    label: 'Koe pinning two comments in a row on Shinsa, one on the Start button and one on a menu',
    captions: [
      { start: 2.85, end: 4.8, text: 'Make this button stand out.' },
      { start: 7.85, end: 10.1, text: 'This menu needs a clearer label.' },
    ],
  },
  {
    id: 'screenshot',
    title: 'Screenshot as you talk.',
    text: 'Drag over what you mean. The screenshot lands in your words at the moment you took it, and whatever you say right after becomes its note.',
    video: 'koe-screenshot',
    label: 'Koe taking a screenshot of Shinsa’s task box while you describe it',
    captions: [
      { start: 0.55, end: 2.65, text: 'The options under the box feel cramped.' },
      { start: 5.95, end: 8.55, text: 'Give them a little more room, maybe eight pixels.' },
    ],
  },
  {
    id: 'clip',
    title: 'Record a clip.',
    text: 'Show a bug as it happens, then step through the frames and pick the one that shows it.',
    video: 'koe-clip',
    label: 'Koe recording a clip of hovering over Shinsa’s task list, then playing it back to pick a frame',
    captions: [
      { start: 0.55, end: 2.1, text: 'Watch these rows when I hover.' },
      { start: 12.75, end: 15.4, text: 'The hover is too faint here, make it stronger.' },
    ],
  },
];

export const koeBundle = {
  attachedLabel: 'What Koe attached',
  clipboardLabel: 'What the clipboard holds',
  said: [
    { text: 'The new task box feels a bit flat.' },
    { marker: '1', note: 'Make this button stand out.' },
    { marker: '2', note: 'Give these lines a little more room.' },
  ],
  attachments: [
    {
      label: '[1] Comment on Google Chrome, "Shinsa", at the blue pin numbered 1, 75% across and 63% down:',
      path: '~/Library/Application Support/Koe/Sessions/2026-11-13-181914-7361/attachments/screenshot-1.png',
    },
    {
      label: '[2] Image of Google Chrome, "Shinsa":',
      path: '~/Library/Application Support/Koe/Sessions/2026-11-13-181914-7361/attachments/screenshot-2.png',
    },
  ],
  files: [
    {
      src: '/koe/koe-attachment-comment.webp',
      width: 1600,
      height: 970,
      light: { src: '/koe/koe-attachment-comment-light.webp', width: 1600, height: 985 },
      alt: 'The Shinsa window Koe captured for comment 1, with a blue pin numbered 1 on the Start button',
      caption: '[1] The window, with comment 1 pinned on Start.',
    },
    {
      src: '/koe/koe-attachment-screenshot.webp',
      width: 1458,
      height: 558,
      light: { src: '/koe/koe-attachment-screenshot-light.webp', width: 1458, height: 558 },
      alt: 'The region Koe captured for screenshot 2: the greeting on Shinsa’s home',
      caption: '[2] The region you dragged over.',
    },
  ],
  note: 'This is the session in the video above, as Koe copied it. The two images go on the clipboard too, so apps that take files get them.',
};

export const koeSpeed = {
  stats: [
    { value: '26 ms', label: 'From pressing Fn to listening' },
    { value: '18 ms', label: 'From finishing to the bundle on your clipboard' },
  ],
  method:
    'Measured on a MacBook Pro with M4 Pro running Parakeet v3: the median of 8 sessions, from the key event to Koe recording and from the finishing key event to the clipboard changing.',
};

export const koeModels: { name: string; languages: string; size: string; note?: string }[] = [
  { name: 'Parakeet v3', languages: '25 European languages', size: '483 MB', note: 'Recommended' },
  { name: 'Parakeet v2', languages: 'English', size: '464 MB' },
  { name: 'Whisper large-v3 turbo', languages: '99 languages', size: '650 MB' },
  { name: 'Apple on-device', languages: 'Your system language', size: 'Built in' },
];

export const koeFeatures: { icon: IconName; title: string; text: string }[] = [
  {
    icon: 'IconKeyboard',
    title: 'One key',
    text: 'Fn starts and finishes. Pick your own shortcut in Settings if Fn is taken.',
  },
  {
    icon: 'IconClipboard2',
    title: 'Paste anywhere',
    text: 'Agents, issues, chats and docs take the text and the files in one ⌘V.',
  },
  {
    icon: 'IconLock',
    title: 'On device',
    text: 'Your voice, text and captures never leave your Mac. Only speech models and Koe’s own updates are downloaded.',
  },
];
