import type { ShinsaState, TeamEscalation } from '@shinsa/core';
import type { NotificationPreferences } from '@/lib/preferences/notifications.ts';
import { type DecisionNotice, listNewDecisions, listOpenNoticeTags } from './attention.ts';
import { shouldAlert } from './sounds.ts';

interface AttentionAlerts {
  preferences: () => NotificationPreferences;
  play: (soundId: NotificationPreferences['soundId'], count: number) => void;
  notify: (notice: DecisionNotice) => void;
  dismiss: (tag: string) => void;
  quiet: (notice: DecisionNotice) => boolean;
}

export class AttentionWatcher {
  readonly #alerts: AttentionAlerts;
  #seen: Set<string> | null = null;

  constructor(alerts: AttentionAlerts) {
    this.#alerts = alerts;
  }

  observe(state: ShinsaState, escalations: readonly TeamEscalation[] = []) {
    const now = Date.now();
    const open = listOpenNoticeTags(state, escalations);
    for (const tag of this.#seen ?? []) if (!open.has(tag)) this.#alerts.dismiss(tag);
    const fresh = listNewDecisions(this.#seen, state, now, escalations).filter(
      (notice) => !this.#alerts.quiet(notice)
    );
    this.#seen = open;
    if (fresh.length === 0) return;
    const preferences = this.#alerts.preferences();
    if (shouldAlert(preferences.sound, document)) this.#alerts.play(preferences.soundId, fresh.length);
    if (!shouldAlert(preferences.notify, document)) return;
    for (const notice of fresh) this.#alerts.notify(notice);
  }
}
