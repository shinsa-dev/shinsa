import { act, fireEvent, waitFor } from '@testing-library/react';

async function hover(element: HTMLElement) {
  await act(async () => {
    fireEvent.pointerEnter(element);
    fireEvent.mouseEnter(element);
    fireEvent.pointerMove(element);
    fireEvent.mouseMove(element);
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
