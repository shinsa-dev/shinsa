import { type ShinsaState, selectTaskByReference } from '@shinsa/core';
import * as React from 'react';
import { useMinute } from '@/hooks/use-minute.ts';
import { connection, useDesktopConnected } from '@/lib/connection/socket.ts';
import { isAlertQuiet, notifyDesktop, subscribeDesktopNotifyFailed } from '@/lib/desktop.ts';
import { resolvePageAttention, resolveTaskSubject } from '@/lib/notifications/attention.ts';
import { dismissDecisionNotification, showDecisionNotification } from '@/lib/notifications/browser.ts';
import { writePageAttention } from '@/lib/notifications/page.ts';
import { watchPresence } from '@/lib/notifications/presence.ts';
import { showNotifyBlocked } from '@/lib/notifications/settings.ts';
import { playSound } from '@/lib/notifications/sounds.ts';
import { AttentionWatcher } from '@/lib/notifications/watcher.ts';
import { showNotificationWelcome } from '@/lib/notifications/welcome.ts';
import { readNotificationPreferences } from '@/lib/preferences/notifications.ts';
import { navigate, resolveTaskPath, resolveTaskTarget, withRouteBase } from '@/router.ts';

export function useAttention(state: ShinsaState, taskReference: string | null = null) {
  useMinute();
  const desktopConnected = useDesktopConnected();
  const { status, badge } = resolvePageAttention(state, Date.now());
  const subject = resolveTaskSubject(taskReference ? selectTaskByReference(state, taskReference) : null);
  const latest = React.useRef(state);
  latest.current = state;
  const latestDesktop = React.useRef(desktopConnected);
  latestDesktop.current = desktopConnected;
  const [watcher] = React.useState(
    () =>
      new AttentionWatcher({
        preferences: readNotificationPreferences,
        play: (soundId, count) => void playSound(soundId, count),
        quiet: (notice) => isAlertQuiet(connection.selectAttention(notice.taskId), latestDesktop.current),
        dismiss: (gateId) => dismissDecisionNotification(gateId),
        notify: (notice) => {
          const path = resolveTaskPath(resolveTaskTarget(latest.current, notice.taskId));
          if (notifyDesktop({ title: notice.title, body: notice.body, tag: notice.gateId, path })) return;
          showDecisionNotification(notice, withRouteBase(path), navigate);
        },
      })
  );
  React.useEffect(() => {
    watcher.observe(state);
  }, [watcher, state]);
  React.useEffect(() => subscribeDesktopNotifyFailed(showNotifyBlocked), []);
  React.useEffect(() => watchPresence(() => connection.reportPresence()), []);
  React.useEffect(() => {
    showNotificationWelcome();
  }, []);
  React.useLayoutEffect(() => {
    writePageAttention({ status, badge }, subject);
  }, [status, badge, subject]);
}
