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

  it('draws every size’s icons and spinner at 14px, large and icon buttons too', () => {
    const view = render(
      <>
        <Button icon='IconBell'>Default</Button>
        <Button size='lg' icon='IconBell'>
          Large
        </Button>
        <Button size='icon' icon='IconBell' aria-label='Icon' />
      </>
    );
    const sizeOf = (name: string) => {
      const classes = view.getByRole('button', { name }).className;
      if (classes.includes('[--icon-size:var(--icon-size-md)]')) return 16;
      return classes.includes('[--icon-size:var(--icon-size-sm)]') ? 14 : 0;
    };
    expect([sizeOf('Default'), sizeOf('Large'), sizeOf('Icon')]).toEqual([14, 14, 14]);
  });

  it('has a bare look with no wash at all, only its glyph brightening under the pointer and the press', () => {
    const view = render(<Button variant='bare' size='icon-sm' icon='IconPencil' aria-label='Edit' />);
    const classes = view.getByRole('button', { name: 'Edit' }).className.split(' ');
    expect(classes).toEqual(
      expect.arrayContaining([
        'text-fg-2',
        'before:hidden',
        'not-disabled:hover:text-fg-4',
        'not-disabled:active:text-fg-4',
      ])
    );
    expect(classes.filter((name) => /(?:hover|active|pressed\]):before:bg-/.test(name))).toEqual([]);
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
