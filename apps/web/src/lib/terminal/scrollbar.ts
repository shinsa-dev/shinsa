const SCROLLABLE = '.xterm-scrollable-element';

function isInside(rect: DOMRect, event: MouseEvent) {
  return (
    rect.width > 0 &&
    event.clientX >= rect.left &&
    event.clientX <= rect.right &&
    event.clientY >= rect.top &&
    event.clientY <= rect.bottom
  );
}

export function followScrollbarHover(root: HTMLElement) {
  const ours = new WeakSet<Event>();
  let over = false;

  const tell = (type: 'mouseover' | 'mouseleave') => {
    const event = new MouseEvent(type);
    ours.add(event);
    root.querySelector(SCROLLABLE)?.dispatchEvent(event);
  };
  const hold = (event: Event) => {
    if (!ours.has(event)) event.stopPropagation();
  };
  const follow = (event: MouseEvent) => {
    const bar = root.querySelector(`${SCROLLABLE} > .scrollbar.vertical`);
    const inside = bar ? isInside(bar.getBoundingClientRect(), event) : false;
    if (inside === over) return;
    over = inside;
    tell(inside ? 'mouseover' : 'mouseleave');
  };
  const leave = () => {
    if (!over) return;
    over = false;
    tell('mouseleave');
  };

  root.addEventListener('mouseover', hold, true);
  root.addEventListener('mousemove', follow);
  root.addEventListener('mouseleave', leave);
  return () => {
    root.removeEventListener('mouseover', hold, true);
    root.removeEventListener('mousemove', follow);
    root.removeEventListener('mouseleave', leave);
  };
}
