import type { OnboardingCheck } from '@shinsa/core';

export interface WelcomeLine {
  label: string;
  summary: string | null;
}

const NOT_SET = 'None yet';

export function listFailingChecks(checks: readonly OnboardingCheck[]) {
  return checks.filter((check) => !(check.ok || check.optional === true));
}

export function resolveWelcomeBody(lines: readonly WelcomeLine[]) {
  const setUp = [
    ...lines.map((line) => `- **${line.label}:** ${line.summary ?? NOT_SET}`),
    '- **Tools:** Everything Shinsa needs is installed.',
  ];
  return [
    'Welcome to Shinsa. Setup is done, and this was your first task.',
    '## What you set up',
    setUp.join('\n'),
    '## What happens next',
    'Describe what you want done from Home. An agent plans it, builds it and checks it. You step in to answer its questions, review the change and merge it.',
  ].join('\n\n');
}

export function resolveHelpRequest(checks: readonly OnboardingCheck[]) {
  const failing = checks.map((check) => {
    const command = check.command ? ` Shinsa's fix is \`${check.command}\`.` : '';
    return `- ${check.label}: ${check.detail}${command}`;
  });
  return [
    'Help me finish setting up Shinsa on this Mac. These checks fail:',
    failing.join('\n'),
    'Find out why they fail and give me the commands that fix them, each in its own ```bash run block, with one sentence on what it does. Do not run anything that installs or changes the machine yourself.',
  ].join('\n\n');
}
