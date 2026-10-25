import { createShikiEngine } from './shiki-engine.ts';
import { createTokenizer, isTokenFailure, type TokenAnswer, type TokenRequest } from './textmate.ts';

interface WorkerScope {
  postMessage: (message: TokenAnswer, transfer: Transferable[]) => void;
  onmessage: ((event: MessageEvent<TokenRequest>) => void) | null;
}

const scope = globalThis as unknown as WorkerScope;

const tokenizer = createTokenizer(createShikiEngine(), (answer) =>
  scope.postMessage(answer, isTokenFailure(answer) ? [] : [answer.offsets.buffer, answer.data.buffer])
);

scope.onmessage = (event) => {
  void tokenizer.tokenize(event.data);
};
