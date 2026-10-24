import { type ShinsaState, selectTaskByReference } from '@shinsa/core';
import * as React from 'react';
import { useMinute } from '@/hooks/use-minute.ts';
import { resolvePageAttention, resolveTaskSubject } from '@/lib/notifications/attention.ts';
import { showDecisionNotification } from '@/lib/notifications/browser.ts';
import { writePageAttention } from '@/lib/notifications/page.ts';
import { playSound } from '@/lib/notifications/sounds.ts';
import { AttentionWatcher } from '@/lib/notifications/watcher.ts';
import { readNotificationPreferences } from '@/lib/preferences/notifications.ts';
import { navigate, resolveTaskPath, resolveTaskTarget } from '@/router.ts';

export function useAttention(state: ShinsaState, taskReference: string | null = null) {
  useMinute();
  const { status, badge } = resolvePageAttention(state, Date.now());
  const subject = resolveTaskSubject(taskReference ? selectTaskByReference(state, taskReference) : null);
  const latest = React.useRef(state);
  latest.current = state;
  const [watcher] = React.useState(
    () =>
      new AttentionWatcher({
        preferences: readNotificationPreferences,
        play: (soundId, count) => void playSound(soundId, count),
        notify: (notice) =>
          showDecisionNotification(notice, (taskId) =>
            navigate(resolveTaskPath(resolveTaskTarget(latest.current, taskId)))
          ),
      })
  );
  React.useEffect(() => {
    watcher.observe(state);
  }, [watcher, state]);
  React.useLayoutEffect(() => {
    writePageAttention({ status, badge }, subject);
  }, [status, badge, subject]);
}
