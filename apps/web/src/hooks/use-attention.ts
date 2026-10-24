import { type ShinsaState, selectTaskByReference } from '@shinsa/core';
import * as React from 'react';
import { useMinute } from '@/hooks/use-minute.ts';
import { useDesktopConnected } from '@/lib/connection/socket.ts';
import { isPageQuiet, notifyDesktop } from '@/lib/desktop.ts';
import { resolvePageAttention, resolveTaskSubject } from '@/lib/notifications/attention.ts';
import { showDecisionNotification } from '@/lib/notifications/browser.ts';
import { writePageAttention } from '@/lib/notifications/page.ts';
import { playSound } from '@/lib/notifications/sounds.ts';
import { AttentionWatcher } from '@/lib/notifications/watcher.ts';
import { readNotificationPreferences } from '@/lib/preferences/notifications.ts';
import { navigate, resolveTaskPath, resolveTaskTarget } from '@/router.ts';

export function useAttention(state: ShinsaState, taskReference: string | null = null) {
  useMinute();
  const quiet = isPageQuiet(useDesktopConnected());
  const { status, badge } = resolvePageAttention(state, Date.now());
  const subject = resolveTaskSubject(taskReference ? selectTaskByReference(state, taskReference) : null);
  const latest = React.useRef(state);
  latest.current = state;
  const latestQuiet = React.useRef(quiet);
  latestQuiet.current = quiet;
  const [watcher] = React.useState(
    () =>
      new AttentionWatcher({
        preferences: readNotificationPreferences,
        play: (soundId, count) => void playSound(soundId, count),
        quiet: () => latestQuiet.current,
        notify: (notice) => {
          const path = resolveTaskPath(resolveTaskTarget(latest.current, notice.taskId));
          if (notifyDesktop({ title: notice.title, body: notice.body, tag: notice.gateId, path })) return;
          showDecisionNotification(notice, (taskId) =>
            navigate(resolveTaskPath(resolveTaskTarget(latest.current, taskId)))
          );
        },
      })
  );
  React.useEffect(() => {
    watcher.observe(state);
  }, [watcher, state]);
  React.useLayoutEffect(() => {
    writePageAttention({ status, badge }, subject);
  }, [status, badge, subject]);
}
