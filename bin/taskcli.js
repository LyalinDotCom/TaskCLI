#!/usr/bin/env node
import { main } from '../src/index.js';

main().catch((err) => {
  const msg = err instanceof Error ? (err.stack || err.message) : String(err);
  console.error(msg);
  process.exit(1);
});

