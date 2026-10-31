import { describe, expect, test } from 'bun:test';
import {
  isSlackPreviewRequest,
  listSlackPreviewPosts,
  SLACK_BLOCK_LIMITS,
  SLACK_PREVIEW_REACTIONS,
  SLACK_REACTIONS,
  serializeSlackPreviewIntro,
} from '../../src/index.ts';

const ORIGIN = 'https://app.shinsa.dev';

const CONNECT = 'https://app.shinsa.dev/slack/connect?instance=k3x9';

describe('the preview of every post', () => {
  test('answers only “preview posts”, in any case', () => {
    expect(isSlackPreviewRequest('preview posts')).toBe(true);
    expect(isSlackPreviewRequest('  Preview posts. ')).toBe(true);
    expect(isSlackPreviewRequest('preview posts for the export bug')).toBe(false);
    expect(isSlackPreviewRequest('')).toBe(false);
  });

  test('has one sample of every post, each within Slack’s limits, linking to the app', () => {
    const posts = listSlackPreviewPosts(ORIGIN, CONNECT);
    expect(posts.map((post) => post.name)).toContain('Not connected (only the sender sees it)');
    expect(posts.length).toBe(15);
    for (const { message } of posts) {
      expect(message.text.length).toBeGreaterThan(0);
      expect(message.blocks.length).toBeLessThanOrEqual(SLACK_BLOCK_LIMITS.blocks);
      for (const block of message.blocks)
        expect(block.text.text.length).toBeLessThanOrEqual(SLACK_BLOCK_LIMITS.section);
    }
    const all = posts
      .map(({ message }) => message.blocks.map((block) => block.text.text).join('\n'))
      .join('\n');
    expect(all).toContain(`<${CONNECT}|Connect Slack>`);
    expect(all).toContain('|PR #128>');
    expect(all).toContain('```');
  });

  test('opens with the list of what follows, and steps the reaction through each state in order', () => {
    const posts = listSlackPreviewPosts(ORIGIN, CONNECT);
    const intro = serializeSlackPreviewIntro(posts).blocks[0]?.text.text ?? '';
    expect(intro).toStartWith('*Every post Shinsa makes in a thread*');
    expect(intro).toContain('1.  Status: sizing up the work');
    expect(SLACK_PREVIEW_REACTIONS).toEqual([
      SLACK_REACTIONS.sizing,
      SLACK_REACTIONS.working,
      SLACK_REACTIONS.needsYou,
      SLACK_REACTIONS.done,
    ]);
  });
});
