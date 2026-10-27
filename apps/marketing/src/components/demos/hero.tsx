import * as React from 'react';
import { HomePage } from '@/routes/home.tsx';
import { createHomeScene } from '../../lib/scene.ts';
import { DemoRoot, Window } from './frame.tsx';
import { useLiveElements } from './live.ts';

function swallow(event: React.SyntheticEvent) {
  event.preventDefault();
  event.stopPropagation();
}

function removeLinks(root: HTMLElement) {
  for (const link of root.querySelectorAll('a[href]')) link.removeAttribute('href');
}

function listBriefingLinks(root: HTMLElement) {
  return [...root.querySelectorAll('[data-smart], button.decoration-dotted')];
}

function useNoLinks(ref: React.RefObject<HTMLDivElement | null>) {
  React.useEffect(() => {
    const root = ref.current;
    if (!root) return;
    removeLinks(root);
    const observer = new MutationObserver(() => removeLinks(root));
    observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['href'] });
    return () => observer.disconnect();
  }, [ref]);
}

export function HeroDemo() {
  const [state] = React.useState(() => createHomeScene(Date.now()));
  const ref = useLiveElements<HTMLDivElement>(listBriefingLinks);
  useNoLinks(ref);
  return (
    <DemoRoot>
      <div
        ref={ref}
        className='demo-static demo-hero relative h-full'
        onClickCapture={swallow}
        onPointerDownCapture={swallow}
        onMouseDownCapture={swallow}
        onKeyDownCapture={swallow}
        onFocusCapture={(event) => {
          if (event.target instanceof HTMLElement) event.target.blur();
        }}
      >
        <Window state={state} route={{ name: 'home' }}>
          <HomePage state={state} />
        </Window>
        <div className='pointer-events-none absolute inset-x-0 bottom-0 h-40 rounded-b-2xl bg-linear-to-t from-background to-transparent' />
      </div>
    </DemoRoot>
  );
}
