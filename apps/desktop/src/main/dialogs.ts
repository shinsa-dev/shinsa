import { Effect, Layer } from 'effect';
import { dialog } from 'electron';
import { Dialogs } from '../dialogs/service.ts';

export const DialogsLive = Layer.succeed(
  Dialogs,
  Dialogs.of({
    show: ({ buttons, ...options }) =>
      Effect.promise(() =>
        dialog.showMessageBox({ ...options, buttons: buttons ? [...buttons] : undefined })
      ).pipe(Effect.map((answer) => answer.response)),
  })
);
