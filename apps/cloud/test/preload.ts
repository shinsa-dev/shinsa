import { afterAll } from 'bun:test';
import { removeTestDatabases } from './harness.ts';

afterAll(removeTestDatabases);
