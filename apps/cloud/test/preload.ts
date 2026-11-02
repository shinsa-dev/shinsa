import { afterAll, setDefaultTimeout } from 'bun:test';
import { removeTestDatabases } from './harness.ts';

setDefaultTimeout(30_000);

afterAll(removeTestDatabases);
