import { TOOLTIP_DELAY } from '@shinsa/ui/components/tooltip';
import { act, fireEvent, waitFor } from '@testing-library/react';

function skipTooltipDelay(run: () => void) {
  const real = globalThis.setTimeout;
  const instant = (handler: () => void, ms?: number) => {
    if (ms !== TOOLTIP_DELAY) return real(handler, ms);
    handler();
    return real(() => undefined, 0);
  };
  globalThis.setTimeout = instant as typeof setTimeout;
  try {
    run();
  } finally {
    globalThis.setTimeout = real;
  }
}

async function hover(element: HTMLElement) {
  await act(async () => {
    skipTooltipDelay(() => {
      fireEvent.pointerEnter(element);
      fireEvent.mouseEnter(element);
      fireEvent.pointerMove(element);
      fireEvent.mouseMove(element);
    });
  });
}

export async function findTooltipText(element: HTMLElement) {
  await hover(element);
  return waitFor(() => {
    const tooltip = document.querySelector('[data-slot="tooltip-content"]');
    if (!tooltip?.textContent) throw new Error('No tooltip is open.');
    return tooltip.textContent;
  });
}
