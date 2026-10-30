import { describe, expect, it } from 'bun:test';
import { parseNotice, resolveNotificationSettingsUrl } from '../../src/lib/notice.ts';

const NOTICE = { title: 'Fix login', body: 'Which colour?', tag: 'g-1', path: '/tasks/LOC-4' };

describe('parseNotice', () => {
  it('takes a notification the page asks for', () => {
    expect(parseNotice(NOTICE)).toEqual(NOTICE);
    expect(parseNotice({ ...NOTICE, title: '  Fix login ', path: null })).toEqual({
      ...NOTICE,
      path: null,
    });
  });

  it('cuts long text to one line’s worth', () => {
    const notice = parseNotice({
      ...NOTICE,
      title: 'a'.repeat(300),
      body: 'b'.repeat(300),
      tag: 'c'.repeat(300),
    });
    expect(notice?.title).toHaveLength(120);
    expect(notice?.title.endsWith('…')).toBe(true);
    expect(notice?.body).toHaveLength(240);
    expect(notice?.tag).toHaveLength(120);
  });

  it('refuses anything that is not a notification for a page on the server', () => {
    expect(parseNotice(null)).toBeNull();
    expect(parseNotice('Fix login')).toBeNull();
    expect(parseNotice({ ...NOTICE, title: ' ' })).toBeNull();
    expect(parseNotice({ ...NOTICE, body: 3 })).toBeNull();
    expect(parseNotice({ ...NOTICE, tag: '' })).toBeNull();
    expect(parseNotice({ ...NOTICE, path: 'https://evil.example/' })).toBeNull();
    expect(parseNotice({ ...NOTICE, path: undefined })).toBeNull();
  });
});

describe('resolveNotificationSettingsUrl', () => {
  it('opens the app’s own pane in System Settings → Notifications', () => {
    expect(resolveNotificationSettingsUrl('studio.overclock.shinsa')).toBe(
      'x-apple.systempreferences:com.apple.Notifications-Settings.extension?id=studio.overclock.shinsa'
    );
  });
});
