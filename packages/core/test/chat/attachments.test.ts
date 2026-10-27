import { describe, expect, test } from 'bun:test';
import { type StoredAttachment, serializeAttachments, splitMessageAttachments } from '../../src/index.ts';

const SCREENSHOT: StoredAttachment = {
  kind: 'image',
  name: 'Screen "one" & <two>.png',
  url: '/api/attachments/01a/screen.png',
  path: '/data/attachments/01a/screen.png',
  mimeType: 'image/png',
  size: 2048,
};

const NOTES: StoredAttachment = {
  kind: 'file',
  name: 'notes.txt',
  url: '/api/attachments/01b/notes.txt',
  path: '/data/attachments/01b/notes.txt',
  mimeType: null,
  size: null,
};

describe('serializeAttachments', () => {
  test('appends one block after the text, with the path for the agent and the url for the browser', () => {
    expect(serializeAttachments('  Look at this  ', [NOTES])).toBe(
      'Look at this\n\n<attachments>\n<attachment kind="file" display_name="notes.txt" path="/data/attachments/01b/notes.txt" url="/api/attachments/01b/notes.txt" />\n</attachments>'
    );
  });

  test('leaves text without attachments as it is, and a message of attachments alone is just the block', () => {
    expect(serializeAttachments(' Only words ', [])).toBe('Only words');
    expect(serializeAttachments('', [NOTES]).startsWith('<attachments>')).toBe(true);
  });

  test('round-trips through splitMessageAttachments, escaped names included', () => {
    const { path: _screenshotPath, ...screenshot } = SCREENSHOT;
    const { path: _notesPath, ...notes } = NOTES;
    expect(splitMessageAttachments(serializeAttachments('Fix the header', [SCREENSHOT, NOTES]))).toEqual({
      text: 'Fix the header',
      attachments: [screenshot, notes],
    });
  });
});

describe('splitMessageAttachments', () => {
  test('reads Kanna blocks, falling back from url to path to project_path', () => {
    const { text, attachments } = splitMessageAttachments(
      'Before\n\n\n<kanna-attachments><attachment mime="image/jpeg" project_path="src/a.jpg" size="0"/><attachment name="b" path="/b"/><attachment kind="file"/></kanna-attachments>\n\n\nAfter'
    );
    expect(text).toBe('Before\n\nAfter');
    expect(attachments).toEqual([
      { kind: 'image', name: 'a.jpg', url: 'src/a.jpg', mimeType: 'image/jpeg', size: null },
      { kind: 'file', name: 'b', url: '/b', mimeType: null, size: null },
    ]);
  });

  test('decodes entities and leaves text without a block alone', () => {
    expect(
      splitMessageAttachments(
        '<attachments><attachment path="/a&amp;b &#39;c&#39; &copy;.png" /></attachments>'
      )
    ).toEqual({
      text: '',
      attachments: [
        { kind: 'file', name: "a&b 'c' &copy;.png", url: "/a&b 'c' &copy;.png", mimeType: null, size: null },
      ],
    });
    expect(splitMessageAttachments(' plain ')).toEqual({ text: 'plain', attachments: [] });
  });
});
