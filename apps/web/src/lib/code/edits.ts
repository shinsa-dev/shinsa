import { diff } from '@codemirror/merge';
import { resolveEditRefusal, type Task, type TaskRefs, WORKING_REF } from '@shinsa/core';

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
  if (refusal) return { editable: false, reason: refusal };
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

export interface SaverState {
  saving: boolean;
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
  #timer: ReturnType<typeof setTimeout> | null = null;
  #saving: Promise<void> | null = null;
  #again = false;
  #reloads: { previous: string | null; next: string | null }[] = [];
  #state: SaverState = { saving: false, notice: null, refusal: null };
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
    this.#timer = setTimeout(() => {
      this.#timer = null;
      void this.#save();
    }, this.#options.delayMs ?? 600);
    if (this.#state.notice) this.#update({ notice: null });
  }

  async flush() {
    if (this.#timer) {
      this.#cancelTimer();
      await this.#save();
    }
    while (this.#saving !== null) await this.#saving;
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
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
  }

  #update(patch: Partial<SaverState>) {
    this.#state = { ...this.#state, ...patch };
    this.#options.onState(this.#state);
  }

  #save(): Promise<void> {
    if (this.#saving !== null) {
      this.#again = true;
      return this.#saving;
    }
    const text = this.#options.read();
    if (text === this.#disk) return Promise.resolve();
    this.#update({ saving: true });
    this.#saving = this.#write(text).finally(() => {
      this.#saving = null;
      this.#update({ saving: false });
      for (const { previous, next } of this.#reloads.splice(0)) this.reload(previous, next);
      if (!this.#again) return;
      this.#again = false;
      void this.#save();
    });
    return this.#saving;
  }

  async #write(text: string) {
    const base = this.#disk;
    try {
      const result = await this.#options.save(text, base);
      if (result.kind === 'saved') {
        this.#disk = text;
        this.#options.onSaved(text);
      } else {
        this.#absorb(base, result.content);
      }
    } catch (error) {
      this.#update({ refusal: error instanceof Error ? error.message : String(error) });
    }
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
