import { Effect, Layer, Queue, Stream } from 'effect';
import { ipcMain, type IpcMainEvent } from 'electron';
import { CHANNELS } from '../bridge/schema.ts';
import { PAGE_REQUEST_CHANNELS, type PageMessage } from '../page-channel/schema.ts';
import { PageChannel } from '../page-channel/service.ts';
import type { SenderFrame } from '../window/schema.ts';

function readFrame(event: IpcMainEvent): SenderFrame {
  const frame = event.senderFrame;
  return {
    contentsId: event.sender.id,
    url: frame?.url ?? null,
    top: frame !== null && frame.parent === null,
  };
}

export const PageChannelLive = Layer.effect(
  PageChannel,
  Effect.gen(function* () {
    const messages = yield* Queue.unbounded<PageMessage>();
    for (const channel of PAGE_REQUEST_CHANNELS) {
      ipcMain.on(channel, (event, payload: unknown) => {
        Queue.offerUnsafe(messages, { frame: readFrame(event), channel, payload });
      });
    }
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        for (const channel of [...PAGE_REQUEST_CHANNELS, CHANNELS.start]) ipcMain.removeAllListeners(channel);
      })
    );
    return PageChannel.of({
      messages: Stream.fromQueue(messages),
      serveStart: (answer) =>
        Effect.sync(() => {
          ipcMain.on(CHANNELS.start, (event) => {
            event.returnValue = Effect.runSync(answer(readFrame(event)));
          });
        }),
    });
  })
);
