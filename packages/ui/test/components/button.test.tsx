import { describe, expect, it, mock } from 'bun:test';
import { fireEvent, render } from '@testing-library/react';
import { Button } from '../../src/components/button';

describe('Button', () => {
  it('is a native button that runs its action', () => {
    const onClick = mock();
    const view = render(<Button onClick={onClick}>Save</Button>);
    const button = view.getByRole('button', { name: 'Save' });
    expect(button.dataset.slot).toBe('button');
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('marks which side carries the icon, and nothing for an icon-only button', () => {
    const view = render(
      <>
        <Button icon='IconBell'>Leading</Button>
        <Button icon={{ name: 'IconBell', position: 'inline-end' }}>Trailing</Button>
        <Button icon='IconBell' aria-label='Alone' />
      </>
    );
    expect(view.getByRole('button', { name: 'Leading' }).dataset.icon).toBe('inline-start');
    expect(view.getByRole('button', { name: 'Trailing' }).dataset.icon).toBe('inline-end');
    expect(view.getByRole('button', { name: 'Alone' }).dataset.icon).toBeUndefined();
  });

  describe('while loading', () => {
    it('stays enabled and announces itself busy with a spinner in place of the icon', () => {
      const view = render(
        <Button loading icon='IconBell'>
          Send
        </Button>
      );
      const button = view.getByRole('button', { name: /Send/ });
      expect(button.hasAttribute('disabled')).toBe(false);
      expect(button.getAttribute('aria-busy')).toBe('true');
      expect(button.hasAttribute('data-loading')).toBe(true);
      expect(view.getByRole('status', { name: 'Loading' })).toBeTruthy();
      expect(button.querySelectorAll('svg')).toHaveLength(1);
    });

    it('draws the spinner at the button’s icon size, like the icon it replaces', () => {
      const view = render(
        <Button loading icon='IconBell' size='sm'>
          Send
        </Button>
      );
      expect(view.getByRole('status', { name: 'Loading' }).classList.contains('size-(--icon-size)')).toBe(
        true
      );
      expect(view.getByRole('button', { name: /Send/ }).className).toContain(
        '[--icon-size:var(--icon-size-sm)]'
      );
    });

    it('puts the spinner on the icon’s side, and leading when there is no icon', () => {
      const trailing = render(
        <Button loading icon={{ name: 'IconBell', position: 'inline-end' }}>
          Next
        </Button>
      );
      expect(trailing.getByRole('button', { name: /Next/ }).lastElementChild?.getAttribute('role')).toBe(
        'status'
      );
      const bare = render(<Button loading>Plain</Button>);
      expect(bare.getByRole('button', { name: /Plain/ }).dataset.icon).toBe('inline-start');
    });

    it('ignores presses, so a busy submit cannot fire twice', () => {
      const onClick = mock();
      const onSubmit = mock((event: SubmitEvent) => event.preventDefault());
      const view = render(
        <form onSubmit={onSubmit as never}>
          <Button type='submit' loading onClick={onClick}>
            Submit
          </Button>
        </form>
      );
      fireEvent.click(view.getByRole('button', { name: /Submit/ }));
      expect(onClick).not.toHaveBeenCalled();
      expect(onSubmit).not.toHaveBeenCalled();
    });
  });
});
