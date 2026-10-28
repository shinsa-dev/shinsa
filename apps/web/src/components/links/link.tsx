import { Icon, type IconName } from '@shinsa/ui/components/icon';
import { cn } from '@shinsa/ui/lib/utils';
import type * as React from 'react';
import { navigate } from '@/router.ts';

const LINK_UNDERLINE =
  'underline decoration-transparent underline-offset-3 group-hover/link:decoration-fg-a3 group-active/link:decoration-fg-a3';

export const SMART_LINK = 'group/link cursor-pointer font-medium text-fg-4 no-underline outline-none';

export const INLINE_TILE = 'relative -top-px me-1 align-middle';

export const INLINE_MARK = 'relative -top-px me-1 inline align-middle';

export function InlineMark({ icon, className }: { icon: IconName; className?: string }) {
  return <Icon size='sm' name={icon} className={cn(INLINE_MARK, className)} />;
}

export function GlyphLabel({
  glyph,
  text,
  className,
}: {
  glyph: React.ReactNode;
  text: string;
  className?: string;
}) {
  const split = text.indexOf(' ');
  const first = split < 0 ? text : text.slice(0, split);
  const rest = split < 0 ? '' : text.slice(split);
  return (
    <>
      <span className='whitespace-nowrap'>
        {glyph}
        <span className={cn(LINK_UNDERLINE, className)}>{first}</span>
      </span>
      {rest && <span className={cn(LINK_UNDERLINE, className)}>{rest}</span>}
    </>
  );
}

function openInApp(event: React.MouseEvent, path: string) {
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
  event.preventDefault();
  navigate(path);
}

export function InAppLink({
  path,
  onClick,
  ...props
}: Omit<React.ComponentProps<'a'>, 'href'> & { path: string }) {
  return (
    <a
      data-smart
      href={path}
      {...props}
      onClick={(event) => {
        onClick?.(event);
        openInApp(event, path);
      }}
    />
  );
}
