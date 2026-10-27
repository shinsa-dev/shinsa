import { Button } from '@shinsa/ui/components/button';
import { DropdownMenuTrigger } from '@shinsa/ui/components/dropdown-menu';

export function OptionsTrigger({ label }: { label: string }) {
  return (
    <DropdownMenuTrigger
      render={
        <Button variant='secondary' size='icon-sm' icon='IconDotGrid1x3Horizontal' aria-label={label} />
      }
    />
  );
}
