import type { Task } from '@shinsa/core';
import * as React from 'react';
import { FileMarkdown, type FileMarkdownLinks } from '@/components/text/markdown.tsx';
import { resolveFileLink, resolveImagePath } from '@/lib/code/markdown.ts';
import { resolveRawUrl } from '@/lib/connection/code.ts';

export function MarkdownPreview({
  task,
  gitRef,
  path,
  text,
  onOpen,
}: {
  task: Task;
  gitRef: string;
  path: string;
  text: string;
  onOpen: (path: string, line: number | null) => void;
}) {
  const opener = React.useRef(onOpen);
  opener.current = onOpen;
  const links = React.useMemo<FileMarkdownLinks>(
    () => ({
      resolveImage: (src) => {
        const image = resolveImagePath(path, src);
        return image ? resolveRawUrl(task.id, gitRef, image) : null;
      },
      openLink: (href) => {
        const link = resolveFileLink(path, href);
        if (link) opener.current(link.path, link.line);
        return link !== null;
      },
    }),
    [task.id, gitRef, path]
  );
  return (
    <article aria-label={`Preview of ${path}`} className='min-h-0 flex-1 overflow-auto'>
      <FileMarkdown text={text} links={links} className='prose-document mx-auto max-w-3xl px-6 py-5' />
    </article>
  );
}
