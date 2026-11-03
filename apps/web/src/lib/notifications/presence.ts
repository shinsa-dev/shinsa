export const PRESENCE_INTERVAL_MS = 15_000;

const USE_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const;

const ARRIVAL_EVENTS = ['focus'] as const;

type PresenceDocument = Pick<
  Document,
  'visibilityState' | 'hasFocus' | 'addEventListener' | 'removeEventListener'
>;

type PresenceTarget = Pick<Window, 'addEventListener' | 'removeEventListener'>;

export function isPageActive(doc: Pick<Document, 'visibilityState' | 'hasFocus'> | null = selectDocument()) {
  return doc !== null && doc.visibilityState === 'visible' && doc.hasFocus();
}

function selectDocument() {
  return typeof document === 'undefined' ? null : document;
}

export function watchPresence(
  report: () => void,
  target: PresenceTarget = window,
  doc: PresenceDocument = document,
  now = () => Date.now()
) {
  let reportedAt: number | null = null;
  const tell = (arrived: boolean) => {
    if (!isPageActive(doc)) return;
    const at = now();
    if (!arrived && reportedAt !== null && at - reportedAt < PRESENCE_INTERVAL_MS) return;
    reportedAt = at;
    report();
  };
  const onUse = () => tell(false);
  const onArrival = () => tell(true);
  for (const type of USE_EVENTS) target.addEventListener(type, onUse, { passive: true });
  for (const type of ARRIVAL_EVENTS) target.addEventListener(type, onArrival);
  doc.addEventListener('visibilitychange', onArrival);
  return () => {
    for (const type of USE_EVENTS) target.removeEventListener(type, onUse);
    for (const type of ARRIVAL_EVENTS) target.removeEventListener(type, onArrival);
    doc.removeEventListener('visibilitychange', onArrival);
  };
}
