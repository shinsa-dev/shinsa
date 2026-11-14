import { diff } from '@codemirror/merge';
import { resolveEditRefusal, type Task, type TaskRefs, WORKING_REF } from '@shinsa/core';
import { Deferred, Effect, Option } from 'effect';
import { forkApp } from '@/lib/runtime/app.ts';
import { enterPromise } from '@/lib/runtime/promise.ts';
import { scheduleAfter } from '@/lib/runtime/timers.ts';

export type FileSave = { kind: 'saved'; changed: boolean } | { kind: 'changed'; content: string | null };

export interface EditState {
  editable: boolean;
  reason: string | null;
}

export function resolveEditState(input: {
  task: Pick<Task, 'stage' | 'closedAt' | 'worktreePath'>;
  refs: Pick<TaskRefs, 'head'>;
  gitRef: string;
  headPath: string | null;
}): EditState {
  const refusal = resolveEditRefusal(input.task);
  if (Option.isSome(refusal)) return { editable: false, reason: refusal.value };
  if (input.gitRef !== input.refs.head && input.gitRef !== WORKING_REF)
    return {
      editable: false,
      reason: 'This is an earlier commit, so it is read-only. Pick Head of the branch to edit.',
    };
  if (input.headPath === null) return { editable: false, reason: null };
  return { editable: true, reason: null };
}

export function isEditedPath(task: Pick<Task, 'editedPaths'>, path: string | null) {
  return path !== null && (task.editedPaths ?? []).includes(path);
}

interface Edit {
  from: number;
  to: number;
  lines: string[];
}

const FIRST_LINE_CODE = 0x100;

const LAST_LINE_CODE = 0xd7ff;

function splitLines(text: string) {
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

function encodeLines(texts: string[][]) {
  const codes = new Map<string, string>();
  const encoded = texts.map((lines) =>
    lines
      .map((line) => {
        const known = codes.get(line);
        if (known) return known;
        const code = String.fromCharCode(FIRST_LINE_CODE + codes.size);
        codes.set(line, code);
        return code;
      })
      .join('')
  );
  return FIRST_LINE_CODE + codes.size > LAST_LINE_CODE ? null : encoded;
}

function listEdits(base: string, next: string, lines: string[]): Edit[] {
  return diff(base, next).map((change) => ({
    from: change.fromA,
    to: change.toA,
    lines: lines.slice(change.fromB, change.toB),
  }));
}

function isSameEdit(a: Edit, b: Edit) {
  return a.from === b.from && a.to === b.to && a.lines.join('') === b.lines.join('');
}

function overlaps(a: Edit, b: Edit) {
  return (a.from < b.to && b.from < a.to) || a.from === b.from || a.to === b.to;
}

export function mergeEdits(base: string, ours: string, theirs: string): string | null {
  const lines = [splitLines(base), splitLines(ours), splitLines(theirs)] as const;
  const encoded = encodeLines([...lines]);
  if (!encoded) return null;
  const [baseCodes = '', ourCodes = '', theirCodes = ''] = encoded;
  const mine = listEdits(baseCodes, ourCodes, lines[1]);
  const others = listEdits(baseCodes, theirCodes, lines[2]).filter(
    (edit) => !mine.some((own) => isSameEdit(own, edit))
  );
  if (others.some((edit) => mine.some((own) => overlaps(own, edit)))) return null;
  const merged: string[] = [];
  let at = 0;
  for (const edit of [...mine, ...others].sort((a, b) => a.from - b.from)) {
    merged.push(...lines[0].slice(at, edit.from), ...edit.lines);
    at = edit.to;
  }
  return [...merged, ...lines[0].slice(at)].join('');
}

const saved = new Map<string, { from: string; text: string }>();

function resolveSavedKey(taskId: string, path: string) {
  return `${taskId}\0${path}`;
}

export function rememberSaved(taskId: string, path: string, from: string, text: string) {
  saved.set(resolveSavedKey(taskId, path), { from, text });
}

export function selectSaved(taskId: string, path: string, from: string) {
  const entry = saved.get(resolveSavedKey(taskId, path));
  return entry?.from === from ? entry.text : null;
}

export type SaveStatus = 'clean' | 'edited' | 'saving' | 'saved';

export interface SaverState {
  status: SaveStatus;
  notice: string | null;
  refusal: string | null;
}

export interface SaverOptions {
  save: (text: string, base: string | null) => Promise<FileSave>;
  read: () => string;
  apply: (text: string) => void;
  onSaved: (text: string) => void;
  onState: (state: SaverState) => void;
  delayMs?: number;
}

export const CONFLICT_NOTICE =
  'This file changed on disk where you were typing, so it shows the new version.';

export const DELETED_NOTICE = 'This file was deleted on disk. Your next edit puts it back.';

export class FileSaver {
  #disk: string | null;
  #timer: (() => void) | null = null;
  #saving: Deferred.Deferred<void> | null = null;
  #again = false;
  #saved = false;
  #reloads: { previous: string | null; next: string | null }[] = [];
  #state: SaverState = { status: 'clean', notice: null, refusal: null };
  readonly #options: SaverOptions;

  constructor(disk: string | null, options: SaverOptions) {
    this.#disk = disk;
    this.#options = options;
  }

  get disk() {
    return this.#disk;
  }

  edit() {
    if (this.#state.refusal) return;
    this.#cancelTimer();
    this.#timer = scheduleAfter(this.#options.delayMs ?? 600, () => {
      this.#timer = null;
      this.#start();
    });
    if (this.#state.notice || this.#state.status !== 'edited')
      this.#update({ status: 'edited', notice: null });
  }

  flush() {
    return Effect.gen({ self: this }, function* () {
      if (this.#timer) {
        this.#cancelTimer();
        const started = this.#start();
        if (started) yield* Deferred.await(started);
      }
      while (this.#saving !== null) yield* Deferred.await(this.#saving);
    });
  }

  reload(previous: string | null, next: string | null) {
    if (previous === next) return;
    if (this.#saving !== null) {
      this.#reloads.push({ previous, next });
      return;
    }
    if (next !== this.#disk) this.#absorb(previous, next);
  }

  dispose() {
    this.#cancelTimer();
  }

  #cancelTimer() {
    this.#timer?.();
    this.#timer = null;
  }

  #update(patch: Partial<SaverState>) {
    this.#state = { ...this.#state, ...patch };
    this.#options.onState(this.#state);
  }

  #start() {
    if (this.#saving !== null) {
      this.#again = true;
      return this.#saving;
    }
    const text = this.#options.read();
    if (text === this.#disk) {
      if (this.#state.status === 'edited') this.#update({ status: this.#saved ? 'saved' : 'clean' });
      return null;
    }
    this.#update({ status: 'saving' });
    const saving = Deferred.makeUnsafe<void>();
    this.#saving = saving;
    forkApp(this.#write(text).pipe(Effect.ensuring(this.#finish(saving))));
    return saving;
  }

  #finish(saving: Deferred.Deferred<void>) {
    const settle = Effect.sync(() => {
      this.#saving = null;
      this.#update({ status: this.#saved && !this.#state.refusal ? 'saved' : 'clean' });
      for (const { previous, next } of this.#reloads.splice(0)) this.reload(previous, next);
      if (!this.#again) return;
      this.#again = false;
      this.#start();
    });
    return Effect.andThen(settle, Deferred.succeed(saving, undefined));
  }

  #write(text: string) {
    const base = this.#disk;
    return enterPromise(() => this.#options.save(text, base)).pipe(
      Effect.match({
        onFailure: (failed) => this.#update({ refusal: failed.message }),
        onSuccess: (result) => {
          if (result.kind === 'saved') {
            this.#disk = text;
            this.#saved = true;
            this.#options.onSaved(text);
          } else {
            this.#absorb(base, result.content);
          }
        },
      })
    );
  }

  #absorb(base: string | null, theirs: string | null) {
    const ours = this.#options.read();
    if (theirs === null) {
      this.#disk = null;
      this.#update({ notice: DELETED_NOTICE });
      return;
    }
    this.#disk = theirs;
    if (ours === theirs) return;
    const merged = mergeEdits(base ?? '', ours, theirs);
    if (merged === null) {
      this.#options.apply(theirs);
      this.#update({ notice: CONFLICT_NOTICE });
      return;
    }
    this.#options.apply(merged);
    if (merged !== theirs) this.edit();
  }
}
