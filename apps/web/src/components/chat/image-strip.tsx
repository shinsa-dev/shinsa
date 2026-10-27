import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { INSET } from '@/components/layout/surface/card.ts';
import { Hint } from '@/components/overlays/hint.tsx';
import { ImageViewer } from '@/components/overlays/image-viewer.tsx';
import { useImageViewer, type ViewerImage } from '@/hooks/use-image-viewer.ts';
import { describeOpenImage } from '@/lib/image-view.ts';

const THUMB_SIZE = {
  sm: 'h-24',
  lg: 'max-h-80',
};

function ImageThumb({
  image,
  size,
  onOpen,
  onBroken,
  originRef,
}: {
  image: ViewerImage;
  size: keyof typeof THUMB_SIZE;
  onOpen: () => void;
  onBroken: () => void;
  originRef: (element: HTMLElement | null) => void;
}) {
  const label = describeOpenImage(image);
  return (
    <Hint label={label}>
      <button
        type='button'
        onClick={onOpen}
        aria-label={label}
        className={cn(
          INSET,
          'max-w-full cursor-zoom-in overflow-hidden bg-bg-a1 hover:border-fg-a1 active:border-fg-a1'
        )}
      >
        <img
          ref={originRef}
          src={image.src}
          alt={image.caption ?? ''}
          loading='lazy'
          decoding='async'
          onError={onBroken}
          className={cn('block h-auto w-auto max-w-full object-contain', THUMB_SIZE[size])}
        />
      </button>
    </Hint>
  );
}

export function ImageStrip({
  images,
  size = 'sm',
  className,
}: {
  images: (string | ViewerImage)[];
  size?: keyof typeof THUMB_SIZE;
  className?: string;
}) {
  const [broken, setBroken] = React.useState<string[]>([]);
  const viewer = useImageViewer();
  const shown = React.useMemo(
    () =>
      images
        .map((image) => (typeof image === 'string' ? { src: image } : image))
        .filter((image) => !broken.includes(image.src)),
    [images, broken]
  );
  if (shown.length === 0) return null;
  return (
    <div className={cn('flex min-w-0 flex-wrap gap-2', className)}>
      {shown.map((image, index) => (
        <ImageThumb
          // biome-ignore lint/suspicious/noArrayIndexKey: the same image can appear twice in one strip
          key={`${index}-${image.src}`}
          image={image}
          size={size}
          onOpen={() => viewer.show(index)}
          onBroken={() => setBroken((current) => [...current, image.src])}
          originRef={viewer.recordOrigin(index)}
        />
      ))}
      <ImageViewer images={shown} viewer={viewer} />
    </div>
  );
}
