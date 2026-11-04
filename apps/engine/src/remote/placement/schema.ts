import { NO_PLACEMENT_MACHINE } from '@shinsa/core';
import { Schema } from 'effect';

export const NoMachineAnswer = Schema.Struct({ machine: Schema.Literal(NO_PLACEMENT_MACHINE) });
