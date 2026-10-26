import type { IFunctionIdentifier, IParser } from '@xterm/xterm';

type ReplyParser = Pick<IParser, 'registerCsiHandler' | 'registerDcsHandler' | 'registerOscHandler'>;

export const ENGINE_ANSWERS: { csi: IFunctionIdentifier[]; dcs: IFunctionIdentifier[]; osc: number[] } = {
  csi: [
    { final: 'c' },
    { prefix: '>', final: 'c' },
    { prefix: '=', final: 'c' },
    { final: 'n' },
    { prefix: '?', final: 'n' },
    { intermediates: '$', final: 'p' },
    { prefix: '?', intermediates: '$', final: 'p' },
    { prefix: '>', final: 'q' },
  ],
  dcs: [{ intermediates: '$', final: 'q' }],
  osc: [4, 10, 11, 12],
};

export function silenceEngineAnswers(parser: ReplyParser) {
  const handled = () => true;
  const disposables = [
    ...ENGINE_ANSWERS.csi.map((id) => parser.registerCsiHandler(id, handled)),
    ...ENGINE_ANSWERS.dcs.map((id) => parser.registerDcsHandler(id, handled)),
    ...ENGINE_ANSWERS.osc.map((code) => parser.registerOscHandler(code, (data) => data.includes('?'))),
  ];
  return () => {
    for (const disposable of disposables) disposable.dispose();
  };
}
