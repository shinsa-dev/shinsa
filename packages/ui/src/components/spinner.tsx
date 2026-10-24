import { ICON_SIZE_CLASS, type IconSize } from '@shinsa/ui/components/icon';
import { cn } from '@shinsa/ui/lib/utils';

type SpinnerProps = {
  className?: string;
  style?: React.CSSProperties;
  size?: IconSize;
  'aria-label'?: string;
};

/** On the icon scale and in the icon ink, like `Icon`: it stands where an icon would. */
function Spinner({ className, size, 'aria-label': ariaLabel = 'Loading', ...props }: SpinnerProps) {
  return (
    <svg
      data-slot='spinner'
      role='status'
      aria-label={ariaLabel}
      viewBox='0 0 16 16'
      fill='none'
      className={cn('shrink-0 animate-spin', size ? ICON_SIZE_CLASS[size] : 'size-(--icon-size)', className)}
      {...props}
    >
      <circle cx='8' cy='8' r='6.25' stroke='currentColor' strokeOpacity='0.3' strokeWidth='1.5' />
      <path
        d='M14.25 8A6.25 6.25 0 0 0 8 1.75'
        stroke='currentColor'
        strokeWidth='1.5'
        strokeLinecap='round'
      />
    </svg>
  );
}

export { Spinner };
