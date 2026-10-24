const BLOCK_TAG = /^(?:DIV|P|SECTION|ARTICLE|HEADER|FOOTER|NAV|FORM|LABEL|LI|UL|OL|H[1-6])$/;

const BLOCK_DISPLAY = /(?:^|\s)(?:flex|grid|block|table)(?=\s|$)/;

const FITTED_WIDTH =
  /(?:^|\s)(?:w-fit|w-max|w-\d[\w.]*|size-[\w.]+|inline|inline-flex|inline-grid|inline-block)(?=\s|$)/;

function isStretched(trigger: Element) {
  const classes = trigger.getAttribute('class') ?? '';
  if (!BLOCK_TAG.test(trigger.tagName) && !BLOCK_DISPLAY.test(classes)) return false;
  return !FITTED_WIDTH.test(classes);
}

export function listStretchedTriggers(container: Element) {
  return [...container.querySelectorAll('[data-slot="tooltip-trigger"]')].filter(isStretched);
}
