import * as React from 'react';

export function isScrolledDown(scroller: Pick<HTMLElement, 'scrollTop' | 'clientHeight'>) {
  return scroller.clientHeight > 0 && scroller.scrollTop > scroller.clientHeight;
}

export function useScrolledDown(scroller: React.RefObject<HTMLElement | null>) {
  const [scrolled, replaceScrolled] = React.useState(false);
  React.useEffect(() => {
    const node = scroller.current;
    if (!node) return;
    const measure = () => replaceScrolled(isScrolledDown(node));
    measure();
    node.addEventListener('scroll', measure, { passive: true });
    return () => node.removeEventListener('scroll', measure);
  }, [scroller]);
  const scrollToTop = React.useCallback(() => {
    scroller.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, [scroller]);
  return { scrolled, scrollToTop };
}
