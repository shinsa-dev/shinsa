import { describe, expect, test } from 'bun:test';
import { markInlineCode } from '../../src/index.ts';

describe('markInlineCode', () => {
  test('wraps identifiers, calls, paths and flags', () => {
    expect(markInlineCode('duplicatePaywall throws in McpSession when reset() runs')).toBe(
      '`duplicatePaywall` throws in `McpSession` when `reset()` runs'
    );
    expect(markInlineCode('see src/chat/session.ts and pass --force')).toBe(
      'see `src/chat/session.ts` and pass `--force`'
    );
    expect(markInlineCode('the agent_question gate')).toBe('the `agent_question` gate');
  });

  test('wraps upper-case names such as environment variables and secrets', () => {
    expect(markInlineCode('Set SLACK_TOKEN_KEY and SLACK_CLIENT_ID on shinsa-cloud')).toBe(
      'Set `SLACK_TOKEN_KEY` and `SLACK_CLIENT_ID` on shinsa-cloud'
    );
    expect(markInlineCode('An API key, not a URL, and not a trailing UNDER_')).toBe(
      'An API key, not a URL, and not a trailing UNDER_'
    );
  });

  test('leaves prose, brands, links and existing code alone', () => {
    expect(markInlineCode('Open it on GitHub with TypeScript on iOS')).toBe(
      'Open it on GitHub with TypeScript on iOS'
    );
    expect(markInlineCode('see [the fooBar docs](https://x.dev/fooBar) and `alreadyCode`')).toBe(
      'see [the fooBar docs](https://x.dev/fooBar) and `alreadyCode`'
    );
    expect(markInlineCode('```\nconst fooBar = 1\n```')).toBe('```\nconst fooBar = 1\n```');
    expect(markInlineCode('A normal sentence. Another one, with Capitals.')).toBe(
      'A normal sentence. Another one, with Capitals.'
    );
  });
});
