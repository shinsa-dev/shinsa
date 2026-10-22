import { Database } from 'bun:sqlite';
import {
  PROCESS_BOUND_EFFECTS,
  resolveEffectKey,
  resolveEffectLane,
  type ShinsaEffect,
  type ShinsaEvent,
  type ShinsaEventInput,
} from '@shinsa/core';

interface EventRow {
  seq: number;
  at: number;
  payload: string;
}

interface EffectRow {
  id: number;
  key: string;
  lane: string;
  payload: string;
  attempts: number;
}

export interface StoredEffect {
  id: number;
  key: string;
  lane: string;
  effect: ShinsaEffect;
  attempts: number;
}

export interface EffectStatus {
  kind: string;
  status: string;
  attempts: number;
}

export const SETTLED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

const SEED_STRIDE = 1000;

export class EventLog {
  readonly #db: Database;

  constructor(path: string) {
    this.#db = new Database(path, { create: true, strict: true });
    this.#db.run('PRAGMA journal_mode = WAL');
    this.#db.run('PRAGMA synchronous = NORMAL');
    this.#db.run(
      'CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY, at INTEGER NOT NULL, type TEXT NOT NULL, payload TEXT NOT NULL)'
    );
    this.#db.run(
      `CREATE TABLE IF NOT EXISTS effects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT NOT NULL UNIQUE,
        lane TEXT NOT NULL,
        kind TEXT NOT NULL,
        payload TEXT NOT NULL,
        status TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        available_at INTEGER NOT NULL,
        last_error TEXT,
        created_at INTEGER NOT NULL,
        settled_at INTEGER
      )`
    );
    this.#db.run('CREATE INDEX IF NOT EXISTS effects_open ON effects (status, lane, id)');
  }

  listEvents(): ShinsaEvent[] {
    const rows = this.#db.query<EventRow, []>('SELECT seq, at, payload FROM events ORDER BY seq').all();
    return rows.map((row) => ({
      ...(JSON.parse(row.payload) as ShinsaEventInput),
      seq: row.seq,
      at: row.at,
    }));
  }

  #resolveSeed(events: ShinsaEvent[]) {
    const last = events.at(-1);
    if (last) return last.seq * SEED_STRIDE;
    const row = this.#db
      .query<{ id: number }, []>(
        "SELECT COALESCE(MAX(seq), 0) AS id FROM sqlite_sequence WHERE name = 'effects'"
      )
      .get();
    return -((row?.id ?? 0) + 1) * SEED_STRIDE;
  }

  commit(inputs: ShinsaEventInput[], effects: ShinsaEffect[], fromSeq: number, at: number): ShinsaEvent[] {
    const insertEvent = this.#db.prepare('INSERT INTO events (seq, at, type, payload) VALUES (?, ?, ?, ?)');
    const insertEffect = this.#db.prepare(
      `INSERT INTO effects (key, lane, kind, payload, status, available_at, created_at)
       VALUES (?, ?, ?, ?, 'pending', ?, ?) ON CONFLICT (key) DO NOTHING`
    );
    const events = inputs.map((input, index) => ({ ...input, seq: fromSeq + index + 1, at }));
    this.#db.transaction(() => {
      for (const event of events) {
        const { seq: _seq, at: _at, ...payload } = event;
        insertEvent.run(event.seq, event.at, event.type, JSON.stringify(payload));
      }
      const seed = this.#resolveSeed(events);
      effects.forEach((effect, index) => {
        insertEffect.run(
          resolveEffectKey(effect, seed + index),
          resolveEffectLane(effect),
          effect.kind,
          JSON.stringify(effect),
          at,
          at
        );
      });
    })();
    return events;
  }

  claimEffects(now: number): StoredEffect[] {
    return this.#db.transaction(() => {
      const rows = this.#db
        .query<EffectRow, [number]>(
          `SELECT e.id, e.key, e.lane, e.payload, e.attempts FROM effects e
           WHERE e.status = 'pending' AND e.available_at <= ?
             AND NOT EXISTS (
               SELECT 1 FROM effects o WHERE o.lane = e.lane AND (
                 o.status = 'running' OR (o.status = 'pending' AND o.id < e.id)
               )
             )
           ORDER BY e.id`
        )
        .all(now);
      const claim = this.#db.prepare(
        "UPDATE effects SET status = 'running', attempts = attempts + 1 WHERE id = ?"
      );
      for (const row of rows) claim.run(row.id);
      return rows.map((row) => ({
        id: row.id,
        key: row.key,
        lane: row.lane,
        effect: JSON.parse(row.payload) as ShinsaEffect,
        attempts: row.attempts + 1,
      }));
    })();
  }

  settleEffect(id: number, now: number) {
    this.#db.run("UPDATE effects SET status = 'done', settled_at = ?, last_error = NULL WHERE id = ?", [
      now,
      id,
    ]);
  }

  retryEffect(id: number, availableAt: number, error: string) {
    this.#db.run("UPDATE effects SET status = 'pending', available_at = ?, last_error = ? WHERE id = ?", [
      availableAt,
      error,
      id,
    ]);
  }

  failEffect(id: number, now: number, error: string) {
    this.#db.run("UPDATE effects SET status = 'failed', settled_at = ?, last_error = ? WHERE id = ?", [
      now,
      error,
      id,
    ]);
  }

  selectNextAvailableAt(): number | null {
    const row = this.#db
      .query<{ at: number | null }, []>(
        "SELECT MIN(available_at) AS at FROM effects WHERE status = 'pending'"
      )
      .get();
    return row?.at ?? null;
  }

  listEffectStatuses(): EffectStatus[] {
    return this.#db.query<EffectStatus, []>('SELECT kind, status, attempts FROM effects ORDER BY id').all();
  }

  reconcileAfterRestart(now: number) {
    const bound = [...PROCESS_BOUND_EFFECTS];
    const placeholders = bound.map(() => '?').join(', ');
    this.#db.transaction(() => {
      this.#db.run(
        `UPDATE effects SET status = 'cancelled', settled_at = ? WHERE status IN ('pending', 'running') AND kind IN (${placeholders})`,
        [now, ...bound]
      );
      this.#db.run("UPDATE effects SET status = 'pending' WHERE status = 'running'");
      this.#db.run("DELETE FROM effects WHERE status IN ('done', 'cancelled') AND settled_at < ?", [
        now - SETTLED_RETENTION_MS,
      ]);
    })();
  }

  close() {
    this.#db.close();
  }
}
