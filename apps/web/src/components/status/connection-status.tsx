import { Hint } from '@/components/overlays/hint.tsx';
import { Pulse } from '@/components/status/pulse.tsx';
import { useConnection } from '@/lib/connection/socket.ts';

export function ConnectionStatus() {
  const { status } = useConnection();
  if (status === 'open') return null;
  return (
    <Hint label='Reconnecting'>
      <span role='status' aria-label='Reconnecting' className='grid size-5 place-items-center'>
        <Pulse tone='amber' />
      </span>
    </Hint>
  );
}
