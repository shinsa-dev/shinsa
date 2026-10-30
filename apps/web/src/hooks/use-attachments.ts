import { toast } from '@shinsa/ui/components/sonner';
import * as React from 'react';
import {
  type AttachmentDraft,
  listReadyAttachments,
  resolveAcceptedFiles,
  resolveDraftKind,
} from '@/lib/chat/attachment-drafts.ts';
import { listTransferFiles, requestAttachmentUpload } from '@/lib/connection/attachments.ts';
import { describeFailure } from '@/lib/connection/commands.ts';

function useDraftPreviews(drafts: AttachmentDraft[], files: Map<string, File>) {
  const [previews, setPreviews] = React.useState<ReadonlyMap<string, string>>(new Map());
  const imageKeys = drafts
    .filter((draft) => draft.kind === 'image')
    .map((draft) => draft.key)
    .join(' ');

  React.useLayoutEffect(() => {
    const made = new Map<string, string>();
    for (const key of imageKeys.split(' ')) {
      const file = files.get(key);
      if (file) made.set(key, URL.createObjectURL(file));
    }
    setPreviews(made);
    return () => {
      for (const url of made.values()) URL.revokeObjectURL(url);
    };
  }, [imageKeys, files]);

  return React.useMemo(
    () => drafts.map((draft) => ({ ...draft, preview: previews.get(draft.key) ?? null })),
    [drafts, previews]
  );
}

export function useAttachments() {
  const [held, setHeld] = React.useState<AttachmentDraft[]>([]);
  const files = React.useRef(new Map<string, File>()).current;
  const latest = React.useRef(held);
  latest.current = held;
  const drafts = useDraftPreviews(held, files);

  const remove = React.useCallback(
    (key: string) => {
      files.delete(key);
      setHeld((current) => current.filter((draft) => draft.key !== key));
    },
    [files]
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
    [remove]
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
    [files, upload]
  );

  const clear = React.useCallback(() => {
    files.clear();
    setHeld([]);
  }, [files]);

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
