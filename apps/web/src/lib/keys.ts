interface KeyPress {
  key: string;
  shiftKey: boolean;
  nativeEvent: { isComposing: boolean };
}

export function isSubmitKey(event: KeyPress) {
  return event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing;
}

export function isCancelKey(event: KeyPress) {
  return event.key === 'Escape' && !event.nativeEvent.isComposing;
}

export function isTyping(target: EventTarget | null) {
  const element = target as Partial<HTMLElement> | null;
  if (!element || typeof element.tagName !== 'string') return false;
  return element.isContentEditable === true || ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName);
}
