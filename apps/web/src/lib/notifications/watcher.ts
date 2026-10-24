import type { ShinsaState } from '@shinsa/core';
import type { NotificationPreferences } from '@/lib/preferences/notifications.ts';
import { type DecisionNotice, listNewDecisions, listOpenGateIds } from './attention.ts';
import { shouldAlert } from './sounds.ts';

interface AttentionAlerts {
  preferences: () => NotificationPreferences;
  play: (soundId: NotificationPreferences['soundId'], count: number) => void;
  notify: (notice: DecisionNotice) => void;
  quiet: () => boolean;
}

export class AttentionWatcher {
  readonly #alerts: AttentionAlerts;
  #seen: Set<string> | null = null;

  constructor(alerts: AttentionAlerts) {
    this.#alerts = alerts;
  }

  observe(state: ShinsaState) {
    const now = Date.now();
    const fresh = listNewDecisions(this.#seen, state, now);
    this.#seen = listOpenGateIds(state);
    if (fresh.length === 0 || this.#alerts.quiet()) return;
    const preferences = this.#alerts.preferences();
    if (shouldAlert(preferences.sound, document)) this.#alerts.play(preferences.soundId, fresh.length);
    if (!shouldAlert(preferences.notify, document)) return;
    for (const notice of fresh) this.#alerts.notify(notice);
  }
}
