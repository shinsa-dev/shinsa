import { markInlineCode } from '@shinsa/core';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import renderMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ReferenceAnchor, ReferenceLabel, useReferenceMarkdown } from '@/components/links/reference.tsx';
import { CodeFence } from '@/components/text/code-fence.tsx';
import { isRunnableFence } from '@/lib/code/block.ts';
import { createCache } from '@/lib/format/cache.ts';
import { isReferenceHref, transformUrl } from '@/lib/tasks/references.ts';

const REMARK_PLUGINS = [remarkGfm];

const PARSED_LIMIT = 400;

const INLINE_ELEMENTS = ['code', 'strong', 'em', 'a', 'del'];

function readFence(children: React.ReactNode) {
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

const BLOCK_COMPONENTS: Components = {
  a: ({ href, children }) =>
    isReferenceHref(href) ? (
      <ReferenceAnchor href={href}>{children}</ReferenceAnchor>
    ) : (
      <ExternalLink href={href}>{children}</ExternalLink>
    ),
  pre: ({ children }) => {
    const fence = readFence(children);
    return fence ? <CodeFence code={fence.code} language={fence.language} /> : <pre>{children}</pre>;
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

const blocks = createCache<React.ReactElement>(PARSED_LIMIT);

const inlines = createCache<React.ReactElement>(PARSED_LIMIT);

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

function parseInline(text: string) {
  return inlines.read(text, () =>
    renderMarkdown({
      children: markInlineCode(text),
      remarkPlugins: REMARK_PLUGINS,
      allowedElements: INLINE_ELEMENTS,
      unwrapDisallowed: true,
      components: INLINE_COMPONENTS,
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
    <div className={cn('prose-shinsa selectable min-w-0 break-words', className)}>{parseBlock(text)}</div>
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
  return <span className={cn('prose-shinsa min-w-0 break-words', className)}>{parseInline(text)}</span>;
});
