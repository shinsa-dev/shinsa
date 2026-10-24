export function StepNumber({ index }: { index: number }) {
  return (
    <span className='corner-superellipse/1.125 grid size-5 shrink-0 place-items-center rounded-control-sm bg-bg-a2 font-medium text-2xs text-fg-3 tabular-nums'>
      {index + 1}
    </span>
  );
}
