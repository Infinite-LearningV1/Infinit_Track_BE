#!/usr/bin/env node

import { fileURLToPath } from 'url';

import {
  APPLY_ACK_FLAG,
  FIXED_OUTPUT_PATH
} from './research-attendance-config.js';

export function parseArgs(argv = []) {
  const apply = argv.includes('--apply');
  const acknowledged = argv.includes(APPLY_ACK_FLAG);

  return {
    apply,
    acknowledged,
    dryRun: !apply,
    outputPath: FIXED_OUTPUT_PATH
  };
}

export function createSeededNumberStream(seed) {
  let state = 0;

  for (const char of String(seed)) {
    state = (state * 31 + char.charCodeAt(0)) >>> 0;
  }

  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

export function isDirectRun(metaUrl) {
  return process.argv[1] === fileURLToPath(metaUrl);
}

if (isDirectRun(import.meta.url)) {
  throw new Error('INF-181 research planner belum diimplementasikan. Lanjutkan Task 2.');
}
