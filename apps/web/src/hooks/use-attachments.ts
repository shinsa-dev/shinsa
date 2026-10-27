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

function revokePreview(draft: AttachmentDraft) {
  if (draft.preview) URL.revokeObjectURL(draft.preview);
}

export function useAttachments() {
  const [drafts, setDrafts] = React.useState<AttachmentDraft[]>([]);
  const latest = React.useRef(drafts);
  latest.current = drafts;

  React.useEffect(() => () => latest.current.forEach(revokePreview), []);

  const remove = React.useCallback((key: string) => {
    setDrafts((current) => {
      const gone = current.find((draft) => draft.key === key);
      if (gone) revokePreview(gone);
      return current.filter((draft) => draft.key !== key);
    });
  }, []);

  const upload = React.useCallback(
    async (key: string, file: File) => {
      try {
        const stored = await requestAttachmentUpload(file);
        setDrafts((current) => current.map((draft) => (draft.key === key ? { ...draft, stored } : draft)));
      } catch (error) {
        toast.error(`Couldn’t attach ${file.name || 'the file'}: ${describeFailure(error)}`);
        remove(key);
      }
    },
    [remove]
  );

  const add = React.useCallback(
    (files: File[]) => {
      if (files.length === 0) return;
      const { accepted, refusal } = resolveAcceptedFiles(files, latest.current.length);
      if (refusal) toast.error(refusal);
      const added = accepted.map((file) => {
        const kind = resolveDraftKind(file);
        return {
          file,
          draft: {
            key: crypto.randomUUID(),
            name: file.name || 'Pasted image',
            kind,
            preview: kind === 'image' ? URL.createObjectURL(file) : null,
            stored: null,
          } satisfies AttachmentDraft,
        };
      });
      setDrafts((current) => [...current, ...added.map((entry) => entry.draft)]);
      for (const { file, draft } of added) void upload(draft.key, file);
    },
    [upload]
  );

  const clear = React.useCallback(() => {
    setDrafts((current) => {
      current.forEach(revokePreview);
      return [];
    });
  }, []);

  const addTransfer = React.useCallback(
    (transfer: DataTransfer | null) => {
      const files = listTransferFiles(transfer);
      add(files);
      return files.length > 0;
    },
    [add]
  );

  return { drafts, ready: listReadyAttachments(drafts), add, addTransfer, remove, clear };
}

export type Attachments = ReturnType<typeof useAttachments>;
