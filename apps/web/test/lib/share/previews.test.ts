import { afterEach, describe, expect, it } from 'bun:test';
import { HOUR_MS, type PreviewShare, resolveServiceView } from '@shinsa/core';
import { act, renderHook } from '@testing-library/react';
import {
  closePreviewShareDialog,
  describePreviewEnd,
  isPreviewShared,
  openPreviewShareDialog,
  resolvePreviewShareView,
  resolvePreviewTarget,
  selectLivePreview,
  sharePreview,
  unsharePreview,
  usePreviewShareDialog,
} from '@/lib/share/previews.ts';
import { spyOnCommands } from '../../support/commands.ts';
import { createRemoteSnapshot } from '../../support/remote-access.ts';
import { createTask, NOW } from '../../support/state.ts';
import { createService } from '../../support/terminals.ts';

afterEach(() => {
  closePreviewShareDialog();
});

const URL = 'https://abc.shinsa.page/?key=k';

const SHARING: PreviewShare = { serviceId: 'web', at: 1, url: null, limit: 'until_done', endsAt: null };

const TARGET = { taskId: 't', serviceId: 'web' };

describe('the preview share dialog', () => {
  it('opens for one service of one task and closes again', () => {
    const { result } = renderHook(() => usePreviewShareDialog());
    expect(result.current).toBeNull();
    act(() => openPreviewShareDialog(TARGET));
    expect(result.current).toEqual(TARGET);
    act(() => closePreviewShareDialog());
    expect(result.current).toBeNull();
  });

  it('shares only a service that runs for a task', () => {
    const service = createService({ id: 'web' });
    expect(resolvePreviewTarget(resolveServiceView(service, null, NOW, 'fix'))).toEqual({
      taskId: 'fix',
      serviceId: 'web',
    });
    expect(resolvePreviewTarget(resolveServiceView(service, null, NOW))).toBeNull();
  });
});

describe('a preview share', () => {
  it('reads the service’s own share and drops one whose time ran out', () => {
    const task = createTask({ id: 't', previews: [{ ...SHARING, url: URL, endsAt: NOW }] });
    expect(selectLivePreview(task, 'web', NOW - 1)?.url).toBe(URL);
    expect(selectLivePreview(task, 'web', NOW)).toBeNull();
    expect(selectLivePreview(task, 'api', NOW - 1)).toBeNull();
    expect(selectLivePreview(createTask({ id: 'bare' }), 'web')).toBeNull();
  });

  it('is shared only once its link exists and has not failed', () => {
    expect(isPreviewShared(createTask({ id: 't', previews: [{ ...SHARING, url: URL }] }), 'web')).toBe(true);
    expect(isPreviewShared(createTask({ id: 't', previews: [SHARING] }), 'web')).toBe(false);
    expect(
      isPreviewShared(createTask({ id: 't', previews: [{ ...SHARING, url: URL, failure: 'no' }] }), 'web')
    ).toBe(false);
  });

  it('asks for remote access, offers sharing, waits for the link, shows it or why it failed', () => {
    const task = createTask({ id: 't' });
    const paired = createRemoteSnapshot({ paired: true });
    expect(resolvePreviewShareView(task, 'web', createRemoteSnapshot({ paired: false }))).toEqual({
      kind: 'unpaired',
    });
    expect(resolvePreviewShareView(task, 'web', paired)).toEqual({ kind: 'off' });
    expect(resolvePreviewShareView(task, 'web', null)).toEqual({ kind: 'off' });
    expect(resolvePreviewShareView({ ...task, previews: [SHARING] }, 'web', paired)).toEqual({
      kind: 'linking',
    });
    expect(resolvePreviewShareView({ ...task, previews: [{ ...SHARING, url: URL }] }, 'web', null)).toEqual({
      kind: 'shared',
      url: URL,
    });
    expect(
      resolvePreviewShareView({ ...task, previews: [{ ...SHARING, failure: 'Not paired.' }] }, 'web', null)
    ).toEqual({ kind: 'failed', message: 'Not paired.' });
  });

  it('says when sharing ends', () => {
    expect(describePreviewEnd({ ...SHARING, limit: 'hour', endsAt: NOW + HOUR_MS }, NOW)).toBe(
      'Sharing ends in 1h'
    );
    expect(describePreviewEnd(SHARING)).toBe('Sharing ends when the task is done');
    expect(describePreviewEnd({ ...SHARING, limit: 'none' })).toBe(
      'Shared until you stop it, or until the task is done'
    );
  });

  it('shares and stops sharing through the engine', async () => {
    const spy = spyOnCommands();
    await sharePreview(TARGET, 'day');
    await unsharePreview(TARGET);
    expect(spy.sent.mock.calls).toEqual([
      [{ type: 'preview.share', taskId: 't', serviceId: 'web', limit: 'day' }],
      [{ type: 'preview.unshare', taskId: 't', serviceId: 'web' }, 'Stopped sharing the preview.'],
    ]);
    spy.restore();
  });
});
