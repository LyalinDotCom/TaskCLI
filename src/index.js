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
  const args = { interactive: true, headless: false, yes: false, flashModel: process.env.FLASH_MODEL || 'gemini-2.5-flash', proModel: process.env.PRO_MODEL || 'gemini-1.5-pro', cwd: process.cwd() };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-i' || a === '--interactive') args.interactive = true;
    else if (a === '--headless' || a === '--no-ui') { args.headless = true; args.interactive = false; }
    else if (a === '--doctor') args.doctor = true;
    else if (a === '--yes' || a === '-y') args.yes = true;
    else if ((a === '--flash-model' || a === '--flash') && argv[i + 1]) { args.flashModel = argv[++i]; }
    else if ((a === '--pro-model' || a === '--pro') && argv[i + 1]) { args.proModel = argv[++i]; }
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
    `  --flash-model NAME  Model for planning (default: gemini-2.5-flash)\n` +
    `  --pro-model NAME    Model for execution (default: gemini-1.5-pro)\n` +
    `  --cwd PATH          Working directory for tasks\n` +
    `  -h, --help          Show help\n\n` +
    `Env:\n` +
    `  GEMINI_API_KEY or GOOGLE_API_KEY         Google AI key (Genkit)\n` +
    `  FLASH_MODEL, PRO_MODEL                   Override defaults\n`);
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

  // Prepare session
  ensureSessionDir();
  const session = newSession({ cwd: args.cwd, flashModel: args.flashModel, proModel: args.proModel });

  // Load model adapters (Genkit via Flash)
  const models = await loadModels({ flashModel: args.flashModel, proModel: args.proModel });

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
  const result = await orchestrate({ userGoal, models, session, options: { autoConfirm: args.yes } });
  saveSession(session);
}
