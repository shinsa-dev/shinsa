import { afterEach, describe, expect, it } from 'bun:test';
import { followScrollbarHover } from '@/lib/terminal/scrollbar.ts';

const BAR = { left: 786, right: 800, top: 0, bottom: 400, width: 14, height: 400 };

function createTerminalElement(bar = BAR) {
  const root = document.createElement('div');
  root.innerHTML =
    '<div class="xterm-scrollable-element"><div class="xterm-screen"></div><div class="scrollbar vertical"></div></div>';
  const scrollable = root.querySelector('.xterm-scrollable-element') as HTMLElement;
  const screen = root.querySelector('.xterm-screen') as HTMLElement;
  const strip = root.querySelector('.scrollbar.vertical') as HTMLElement;
  strip.getBoundingClientRect = () => ({ ...bar, x: bar.left, y: bar.top, toJSON: () => bar }) as DOMRect;
  document.body.append(root);
  const heard: string[] = [];
  scrollable.addEventListener('mouseover', () => heard.push('over'));
  scrollable.addEventListener('mouseleave', () => heard.push('leave'));
  return { root, screen, heard };
}

function moveTo(root: HTMLElement, clientX: number, clientY = 200) {
  root.dispatchEvent(new MouseEvent('mousemove', { clientX, clientY }));
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('followScrollbarHover', () => {
  it('shows the scrollbar only while the pointer is on its strip, as the app’s own scrollbars do', () => {
    const { root, screen, heard } = createTerminalElement();
    const stop = followScrollbarHover(root);
    screen.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    moveTo(root, 400);
    expect(heard).toEqual([]);
    moveTo(root, 790);
    moveTo(root, 795);
    expect(heard).toEqual(['over']);
    moveTo(root, 400);
    expect(heard).toEqual(['over', 'leave']);
    moveTo(root, 799);
    root.dispatchEvent(new MouseEvent('mouseleave'));
    root.dispatchEvent(new MouseEvent('mouseleave'));
    expect(heard).toEqual(['over', 'leave', 'over', 'leave']);
    stop();
    screen.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    moveTo(root, 790);
    expect(heard).toEqual(['over', 'leave', 'over', 'leave', 'over']);
  });

  it('does nothing before xterm has drawn its scrollbar', () => {
    const root = document.createElement('div');
    document.body.append(root);
    followScrollbarHover(root);
    expect(() => moveTo(root, 790)).not.toThrow();
  });

  it('ignores a strip with no width', () => {
    const { root, heard } = createTerminalElement({ ...BAR, width: 0 });
    followScrollbarHover(root);
    moveTo(root, 790);
    expect(heard).toEqual([]);
  });
});
