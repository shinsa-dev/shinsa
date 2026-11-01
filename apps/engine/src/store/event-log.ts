import { Database } from 'bun:sqlite';
import {
  type Briefing,
  briefingKey,
  EFFECT_RECOVERY,
  type EffectCancellation,
  PROCESS_BOUND_EFFECTS,
  REPLAY_SAFE_EFFECTS,
  resolveEffectKey,
  resolveEffectLane,
  type ShinsaEffect,
  type ShinsaEvent,
  type ShinsaEventInput,
  type StoredBriefing,
} from '@shinsa/core';
import { describeError } from '../log/index.ts';
import {
  type LegacyBriefingRow,
  listLegacyBriefings,
  listLegacyEventTypes,
  listLegacyRewrites,
  type ProjectBriefing,
  type StoredEventRow,
} from './legacy.ts';
import { type SnapshotRead, type SnapshotRow, type StateSnapshot, verifySnapshot } from './snapshot.ts';

interface EventRow {
  seq: number;
  at: number;
  type: string;
  payload: string;
}

export interface UnreadableEvent {
  seq: number;
  type: string;
  error: string;
}

export interface EventRead {
  events: ShinsaEvent[];
  unreadable: UnreadableEvent[];
  lastSeq: number;
}

interface EffectRow {
  id: number;
  key: string;
  lane: string;
  kind: string;
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
  key: string;
  kind: string;
  status: string;
  attempts: number;
}

export interface CancelledEffect {
  id: number;
  key: string;
  running: boolean;
}

type ReceiptStatus = 'accepted' | 'rejected';

export interface CommandReceipt {
  id: string;
  type: string;
  target: string;
  fingerprint: string;
  status: ReceiptStatus;
  code: string | null;
  error: string | null;
  firstSeq: number;
  lastSeq: number;
  at: number;
}

type ReceiptInput = Pick<CommandReceipt, 'id' | 'type' | 'target' | 'fingerprint'>;

export interface CommandCommit {
  events: ShinsaEventInput[];
  effects: ShinsaEffect[];
  cancellations: EffectCancellation[];
  fromSeq: number;
  at: number;
  receipt: ReceiptInput | null;
}

export interface Reconciled {
  requeued: number;
  cancelled: CancelledEffect[];
  failed: number;
}

interface ReceiptRow {
  id: string;
  type: string;
  target: string;
  fingerprint: string;
  status: ReceiptStatus;
  code: string | null;
  error: string | null;
  first_seq: number;
  last_seq: number;
  at: number;
}

export const SETTLED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

const SEED_STRIDE = 1000;

const LOG_VERSION = 14;

const BRIEFING_EVENT = 'briefing.written';

const REQUEUED = 'Requeued after the previous server process ended.';

const ENDED_WITH_PROCESS = 'Cancelled because the server process ended before the effect finished.';

const UNKNOWN_KIND = 'Shinsa does not know this kind of effect; another version wrote it.';

function parseEventPayload(payload: string, type: string): ShinsaEventInput | string {
  let value: unknown;
  try {
    value = JSON.parse(payload);
  } catch (error) {
    return `The stored event is not valid JSON: ${describeError(error)}`;
  }
  if (!value || typeof value !== 'object' || (value as { type?: unknown }).type !== type) {
    return 'The stored event does not match its type.';
  }
  return value as ShinsaEventInput;
}

function parseEffectPayload(row: EffectRow): ShinsaEffect | string {
  let value: unknown;
  try {
    value = JSON.parse(row.payload);
  } catch (error) {
    return `The stored effect is not valid JSON: ${describeError(error)}`;
  }
  if (!value || typeof value !== 'object' || (value as { kind?: unknown }).kind !== row.kind) {
    return 'The stored effect does not match its kind.';
  }
  return value as ShinsaEffect;
}

function parseStoredBriefing(payload: string): ProjectBriefing | null {
  try {
    const value = JSON.parse(payload) as Record<string, unknown> | null;
    if (typeof value?.text !== 'string' || typeof value.at !== 'number') return null;
    const projectId = typeof value.projectId === 'string' ? value.projectId : null;
    const briefing =
      value.briefing && typeof value.briefing === 'object' ? (value.briefing as Briefing) : null;
    return { projectId, stored: { text: value.text, at: value.at, briefing } };
  } catch {
    return null;
  }
}

function listPlaceholders(values: readonly unknown[]) {
  return values.map(() => '?').join(', ');
}

function serializeReceipt(row: ReceiptRow): CommandReceipt {
  return {
    id: row.id,
    type: row.type,
    target: row.target,
    fingerprint: row.fingerprint,
    status: row.status,
    code: row.code,
    error: row.error,
    firstSeq: row.first_seq,
    lastSeq: row.last_seq,
    at: row.at,
  };
}

interface LegacyView {
  rewrites: Map<number, StoredEventRow>;
  briefings: ProjectBriefing[];
}

export class EventLog {
  readonly #db: Database;
  #legacy: LegacyView | null = null;

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
    this.#db.run(
      `CREATE TABLE IF NOT EXISTS receipts (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        target TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        status TEXT NOT NULL,
        code TEXT,
        error TEXT,
        first_seq INTEGER NOT NULL,
        last_seq INTEGER NOT NULL,
        at INTEGER NOT NULL
      )`
    );
    this.#db.run('CREATE INDEX IF NOT EXISTS receipts_at ON receipts (at)');
    this.#db.run(
      `CREATE TABLE IF NOT EXISTS snapshots (
        seq INTEGER PRIMARY KEY,
        version TEXT NOT NULL,
        anchor TEXT NOT NULL,
        checksum TEXT NOT NULL,
        problems TEXT NOT NULL,
        payload TEXT NOT NULL,
        at INTEGER NOT NULL
      )`
    );
    this.#db.run(
      'CREATE TABLE IF NOT EXISTS briefings (project TEXT PRIMARY KEY, at INTEGER NOT NULL, payload TEXT NOT NULL)'
    );
    this.#db.run('CREATE TABLE IF NOT EXISTS seq_floor (seq INTEGER NOT NULL)');
  }

  #selectLastSeq() {
    return (
      this.#db
        .query<{ seq: number }, []>(
          'SELECT MAX(COALESCE((SELECT MAX(seq) FROM events), 0), COALESCE((SELECT MAX(seq) FROM seq_floor), 0)) AS seq'
        )
        .get()?.seq ?? 0
    );
  }

  #readRows(rows: EventRow[]): EventRead {
    const events: ShinsaEvent[] = [];
    const unreadable: UnreadableEvent[] = [];
    for (const stored of rows) {
      if (this.#legacy && stored.type === BRIEFING_EVENT) continue;
      const row = { ...stored, ...this.#legacy?.rewrites.get(stored.seq) };
      const parsed = parseEventPayload(row.payload, row.type);
      if (typeof parsed === 'string') unreadable.push({ seq: row.seq, type: row.type, error: parsed });
      else events.push({ ...parsed, seq: row.seq, at: row.at });
    }
    return { events, unreadable, lastSeq: rows.at(-1)?.seq ?? 0 };
  }

  readEvents(after = 0): EventRead {
    const read = this.#readRows(
      this.#db
        .query<EventRow, [number]>('SELECT seq, at, type, payload FROM events WHERE seq > ? ORDER BY seq')
        .all(after)
    );
    return { ...read, lastSeq: Math.max(read.lastSeq, after, this.#selectLastSeq()) };
  }

  #resolveAnchor(seq: number) {
    const row = this.#db
      .query<EventRow, [number]>(
        'SELECT seq, at, type, payload FROM events WHERE seq <= ? ORDER BY seq DESC LIMIT 1'
      )
      .get(seq);
    return row ? Bun.hash(`${row.seq}|${row.at}|${row.type}|${row.payload}`).toString(36) : '';
  }

  writeSnapshot(snapshot: StateSnapshot, at: number) {
    const anchor = this.#resolveAnchor(snapshot.seq);
    if (snapshot.seq > 0 && anchor === '') return false;
    this.#db.transaction(() => {
      this.#db.run('DELETE FROM snapshots');
      this.#db.run(
        'INSERT INTO snapshots (seq, version, anchor, checksum, problems, payload, at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [
          snapshot.seq,
          snapshot.version,
          anchor,
          Bun.hash(snapshot.payload).toString(36),
          JSON.stringify(snapshot.problems),
          snapshot.payload,
          at,
        ]
      );
    })();
    return true;
  }

  selectSnapshot(version: string): SnapshotRead | null {
    if (this.#legacy) return null;
    const row = this.#db
      .query<SnapshotRow, []>(
        'SELECT seq, version, anchor, checksum, problems, payload FROM snapshots ORDER BY seq DESC LIMIT 1'
      )
      .get();
    if (!row) return null;
    return verifySnapshot(row, { version, anchor: this.#resolveAnchor(row.seq) });
  }

  #selectLogVersion() {
    return this.#db.query<{ user_version: number }, []>('PRAGMA user_version').get()?.user_version ?? 0;
  }

  replaceLegacyEvents() {
    const version = this.#selectLogVersion();
    if (version >= LOG_VERSION) return 0;
    return this.#db.transaction(() => {
      const changed = this.#rewriteLegacyRows(version) + this.#moveLegacyBriefings();
      if (changed > 0) this.#db.run('DELETE FROM snapshots');
      this.#db.run(`PRAGMA user_version = ${LOG_VERSION}`);
      return changed;
    })();
  }

  applyLegacyView() {
    const version = this.#selectLogVersion();
    if (version >= LOG_VERSION) return 0;
    const rewrites = this.#listLegacyRows(version);
    const briefingRows = this.#listLegacyBriefingRows();
    const changed = rewrites.length + briefingRows.length;
    if (changed === 0) return 0;
    this.#legacy = {
      rewrites: new Map(rewrites.map((row) => [row.seq, row])),
      briefings: listLegacyBriefings(briefingRows),
    };
    return changed;
  }

  #listLegacyRows(version: number) {
    const types = listLegacyEventTypes(version);
    const rows = this.#db
      .query<EventRow, string[]>(
        `SELECT seq, at, type, payload FROM events WHERE type IN (${listPlaceholders(types)}) ORDER BY seq`
      )
      .all(...types);
    return listLegacyRewrites(rows);
  }

  #rewriteLegacyRows(version: number) {
    const update = this.#db.prepare('UPDATE events SET type = ?, payload = ? WHERE seq = ?');
    const rewrites = this.#listLegacyRows(version);
    for (const row of rewrites) update.run(row.type, row.payload, row.seq);
    return rewrites.length;
  }

  #listLegacyBriefingRows() {
    return this.#db
      .query<LegacyBriefingRow, [string]>('SELECT seq, at, payload FROM events WHERE type = ? ORDER BY seq')
      .all(BRIEFING_EVENT);
  }

  #moveLegacyBriefings() {
    const rows = this.#listLegacyBriefingRows();
    if (rows.length === 0) return 0;
    for (const { projectId, stored } of listLegacyBriefings(rows)) this.writeBriefing(projectId, stored);
    this.#db.run('INSERT INTO seq_floor (seq) VALUES (?)', [this.#selectLastSeq()]);
    this.#db.run('DELETE FROM events WHERE type = ?', [BRIEFING_EVENT]);
    this.#db.run("DELETE FROM receipts WHERE type = 'briefing.write'");
    return rows.length;
  }

  listBriefings(): ProjectBriefing[] {
    const rows = this.#db
      .query<{ payload: string }, []>('SELECT payload FROM briefings ORDER BY project')
      .all();
    const stored = rows.flatMap((row) => {
      const briefing = parseStoredBriefing(row.payload);
      return briefing ? [briefing] : [];
    });
    const legacy = this.#legacy?.briefings ?? [];
    if (legacy.length === 0) return stored;
    const keys = new Set(legacy.map((briefing) => briefingKey(briefing.projectId)));
    return [...stored.filter((briefing) => !keys.has(briefingKey(briefing.projectId))), ...legacy];
  }

  writeBriefing(projectId: string | null, stored: StoredBriefing) {
    this.#db.run(
      `INSERT INTO briefings (project, at, payload) VALUES (?, ?, ?)
       ON CONFLICT (project) DO UPDATE SET at = excluded.at, payload = excluded.payload`,
      [briefingKey(projectId), stored.at, JSON.stringify({ projectId, ...stored })]
    );
  }

  listEventsBetween(firstSeq: number, lastSeq: number): ShinsaEvent[] {
    const rows = this.#db
      .query<EventRow, [number, number]>(
        'SELECT seq, at, type, payload FROM events WHERE seq BETWEEN ? AND ? ORDER BY seq'
      )
      .all(firstSeq, lastSeq);
    return this.#readRows(rows).events;
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

  #cancel(cancellation: EffectCancellation, at: number): CancelledEffect[] {
    const rows = this.#db
      .query<{ id: number; key: string; status: string }, string[]>(
        `SELECT id, key, status FROM effects
         WHERE status IN ('pending', 'running') AND kind IN (${listPlaceholders(cancellation.kinds)})
           AND json_extract(payload, '$.taskId') = ?
         ORDER BY id`
      )
      .all(...cancellation.kinds, cancellation.taskId);
    const update = this.#db.prepare(
      "UPDATE effects SET status = 'cancelled', settled_at = ?, last_error = ? WHERE id = ?"
    );
    for (const row of rows) update.run(at, cancellation.reason, row.id);
    return rows.map((row) => ({ id: row.id, key: row.key, running: row.status === 'running' }));
  }

  commitCommand(input: CommandCommit): { events: ShinsaEvent[]; cancelled: CancelledEffect[] } {
    const insertEvent = this.#db.prepare('INSERT INTO events (seq, at, type, payload) VALUES (?, ?, ?, ?)');
    const insertEffect = this.#db.prepare(
      `INSERT INTO effects (key, lane, kind, payload, status, available_at, created_at)
       VALUES (?, ?, ?, ?, 'pending', ?, ?) ON CONFLICT (key) DO NOTHING`
    );
    const events = input.events.map((event, index) => ({
      ...event,
      seq: input.fromSeq + index + 1,
      at: input.at,
    }));
    return this.#db.transaction(() => {
      for (const event of events) {
        const { seq: _seq, at: _at, ...payload } = event;
        insertEvent.run(event.seq, event.at, event.type, JSON.stringify(payload));
      }
      const cancelled = input.cancellations.flatMap((cancellation) => this.#cancel(cancellation, input.at));
      const seed = this.#resolveSeed(events);
      input.effects.forEach((effect, index) => {
        insertEffect.run(
          resolveEffectKey(effect, seed + index),
          resolveEffectLane(effect),
          effect.kind,
          JSON.stringify(effect),
          input.at,
          input.at
        );
      });
      if (input.receipt) {
        this.#insertReceipt({
          ...input.receipt,
          status: 'accepted',
          code: null,
          error: null,
          firstSeq: input.fromSeq + 1,
          lastSeq: input.fromSeq + events.length,
          at: input.at,
        });
      }
      return { events, cancelled };
    })();
  }

  #insertReceipt(receipt: CommandReceipt) {
    this.#db
      .prepare(
        `INSERT INTO receipts (id, type, target, fingerprint, status, code, error, first_seq, last_seq, at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING`
      )
      .run(
        receipt.id,
        receipt.type,
        receipt.target,
        receipt.fingerprint,
        receipt.status,
        receipt.code,
        receipt.error,
        receipt.firstSeq,
        receipt.lastSeq,
        receipt.at
      );
  }

  recordReceipt(receipt: CommandReceipt) {
    this.#insertReceipt(receipt);
  }

  selectReceipt(id: string): CommandReceipt | null {
    const row = this.#db.query<ReceiptRow, [string]>('SELECT * FROM receipts WHERE id = ?').get(id);
    return row ? serializeReceipt(row) : null;
  }

  claimEffects(now: number): StoredEffect[] {
    const select = this.#db.query<EffectRow, [number]>(
      `SELECT e.id, e.key, e.lane, e.kind, e.payload, e.attempts FROM effects e
       WHERE e.status = 'pending' AND e.available_at <= ?
         AND NOT EXISTS (
           SELECT 1 FROM effects o WHERE o.lane = e.lane AND (
             o.status = 'running' OR (o.status = 'pending' AND o.id < e.id)
           )
         )
       ORDER BY e.id`
    );
    const claim = this.#db.prepare(
      "UPDATE effects SET status = 'running', attempts = attempts + 1 WHERE id = ?"
    );
    const damaged = this.#db.prepare(
      "UPDATE effects SET status = 'failed', settled_at = ?, last_error = ? WHERE id = ?"
    );
    return this.#db.transaction(() => {
      const claimed: StoredEffect[] = [];
      for (let rows = select.all(now); rows.length > 0; rows = select.all(now)) {
        for (const row of rows) {
          const effect = parseEffectPayload(row);
          if (typeof effect === 'string') {
            damaged.run(now, effect, row.id);
            continue;
          }
          claim.run(row.id);
          claimed.push({ id: row.id, key: row.key, lane: row.lane, effect, attempts: row.attempts + 1 });
        }
      }
      return claimed;
    })();
  }

  #finish(id: number, sql: string, values: (string | number | null)[]) {
    return this.#db.prepare(`${sql} WHERE id = ? AND status = 'running'`).run(...values, id).changes > 0;
  }

  settleEffect(id: number, now: number) {
    return this.#finish(id, "UPDATE effects SET status = 'done', settled_at = ?, last_error = NULL", [now]);
  }

  retryEffect(id: number, availableAt: number, error: string) {
    return this.#finish(id, "UPDATE effects SET status = 'pending', available_at = ?, last_error = ?", [
      availableAt,
      error,
    ]);
  }

  failEffect(id: number, now: number, error: string) {
    return this.#finish(id, "UPDATE effects SET status = 'failed', settled_at = ?, last_error = ?", [
      now,
      error,
    ]);
  }

  selectEffectStatus(key: string): string | null {
    const row = this.#db
      .query<{ status: string }, [string]>('SELECT status FROM effects WHERE key = ?')
      .get(key);
    return row?.status ?? null;
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
    return this.#db
      .query<EffectStatus, []>('SELECT key, kind, status, attempts FROM effects ORDER BY id')
      .all();
  }

  reconcileAfterRestart(now: number): Reconciled {
    const known = Object.keys(EFFECT_RECOVERY);
    const bound = [...PROCESS_BOUND_EFFECTS];
    const safe = [...REPLAY_SAFE_EFFECTS];
    return this.#db.transaction(() => {
      const failed = this.#db.run(
        `UPDATE effects SET status = 'failed', settled_at = ?, last_error = ?
         WHERE status IN ('pending', 'running') AND kind NOT IN (${listPlaceholders(known)})`,
        [now, UNKNOWN_KIND, ...known]
      ).changes;
      const cancelled = this.#db
        .query<{ id: number; key: string; status: string }, string[]>(
          `SELECT id, key, status FROM effects
           WHERE status IN ('pending', 'running') AND kind IN (${listPlaceholders(bound)}) ORDER BY id`
        )
        .all(...bound)
        .map((row) => ({ id: row.id, key: row.key, running: row.status === 'running' }));
      const cancel = this.#db.prepare(
        "UPDATE effects SET status = 'cancelled', settled_at = ?, last_error = ? WHERE id = ?"
      );
      for (const effect of cancelled) cancel.run(now, ENDED_WITH_PROCESS, effect.id);
      const requeued = this.#db.run(
        `UPDATE effects SET status = 'pending', available_at = ?, last_error = ?
         WHERE status = 'running' AND kind IN (${listPlaceholders(safe)})`,
        [now, REQUEUED, ...safe]
      ).changes;
      this.#db.run("DELETE FROM effects WHERE status IN ('done', 'cancelled') AND settled_at < ?", [
        now - SETTLED_RETENTION_MS,
      ]);
      this.#db.run('DELETE FROM receipts WHERE at < ?', [now - SETTLED_RETENTION_MS]);
      return { requeued, cancelled, failed };
    })();
  }

  close() {
    this.#db.close();
  }
}
