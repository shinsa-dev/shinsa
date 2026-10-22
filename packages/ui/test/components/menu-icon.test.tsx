import { describe, expect, it } from 'bun:test';
import { render } from '@testing-library/react';
import { menuIconPosition, renderMenuIcon } from '../../src/components/menu-icon';

describe('menu icons', () => {
  it('puts a bare name at the start and honours an explicit position', () => {
    expect(menuIconPosition(undefined)).toBeUndefined();
    expect(menuIconPosition('IconBell')).toBe('inline-start');
    expect(menuIconPosition({ name: 'IconBell' })).toBe('inline-start');
    expect(menuIconPosition({ name: 'IconBell', position: 'inline-end' })).toBe('inline-end');
  });

  it('renders the icon only on its own side, without leaking the position prop', () => {
    expect(renderMenuIcon(undefined, 'inline-start')).toBeNull();
    expect(renderMenuIcon('IconBell', 'inline-end')).toBeNull();
    const icon = renderMenuIcon({ name: 'IconBell', position: 'inline-end', className: 'x' }, 'inline-end');
    const view = render(<div>{icon}</div>);
    const svg = view.container.querySelector('svg') as SVGElement;
    expect(svg.getAttribute('class')).toContain('x');
    expect(svg.hasAttribute('position')).toBe(false);
  });
});
