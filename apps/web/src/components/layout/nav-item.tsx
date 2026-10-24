import { Icon, type IconName } from '@shinsa/ui/components/icon';

export function NavItem({
  label,
  icon,
  activeIcon = icon,
  active,
  onClick,
}: {
  label: string;
  icon: IconName;
  activeIcon?: IconName;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type='button'
      aria-current={active ? 'page' : undefined}
      data-active={active}
      data-highlight-item=''
      onClick={onClick}
      className='corner-superellipse/1.125 flex h-7 w-full cursor-pointer items-center gap-2 rounded-control ps-1.5 pe-2.5 text-left text-fg-3 text-xs outline-none transition-colors duration-150 data-[active=true]:text-fg-4 data-hovered:text-fg-4'
    >
      <span className='grid size-5 shrink-0 place-items-center'>
        <Icon name={active ? activeIcon : icon} className='size-4' />
      </span>
      <span className='flex-1 truncate'>{label}</span>
    </button>
  );
}
