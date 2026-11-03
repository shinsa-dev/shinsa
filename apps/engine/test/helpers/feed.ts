import { type Cause, Effect, Queue, Stream } from 'effect';

export interface MessageFeed<T> extends AsyncIterable<T> {
  push: (item: T) => void;
  close: () => void;
}

export function createMessageFeed<T>(): MessageFeed<T> {
  const queue = Effect.runSync(Queue.unbounded<T, Cause.Done>());
  const iterable = Stream.toAsyncIterable(Stream.fromQueue(queue));
  return {
    push: (item) => {
      Queue.offerUnsafe(queue, item);
    },
    close: () => {
      Queue.endUnsafe(queue);
    },
    [Symbol.asyncIterator]: () => iterable[Symbol.asyncIterator](),
  };
}
