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
  it('is decorative by default, takes its context’s size and draws in the icon ink', () => {
    const svg = render(<Icon name='IconBell' />).container.querySelector('svg') as SVGElement;
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('role')).toBeNull();
    expect(svg.getAttribute('data-slot')).toBe('icon');
    expect(svg.classList.contains('size-(--icon-size)')).toBe(true);
    expect(svg.getAttribute('class')).not.toContain('opacity');
    expect(svg.innerHTML).toContain('currentColor');
  });

  it('becomes a named image with a label, at a size from the scale', () => {
    const view = render(<Icon name='IconBell' ariaLabel='Notifications' size='lg' />);
    const svg = view.getByRole('img', { name: 'Notifications' });
    expect(svg.getAttribute('aria-hidden')).toBeNull();
    expect(svg.classList.contains('size-(--icon-size-lg)')).toBe(true);
    expect(svg.classList.contains('size-(--icon-size)')).toBe(false);
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
