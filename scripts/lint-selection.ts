const EDGE = String.raw`(?=[\s'"\x60]|$)`;

export const SELECTION_CLASS_RULE = {
  pattern: new RegExp(String.raw`(?:^|[\s'"\x60:])(?:select-(?:text|all|auto)|cursor-text)${EDGE}`),
  message:
    'Ad hoc selection. The app is chrome and never selected; real content opts back in through the kit’s one class, selectable (globals.css), which sets the selection and the I-beam together (docs/design.md → Where Shinsa differs, 39)',
};

export const RAW_SELECTION_PATTERN = /\b(?:user-select|userSelect|WebkitUserSelect)\b/;

export const RAW_SELECTION_MESSAGE =
  'user-select set by hand. Selection follows one policy: chrome is never selected, content is `selectable`, and a drag sets body[data-dragging] to stop it everywhere (docs/design.md → Where Shinsa differs, 39)';
