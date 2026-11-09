import { BROWSER_SIGN_IN_LIMITS } from '@shinsa/core';
import { limitedText } from '../fields.ts';
import type { ToolSpec } from '../schema.ts';

export const BROWSER_TOOL_SPECS = {
  request_browser_sign_in: {
    name: 'request_browser_sign_in',
    description: [
      'Ask the human to sign your project’s shared browser in to a site, when a page in it asks you to sign in. Waits until they answer.',
      'Your browser tools already open pages in that shared browser, which keeps its sign-ins across runs and tasks, so ask once per site, never per task.',
      'The human copies the sign-in from their own browser or signs in by hand in a window on their machine; when they are done, open the page again.',
      'Use the repository’s own test users instead when it has them. Never ask for a password with `ask`, and never launch a browser of your own to sign in.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        url: limitedText(
          'The full address of the page that asks you to sign in.',
          BROWSER_SIGN_IN_LIMITS.url
        ),
        reason: limitedText(
          'One sentence telling the human what you need to see there and why.',
          BROWSER_SIGN_IN_LIMITS.reason
        ),
      },
      required: ['url', 'reason'],
    },
  },
} satisfies Record<string, ToolSpec>;
