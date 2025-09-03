#!/usr/bin/env node

/**
 * TaskCLI v2 - Clean, simple, tool-based
 */

import { main } from '../src/index2.js';

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});