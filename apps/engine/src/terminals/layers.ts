import { Layer } from 'effect';
import { TerminalPty } from './pty/service.ts';
import { TerminalFiles } from './store/service.ts';

export const TerminalsLayer = Layer.merge(TerminalFiles.layer, TerminalPty.layer);
