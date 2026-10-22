import { describe, expect, it } from 'bun:test';
import { render } from '@testing-library/react';
import { FieldError } from '../../src/components/field';

describe('FieldError', () => {
  it('renders nothing without an error', () => {
    expect(render(<FieldError />).container.innerHTML).toBe('');
    expect(render(<FieldError errors={[]} />).container.innerHTML).toBe('');
  });

  it('announces a single message as plain text', () => {
    const view = render(<FieldError errors={[{ message: 'Required' }, { message: 'Required' }]} />);
    expect(view.getByRole('alert').textContent).toBe('Required');
  });

  it('lists distinct messages once each', () => {
    const view = render(
      <FieldError
        errors={[{ message: 'Too short' }, undefined, { message: 'Too short' }, { message: 'No spaces' }]}
      />
    );
    expect([...view.getByRole('alert').querySelectorAll('li')].map((item) => item.textContent)).toEqual([
      'Too short',
      'No spaces',
    ]);
  });

  it('prefers its children over the errors', () => {
    const view = render(<FieldError errors={[{ message: 'Ignored' }]}>Shown</FieldError>);
    expect(view.getByRole('alert').textContent).toBe('Shown');
  });
});
