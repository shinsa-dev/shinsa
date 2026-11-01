import { Hint } from '@/components/overlays/hint.tsx';
import { Pulse } from '@/components/status/pulse.tsx';
import { useDelayed } from '@/hooks/use-delayed.ts';
import { useConnection } from '@/lib/connection/socket.ts';

export const RECONNECT_GRACE_MS = 1000;

export function ConnectionStatus() {
  const { status } = useConnection();
  const reconnecting = useDelayed(status !== 'open', RECONNECT_GRACE_MS);
  if (!reconnecting) return null;
  return (
    <Hint label='Reconnecting'>
      <span role='status' aria-label='Reconnecting' className='grid size-5 place-items-center'>
        <Pulse tone='amber' />
      </span>
    </Hint>
  );
}
