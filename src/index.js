import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';
import dotenv from 'dotenv';
import { orchestrate } from './orchestrator.js';
import { loadModels } from './models.js';
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
  const args = { interactive: true, headless: false, yes: false, flashModel: 'gemini-2.5-flash', proModel: 'gemini-2.5-pro', cwd: process.cwd() };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-i' || a === '--interactive') args.interactive = true;
    else if (a === '--headless' || a === '--no-ui') { args.headless = true; args.interactive = false; }
    else if (a === '--doctor') args.doctor = true;
    else if (a === '--yes' || a === '-y') args.yes = true;
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
    `  --cwd PATH          Working directory for tasks\n` +
    `  -h, --help          Show help\n\n` +
    `Models:\n` +
    `  Planning: Gemini 2.5 Flash (fixed)\n` +
    `  Execution: Gemini 2.5 Pro with 8000 token thinking budget (fixed)\n\n` +
    `Environment:\n` +
    `  GEMINI_API_KEY or GOOGLE_API_KEY    Required for Google AI access\n`);
}

export async function main() {
  loadEnv();
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { printHelp(); return; }
  if (args.doctor) { await runDoctor(); return; }
  printHeader();

  if (!process.env.GEMINI_API_KEY && !process.env.GOOGLE_API_KEY) {
    console.log(chalk.yellow('Warning: GEMINI_API_KEY or GOOGLE_API_KEY is not set. Model calls will fail.'));
  }

  // Prepare session with fixed models
  ensureSessionDir();
  const session = newSession({ cwd: args.cwd, flashModel: 'gemini-2.5-flash', proModel: 'gemini-2.5-pro' });

  // Load model adapters (uses fixed Gemini 2.5 Flash and Pro)
  const models = await loadModels();

  const initialInput = args.message || '';
  // Default: interactive UI if TTY and not explicitly headless
  if (!args.headless && process.stdin.isTTY) {
    startTUI({ session, models, options: { autoConfirm: args.yes }, initialInput });
    return;
  }

  // Non-interactive single run
  const userGoal = initialInput || '';
  if (!userGoal) {
    console.log(chalk.yellow('Headless mode requires a goal. Example: taskcli --headless "Create a README"'));
    return;
  }
  await orchestrate({ userGoal, models, session, options: { autoConfirm: args.yes } });
  saveSession(session);
}
