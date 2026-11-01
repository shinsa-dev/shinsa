import { describe, expect, test } from 'bun:test';
import {
  PREVIEW_GONE,
  PREVIEW_OFFLINE,
  PREVIEW_PAGES,
  PREVIEW_RETRY_SECONDS,
  PREVIEW_STOPPED,
  serializePreviewPage,
} from '../../src/remote/preview-page.ts';

describe('the preview page', () => {
  test('a link that no longer works says so under the Shinsa mark, and never reloads', () => {
    const page = serializePreviewPage('gone');
    expect(page.startsWith('<!doctype html>')).toBe(true);
    expect(page).toContain(`<h1>${PREVIEW_PAGES.gone.title}</h1><p>${PREVIEW_GONE}</p></div>`);
    expect(page).toContain('<a href="https://shinsa.dev">');
    expect(page).toContain('<meta name="robots" content="noindex">');
    expect(page).not.toContain('http-equiv="refresh"');
  });

  test('a stopped service and an offline machine reload by themselves until the preview is back', () => {
    for (const [kind, description] of [
      ['stopped', PREVIEW_STOPPED],
      ['offline', PREVIEW_OFFLINE],
    ] as const) {
      const page = serializePreviewPage(kind);
      expect(page).toContain(`<p>${description}</p>`);
      expect(page).toContain(`<meta http-equiv="refresh" content="${PREVIEW_RETRY_SECONDS}">`);
      expect(page).toContain(`<title>${PREVIEW_PAGES[kind].title} · Shinsa</title>`);
    }
  });

  test('follows the light or dark appearance of the device', () => {
    expect(serializePreviewPage('gone')).toContain('@media (prefers-color-scheme:dark)');
  });
});
