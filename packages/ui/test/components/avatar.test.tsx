import { describe, expect, it } from 'bun:test';
import { render } from '@testing-library/react';
import { Avatar } from '../../src/components/avatar';
import { PastelAvatar } from '../../src/components/pastel-avatar';

describe('PastelAvatar', () => {
  it('is decorative unless labelled', () => {
    const plain = render(<PastelAvatar seed='Superwall' />).container.firstElementChild as HTMLElement;
    expect(plain.getAttribute('aria-hidden')).toBe('true');
    expect(plain.style.width).toBe('24px');

    const view = render(<PastelAvatar seed='Ada' variant='orb' aria-label='Ada' size={32} />);
    expect(view.getByRole('img', { name: 'Ada' }).dataset.variant).toBe('orb');
  });
});

describe('Avatar', () => {
  it('names a face by its label and stays decorative without one', () => {
    const labelled = render(<Avatar name='ada' label='Ada Lovelace' />);
    expect(labelled.getByRole('img', { name: 'Ada Lovelace' }).getAttribute('src')).toContain('/ada?');
    const plain = render(<Avatar name='ada' />);
    expect(plain.container.querySelector('img')?.getAttribute('alt')).toBe('');
  });

  it('names an orb by its label', () => {
    const view = render(<Avatar name='ada' picture='orb' label='Ada' />);
    expect(view.getByRole('img', { name: 'Ada' }).dataset.slot).toBe('pastel-avatar');
  });

  it('renders its own children without a name', () => {
    const view = render(
      <Avatar>
        <span>AL</span>
      </Avatar>
    );
    expect(view.getByText('AL')).toBeTruthy();
  });
});
