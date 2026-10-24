import { describe, expect, it } from 'bun:test';
import { render } from '@testing-library/react';
import { Icon } from '../../src/components/icon';
import { ICON_PATHS } from '../../src/components/icon/paths';

function markup(inner: string) {
  const probe = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  probe.innerHTML = inner;
  return probe.innerHTML;
}

describe('Icon', () => {
  it('is decorative by default and draws in its text colour a step under the text', () => {
    const svg = render(<Icon name='IconBell' />).container.querySelector('svg') as SVGElement;
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('role')).toBeNull();
    expect(svg.classList.contains('opacity-(--icon-alpha)')).toBe(true);
    expect(svg.innerHTML).toContain('currentColor');
    expect(svg.getAttribute('width')).toBe('24');
  });

  it('lets a reveal or a swap replace the icon alpha with its own opacity', () => {
    const svg = render(<Icon name='IconBell' className='size-3 opacity-0' />).container.querySelector(
      'svg'
    ) as SVGElement;
    expect(svg.classList.contains('opacity-0')).toBe(true);
    expect(svg.classList.contains('opacity-(--icon-alpha)')).toBe(false);
  });

  it('becomes a named image with a label', () => {
    const view = render(<Icon name='IconBell' ariaLabel='Notifications' size={16} />);
    const svg = view.getByRole('img', { name: 'Notifications' });
    expect(svg.getAttribute('aria-hidden')).toBeNull();
    expect(svg.getAttribute('width')).toBe('16');
  });

  it('draws chevrons square-cornered and everything else at the default radius', () => {
    const chevron = render(<Icon name='IconChevronDownMedium' />).container.querySelector(
      'svg'
    ) as SVGElement;
    expect(chevron.innerHTML).toBe(markup(ICON_PATHS.IconChevronDownMedium['0'] as string));
    const bell = render(<Icon name='IconBell' />).container.querySelector('svg') as SVGElement;
    expect(bell.innerHTML).toBe(markup(ICON_PATHS.IconBell['3'] as string));
  });

  it('falls back to the default radius when a radius was never generated', () => {
    const svg = render(<Icon name='IconBell' radius='1' />).container.querySelector('svg') as SVGElement;
    expect(svg.innerHTML).toBe(markup(ICON_PATHS.IconBell['3'] as string));
  });
});
