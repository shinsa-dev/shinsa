#!/usr/bin/env bun
import { runCli } from './cli/index.ts';

process.exitCode = await runCli(Bun.argv.slice(2));
