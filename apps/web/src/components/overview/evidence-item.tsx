import type { Evidence } from '@shinsa/core';
import { Icon } from '@shinsa/ui/components/icon';
import { Truncate } from '@shinsa/ui/components/truncate';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { ImageViewer } from '@/components/overlays/image-viewer.tsx';
import { useEvidenceText } from '@/hooks/use-evidence-text.ts';
import { useImageViewer } from '@/hooks/use-image-viewer.ts';
import { resolveEvidenceKind } from '@/lib/overview/evidence.ts';

function TextEvidence({ uri }: { uri: string }) {
  const text = useEvidenceText(uri);
  return (
    <pre className='corner-superellipse/1.125 max-h-64 overflow-auto rounded-control bg-bg-2 px-2.5 py-2 font-mono text-2xs text-fg-3'>
      {text ?? 'Loading…'}
    </pre>
  );
}

function EvidenceImage({ evidence }: { evidence: Evidence }) {
  const images = React.useMemo(() => [{ src: evidence.uri, caption: evidence.title }], [evidence]);
  const viewer = useImageViewer();
  return (
    <>
      <button
        type='button'
        onClick={() => viewer.show(0)}
        aria-label={`Open ${evidence.title}`}
        className='corner-superellipse/1.125 block cursor-zoom-in overflow-hidden rounded-lg bg-bg-2'
      >
        <img
          ref={viewer.recordOrigin(0)}
          src={evidence.uri}
          alt={evidence.title}
          className='max-h-96 w-full object-contain'
        />
      </button>
      <ImageViewer images={images} viewer={viewer} />
    </>
  );
}

function EvidenceBody({ evidence }: { evidence: Evidence }) {
  switch (resolveEvidenceKind(evidence.uri)) {
    case 'image':
      return <EvidenceImage evidence={evidence} />;
    case 'video':
      return (
        // biome-ignore lint/a11y/useMediaCaption: agent recordings have no captions
        <video
          src={evidence.uri}
          controls
          className='corner-superellipse/1.125 max-h-96 w-full rounded-lg bg-bg-2'
        />
      );
    case 'text':
      return <TextEvidence uri={evidence.uri} />;
    case 'file':
    case 'link':
      return (
        <a
          href={evidence.uri}
          target='_blank'
          rel='noreferrer'
          className='corner-superellipse/1.125 flex h-7 items-center gap-2 rounded-control bg-bg-2 px-2.5 text-fg-4 text-xs transition-colors duration-150 hover:bg-bg-3 active:bg-bg-3'
        >
          <Icon name='IconArrowUpRight' className='size-3.5 shrink-0' />
          <Truncate>{evidence.uri}</Truncate>
        </a>
      );
  }
}

export function EvidenceItem({ evidence }: { evidence: Evidence }) {
  return (
    <figure
      className={cn(
        'flex min-w-0 flex-col gap-1.5',
        resolveEvidenceKind(evidence.uri) === 'text' && 'sm:col-span-2'
      )}
    >
      <EvidenceBody evidence={evidence} />
      <figcaption className='text-2xs text-fg-2'>{evidence.title}</figcaption>
    </figure>
  );
}
