export function DiffStats({
  added,
  removed,
  muted = false,
}: {
  added: number;
  removed: number;
  muted?: boolean;
}) {
  return (
    <span className='flex w-fit shrink-0 items-center gap-1.5 font-normal text-2xs tabular-nums'>
      <span className={muted ? 'text-fg-1' : 'text-green-text'}>+{added}</span>
      <span className={muted ? 'text-fg-1' : 'text-red-text'}>−{removed}</span>
    </span>
  );
}
