export const READ_ONLY_REFUSAL = 'This shared task is read-only. Nothing on it can be changed from here.';

let holds = 0;

export function enterReadOnly() {
  holds += 1;
  let left = false;
  return () => {
    if (left) return;
    left = true;
    holds -= 1;
  };
}

export function selectReadOnlyRefusal() {
  return holds > 0 ? new Error(READ_ONLY_REFUSAL) : null;
}
