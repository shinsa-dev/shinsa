import type { RemoteUser } from '@shinsa/core';
import { createContext } from 'react';

export const ViewerContext = createContext<RemoteUser | null>(null);
