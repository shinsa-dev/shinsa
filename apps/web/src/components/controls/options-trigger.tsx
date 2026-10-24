import { Button } from '@shinsa/ui/components/button';
import { DropdownMenuTrigger } from '@shinsa/ui/components/dropdown-menu';
import { Hint } from '@/components/overlays/hint.tsx';

export function OptionsTrigger({ label }: { label: string }) {
  return (
    <Hint label={label}>
      <DropdownMenuTrigger
        render={
          <Button variant='secondary' size='icon-sm' icon='IconDotGrid1x3Horizontal' aria-label={label} />
        }
      />
    </Hint>
  );
}
