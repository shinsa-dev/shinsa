import { resolveAppFlavor } from '@shinsa/core';

export const FLAVOR = resolveAppFlavor(process.env.SHINSA_BUILD_FLAVOR);
