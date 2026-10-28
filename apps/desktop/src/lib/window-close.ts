export type CloseAction = 'close' | 'hide' | 'leave-full-screen';

export function resolveCloseAction({
  quitting,
  fullScreen,
}: {
  quitting: boolean;
  fullScreen: boolean;
}): CloseAction {
  if (quitting) return 'close';
  return fullScreen ? 'leave-full-screen' : 'hide';
}
