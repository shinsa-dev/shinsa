import { markInlineCode } from '@shinsa/core';
import { Checklist, ChecklistItem, ChecklistMark } from '@shinsa/ui/components/checklist';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import renderMarkdown, { type Components, defaultUrlTransform, type ExtraProps } from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import rehypeSlug from 'rehype-slug';
import remarkGfm from 'remark-gfm';
import { ReferenceAnchor, ReferenceLabel, useReferenceMarkdown } from '@/components/links/reference.tsx';
import { CodeFence } from '@/components/text/code-fence.tsx';
import { isRunnableFence } from '@/lib/code/block.ts';
import { useMediaUrl } from '@/lib/connection/socket.ts';
import { createCache } from '@/lib/format/cache.ts';
import { isTaskItemDone, isTaskList, isTaskListItem } from '@/lib/format/checklist.ts';
import { isReferenceHref, transformUrl } from '@/lib/tasks/references.ts';

const REMARK_PLUGINS = [remarkGfm];

const FILE_REHYPE_PLUGINS = [rehypeRaw, rehypeSlug, rehypeSanitize];

const PARSED_LIMIT = 400;

const INLINE_ELEMENTS = ['code', 'strong', 'em', 'a', 'del'];

function readFenceMeta(node: ExtraProps['node']) {
  const code = node?.children[0];
  return code?.type === 'element' ? code.data?.meta : null;
}

function readFence(node: ExtraProps['node'], children: React.ReactNode) {
  const element = React.Children.toArray(children)[0];
  if (!React.isValidElement<{ className?: string; children?: React.ReactNode }>(element)) return null;
  const language = element.props.className?.match(/language-([\w+#.-]+)/)?.[1] ?? null;
  return {
    language,
    runnable: isRunnableFence(readFenceMeta(node)),
    code: String(element.props.children ?? '').replace(/\n$/, ''),
  };
}

function ExternalLink({ href, children }: { href?: string; children?: React.ReactNode }) {
  return (
    <a href={href} target='_blank' rel='noreferrer'>
      {children}
    </a>
  );
}

function TaskList({ className, children }: { className?: string; children?: React.ReactNode }) {
  return <Checklist className={cn(className, 'gap-1')}>{children}</Checklist>;
}

const BLOCK_COMPONENTS: Components = {
  ul: ({ className, children }) =>
    isTaskList(className) ? (
      <TaskList className={className}>{children}</TaskList>
    ) : (
      <ul className={className}>{children}</ul>
    ),
  ol: ({ className, children, start }) =>
    isTaskList(className) ? (
      <TaskList className={className}>{children}</TaskList>
    ) : (
      <ol className={className} start={start}>
        {children}
      </ol>
    ),
  li: ({ node, className, children }) => {
    if (!isTaskListItem(className)) return <li className={className}>{children}</li>;
    const done = isTaskItemDone(node);
    return (
      <ChecklistItem
        done={done}
        check={<ChecklistMark done={done} />}
        className={cn(className, '[&>[data-slot=checklist-check]]:h-[1lh]')}
      >
        <div>{children}</div>
      </ChecklistItem>
    );
  },
  input: () => null,
  a: ({ href, children }) =>
    isReferenceHref(href) ? (
      <ReferenceAnchor href={href}>{children}</ReferenceAnchor>
    ) : (
      <ExternalLink href={href}>{children}</ExternalLink>
    ),
  pre: ({ node, children }) => {
    const fence = readFence(node, children);
    return fence ? (
      <CodeFence code={fence.code} language={fence.language} runnable={fence.runnable} />
    ) : (
      <pre>{children}</pre>
    );
  },
};

const INLINE_COMPONENTS: Components = {
  a: ({ href, children }) =>
    isReferenceHref(href) ? (
      <ReferenceLabel href={href}>{children}</ReferenceLabel>
    ) : (
      <span className='font-medium text-fg-4'>{children}</span>
    ),
};

const LINKED_INLINE_COMPONENTS: Components = {
  a: BLOCK_COMPONENTS.a,
};

const blocks = createCache<React.ReactElement>(PARSED_LIMIT);

const inlines = createCache<React.ReactElement>(PARSED_LIMIT);

const linkedInlines = createCache<React.ReactElement>(PARSED_LIMIT);

const FILE_PARSED_LIMIT = 40;

const files = createCache<React.ReactElement>(FILE_PARSED_LIMIT);

export interface FileMarkdownLinks {
  resolveImage: (src: string | undefined) => string | null;
  openLink: (href: string | undefined) => boolean;
}

const FileLinks = React.createContext<FileMarkdownLinks | null>(null);

function FileAnchor({ href, children }: { href?: string; children?: React.ReactNode }) {
  const links = React.useContext(FileLinks);
  if (href?.startsWith('#')) {
    return (
      <a
        href={href}
        onClick={(event) => {
          event.preventDefault();
          document.getElementById(`user-content-${href.slice(1)}`)?.scrollIntoView({ block: 'start' });
        }}
      >
        {children}
      </a>
    );
  }
  return (
    <a
      href={href}
      target='_blank'
      rel='noreferrer'
      onClick={(event) => {
        if (links?.openLink(href)) event.preventDefault();
      }}
    >
      {children}
    </a>
  );
}

function FileImage({ src, alt, width, height }: React.ComponentProps<'img'>) {
  const links = React.useContext(FileLinks);
  const given = typeof src === 'string' ? src : undefined;
  const local = links?.resolveImage(given) ?? null;
  const media = useMediaUrl(local ?? '');
  return <img src={local ? media : given} alt={alt ?? ''} width={width} height={height} loading='lazy' />;
}

const FILE_COMPONENTS: Components = {
  ...BLOCK_COMPONENTS,
  a: ({ href, children }) => <FileAnchor href={href}>{children}</FileAnchor>,
  img: ({ src, alt, width, height }) => <FileImage src={src} alt={alt} width={width} height={height} />,
};

function parseFile(text: string) {
  return files.read(text, () =>
    renderMarkdown({
      children: text,
      remarkPlugins: REMARK_PLUGINS,
      rehypePlugins: FILE_REHYPE_PLUGINS,
      components: FILE_COMPONENTS,
      urlTransform: defaultUrlTransform,
    })
  );
}

function parseBlock(text: string) {
  return blocks.read(text, () =>
    renderMarkdown({
      children: markInlineCode(text),
      remarkPlugins: REMARK_PLUGINS,
      components: BLOCK_COMPONENTS,
      urlTransform: transformUrl,
    })
  );
}

function parseInline(text: string, linked: boolean) {
  return (linked ? linkedInlines : inlines).read(text, () =>
    renderMarkdown({
      children: markInlineCode(text),
      remarkPlugins: REMARK_PLUGINS,
      allowedElements: INLINE_ELEMENTS,
      unwrapDisallowed: true,
      components: linked ? LINKED_INLINE_COMPONENTS : INLINE_COMPONENTS,
      urlTransform: transformUrl,
    })
  );
}

const MarkdownBlock = React.memo(function RenderedMarkdown({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  return (
    <div className={cn('prose-shinsa min-w-0 selectable break-words', className)}>{parseBlock(text)}</div>
  );
});

export const Markdown = React.memo(function MarkdownWithReferences({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  return <MarkdownBlock text={useReferenceMarkdown(text)} className={className} />;
});

export const InlineMarkdown = React.memo(function InlineMarkdownText({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  return (
    <span className={cn('prose-shinsa min-w-0 break-words', className)}>{parseInline(text, false)}</span>
  );
});

export const LinkedInlineMarkdown = React.memo(function LinkedInlineMarkdownText({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  return (
    <span className={cn('prose-shinsa min-w-0 break-words', className)}>
      {parseInline(useReferenceMarkdown(text), true)}
    </span>
  );
});

export const FileMarkdown = React.memo(function FileMarkdownPreview({
  text,
  links,
  className,
}: {
  text: string;
  links: FileMarkdownLinks;
  className?: string;
}) {
  return (
    <FileLinks.Provider value={links}>
      <div className={cn('prose-shinsa min-w-0 selectable break-words', className)}>{parseFile(text)}</div>
    </FileLinks.Provider>
  );
});
