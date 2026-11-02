import { Schema } from 'effect';
import { ProgramIdInput } from './schema.ts';

export const isProgramId = Schema.is(ProgramIdInput);
