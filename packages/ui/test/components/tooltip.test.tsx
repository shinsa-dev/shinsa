import { afterEach, describe, expect, it, mock } from 'bun:test';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  Tooltip,
  TooltipContent,
  TooltipLabel,
  TooltipProvider,
  TooltipTrigger,
} from '../../src/components/tooltip';
import { flush } from '../support/layout';
import { installMedia } from '../support/media';

let media: ReturnType<typeof installMedia>;

afterEach(() => media.restore());

function Hint(props: { open?: boolean; onOpenChange?: (open: boolean) => void; onClick?: () => void }) {
  return (
    <TooltipProvider>
      <Tooltip open={props.open} onOpenChange={props.onOpenChange}>
        <TooltipTrigger onClick={props.onClick}>Info</TooltipTrigger>
        <TooltipContent>
          Merged <TooltipLabel>2h ago</TooltipLabel>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

async function tap() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Info' }));
    await flush();
  });
}

describe('Tooltip without hover', () => {
  it('opens and closes on tap, and still runs the trigger’s own click', async () => {
    media = installMedia({ '(hover: hover)': false });
    const onClick = mock();
    render(<Hint onClick={onClick} />);

    await tap();
    expect(screen.getByText('2h ago').dataset.slot).toBe('tooltip-label');
    expect(onClick).toHaveBeenCalledTimes(1);

    await tap();
    await waitFor(() => expect(screen.queryByText('2h ago')).toBeNull());
  });

  it('leaves a controlled tooltip to its owner', async () => {
    media = installMedia({ '(hover: hover)': false });
    const onOpenChange = mock();
    render(<Hint open={false} onOpenChange={onOpenChange} />);
    await tap();
    expect(screen.queryByText('2h ago')).toBeNull();
  });
});

describe('Tooltip with hover', () => {
  it('does not open on a tap', async () => {
    media = installMedia({ '(hover: hover)': true });
    render(<Hint />);
    await tap();
    expect(screen.queryByText('2h ago')).toBeNull();
  });
});
