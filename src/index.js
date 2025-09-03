import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';
import dotenv from 'dotenv';
// Redirect to v2 architecture
import { main as mainV2 } from './index2.js';
import { ensureSessionDir, newSession, saveSession } from './session.js';
import { printHeader } from './ui.js';
import { startTUI } from './ui/tui.js';
import { runDoctor } from './doctor.js';

function loadEnv() {
  const cwd = process.cwd();
  const envPath = path.join(cwd, '.env');
  let loaded = false;
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
    loaded = true;
  }
  if (!loaded) {
    // Try TaskCLI/.env relative to this file
    const here = path.dirname(fileURLToPath(import.meta.url));
    const candidate = path.resolve(here, '..', '.env');
    if (fs.existsSync(candidate)) {
      dotenv.config({ path: candidate });
      loaded = true;
    }
  }
  if (!loaded) dotenv.config();
}

function parseArgs(argv) {
  // Fixed models - no overrides allowed
  // Default to v2 (unified Pro orchestrator)
  const args = { interactive: true, headless: false, yes: false, flashModel: 'gemini-2.5-pro', proModel: 'gemini-2.5-pro', cwd: process.cwd(), useV2: true };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-i' || a === '--interactive') args.interactive = true;
    else if (a === '--headless' || a === '--no-ui') { args.headless = true; args.interactive = false; }
    else if (a === '--doctor') args.doctor = true;
    else if (a === '--yes' || a === '-y') args.yes = true;
    else if (a === '--v1' || a === '--legacy') args.useV2 = false; // Use legacy Flash+Pro orchestrator
    else if (a === '--v2' || a === '--unified') args.useV2 = true; // Explicitly use v2 (already default)
    // Skip model override arguments but consume their values to avoid treating them as goals
    else if ((a === '--flash-model' || a === '--flash') && argv[i + 1]) { i++; } // Skip but ignore
    else if ((a === '--pro-model' || a === '--pro') && argv[i + 1]) { i++; } // Skip but ignore
    else if ((a === '--cwd') && argv[i + 1]) { args.cwd = path.resolve(argv[++i]); }
    else if (a === '-h' || a === '--help') args.help = true;
    else rest.push(a);
  }
  args.message = rest.join(' ').trim();
  return args;
}

function printHelp() {
  console.log(`TaskCLI - AI Task Orchestrator\n\n` +
    `Usage:\n` +
    `  taskcli [options] "your goal"\n\n` +
    `Options:\n` +
    `  -i, --interactive   Interactive multi-turn UI (default)\n` +
    `      --headless      Run without UI (command-line mode)\n` +
    `      --doctor       Run environment checks\n` +
    `  -y, --yes           Auto-confirm shell commands\n` +
    `      --v1, --legacy  Use legacy Flash+Pro orchestrator\n` +
    `  --cwd PATH          Working directory for tasks\n` +
    `  -h, --help          Show help\n\n` +
    `Models:\n` +
    `  Default (v2): Gemini 2.5 Pro only (unified planning/execution with adaptive recovery)\n` +
    `  With --v1: Gemini 2.5 Pro for both planning and execution\n\n` +
    `Environment:\n` +
    `  GEMINI_API_KEY or GOOGLE_API_KEY    Required for Google AI access\n`);
}

export async function main() {
  // Just use v2 now
  return mainV2();
}
