import { Badge } from '@shinsa/ui/components/badge';
import { Icon } from '@shinsa/ui/components/icon';
import { cn } from '@shinsa/ui/lib/utils';
import { INSET } from '@/components/layout/surface/card.ts';
import type { useImageViewer } from '@/hooks/use-image-viewer.ts';
import { useNearViewport } from '@/hooks/use-near-viewport.ts';
import { describeEvidenceCaption, describeEvidencePart, type EvidenceView } from '@/lib/evidence/layout.ts';

const FRAME = `${INSET} block aspect-[16/10] w-full overflow-hidden bg-bg-2`;

type Viewer = ReturnType<typeof useImageViewer>;

function VideoThumbnail({
  src,
  label,
  index,
  viewer,
}: {
  src: string;
  label: string;
  index: number;
  viewer: Viewer;
}) {
  const { near, ref } = useNearViewport<HTMLButtonElement>();
  return (
    <button
      ref={ref}
      type='button'
      onClick={() => viewer.show(index)}
      aria-label={`Play ${label}`}
      className={cn(FRAME, 'group/video relative cursor-pointer')}
    >
      {near && (
        <video
          ref={viewer.recordOrigin(index)}
          src={src}
          muted
          playsInline
          preload='metadata'
          aria-hidden
          className='size-full object-contain'
        />
      )}
      <span className='absolute inset-0 grid place-items-center'>
        <span className='grid size-10 place-items-center rounded-full bg-black/55 text-white backdrop-blur-sm group-hover/video:bg-black/70 group-active/video:bg-black/70'>
          <Icon size='lg' name='IconPlay' />
        </span>
      </span>
    </button>
  );
}

function EvidenceMedia({ view, viewer }: { view: EvidenceView; viewer: Viewer }) {
  const { evidence } = view;
  const index = view.image ?? 0;
  const label = [
    describeEvidenceCaption({ title: evidence.title, facts: view.facts }),
    (evidence.stage || evidence.label) && describeEvidencePart(evidence),
  ]
    .filter(Boolean)
    .join(' · ');
  if (view.media === 'video') {
    return <VideoThumbnail src={evidence.uri} label={label} index={index} viewer={viewer} />;
  }
  return (
    <button
      type='button'
      onClick={() => viewer.show(index)}
      aria-label={`Open ${label}`}
      className={cn(FRAME, 'cursor-zoom-in')}
    >
      <img
        ref={viewer.recordOrigin(index)}
        src={evidence.uri}
        alt={evidence.title}
        decoding='async'
        loading='lazy'
        className='size-full object-contain'
      />
    </button>
  );
}

export function ReviewMark() {
  return (
    <Badge size='sm' variant='purple'>
      From the agent review
    </Badge>
  );
}

export function UpdatedMark({ text }: { text: string }) {
  return <span className='shrink-0 text-2xs text-fg-2'>{text}</span>;
}

export function EvidenceFigure({
  view,
  viewer,
  label = 'full',
  showDetail = true,
}: {
  view: EvidenceView;
  viewer: Viewer;
  label?: 'part' | 'full';
  showDetail?: boolean;
}) {
  const { evidence } = view;
  return (
    <figure className='flex min-w-0 flex-col gap-1.5'>
      <EvidenceMedia view={view} viewer={viewer} />
      <figcaption className='flex min-w-0 flex-col gap-px'>
        {label === 'part' ? (
          <span className='font-medium text-2xs text-fg-4'>{describeEvidencePart(evidence)}</span>
        ) : (
          <>
            <span className='flex min-w-0 items-center gap-1.5'>
              <span className='min-w-0 font-medium text-fg-4 text-xs'>{evidence.title}</span>
              {view.fromReview && <ReviewMark />}
              {view.updated && <UpdatedMark text={view.updated} />}
            </span>
            {view.facts && <span className='text-2xs text-fg-2'>{view.facts}</span>}
          </>
        )}
        {showDetail && evidence.detail && <span className='text-2xs text-fg-3'>{evidence.detail}</span>}
      </figcaption>
    </figure>
  );
}
