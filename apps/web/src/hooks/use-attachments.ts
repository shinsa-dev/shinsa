import { toast } from '@shinsa/ui/components/sonner';
import * as React from 'react';
import {
  type AttachmentDraft,
  listReadyAttachments,
  resolveAcceptedFiles,
  resolveDraftKind,
} from '@/lib/chat/attachment-drafts.ts';
import {
  resolveTaskDraft,
  subscribeTaskDrafts,
  taskDraftFiles,
  updateTaskDraft,
} from '@/lib/chat/task-drafts.ts';
import { listTransferFiles, requestAttachmentUpload } from '@/lib/connection/attachments.ts';
import { describeFailure } from '@/lib/connection/commands.ts';

function useDraftPreviews(drafts: AttachmentDraft[], files: Map<string, File>) {
  const [previews, setPreviews] = React.useState<ReadonlyMap<string, string>>(new Map());
  const uploadingKeys = drafts
    .filter((draft) => draft.kind === 'image' && draft.stored === null)
    .map((draft) => draft.key)
    .join(' ');

  React.useLayoutEffect(() => {
    const made = new Map<string, string>();
    for (const key of uploadingKeys.split(' ')) {
      const file = files.get(key);
      if (file) made.set(key, URL.createObjectURL(file));
    }
    setPreviews(made);
    return () => {
      for (const url of made.values()) URL.revokeObjectURL(url);
    };
  }, [uploadingKeys, files]);

  return React.useMemo(
    () =>
      drafts.map((draft) => ({
        ...draft,
        preview:
          draft.kind === 'image' && draft.stored ? draft.stored.url : (previews.get(draft.key) ?? null),
      })),
    [drafts, previews]
  );
}

type HeldChange = (current: AttachmentDraft[]) => AttachmentDraft[];

const NO_DRAFTS: AttachmentDraft[] = [];

function useHeldAttachments(draftKey: string | undefined) {
  const [local, setLocal] = React.useState<AttachmentDraft[]>(NO_DRAFTS);
  const localFiles = React.useRef(new Map<string, File>()).current;
  const shared = React.useSyncExternalStore(subscribeTaskDrafts, () =>
    draftKey === undefined ? NO_DRAFTS : resolveTaskDraft(draftKey).attachments
  );
  const setShared = React.useCallback(
    (change: HeldChange) => {
      if (draftKey === undefined) return;
      updateTaskDraft(draftKey, (draft) => ({ attachments: change(draft.attachments) }));
    },
    [draftKey]
  );
  if (draftKey === undefined) return { held: local, setHeld: setLocal, files: localFiles };
  return { held: shared, setHeld: setShared, files: taskDraftFiles };
}

export function useAttachments(draftKey?: string) {
  const { held, setHeld, files } = useHeldAttachments(draftKey);
  const latest = React.useRef(held);
  latest.current = held;
  const drafts = useDraftPreviews(held, files);

  const remove = React.useCallback(
    (key: string) => {
      files.delete(key);
      setHeld((current) => current.filter((draft) => draft.key !== key));
    },
    [files, setHeld]
  );

  const upload = React.useCallback(
    async (key: string, file: File) => {
      try {
        const stored = await requestAttachmentUpload(file);
        setHeld((current) => current.map((draft) => (draft.key === key ? { ...draft, stored } : draft)));
      } catch (error) {
        toast.error(`Couldn’t attach ${file.name || 'the file'}: ${describeFailure(error)}`);
        remove(key);
      }
    },
    [remove, setHeld]
  );

  const add = React.useCallback(
    (picked: File[]) => {
      if (picked.length === 0) return;
      const { accepted, refusal } = resolveAcceptedFiles(picked, latest.current.length);
      if (refusal) toast.error(refusal);
      const added = accepted.map((file) => ({
        file,
        draft: {
          key: crypto.randomUUID(),
          name: file.name || 'Pasted image',
          kind: resolveDraftKind(file),
          mimeType: file.type || null,
          size: file.size,
          preview: null,
          stored: null,
        } satisfies AttachmentDraft,
      }));
      for (const { file, draft } of added) files.set(draft.key, file);
      setHeld((current) => [...current, ...added.map((entry) => entry.draft)]);
      for (const { file, draft } of added) void upload(draft.key, file);
    },
    [files, setHeld, upload]
  );

  const clear = React.useCallback(() => {
    for (const draft of latest.current) files.delete(draft.key);
    setHeld(() => []);
  }, [files, setHeld]);

  const addTransfer = React.useCallback(
    (transfer: DataTransfer | null) => {
      const picked = listTransferFiles(transfer);
      add(picked);
      return picked.length > 0;
    },
    [add]
  );

  return { drafts, ready: listReadyAttachments(drafts), add, addTransfer, remove, clear };
}

export type Attachments = ReturnType<typeof useAttachments>;
