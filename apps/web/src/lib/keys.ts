interface KeyPress {
  key: string;
  shiftKey: boolean;
  nativeEvent: { isComposing: boolean };
}

export function isSubmitKey(event: KeyPress) {
  return event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing;
}
