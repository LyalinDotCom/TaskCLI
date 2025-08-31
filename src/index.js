import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';
import dotenv from 'dotenv';
import { orchestrate } from './orchestrator.js';
import { loadModels } from './models.js';
import { ensureSessionDir, newSession, saveSession } from './session.js';
import { printHeader } from './ui.js';

function loadEnv() {
  const cwd = process.cwd();
  const envPath = path.join(cwd, '.env');
  dotenv.config({ path: fs.existsSync(envPath) ? envPath : undefined });
}

function parseArgs(argv) {
  const args = { interactive: false, yes: false, flashModel: process.env.FLASH_MODEL || 'gemini-2.5-flash', proModel: process.env.PRO_MODEL || 'gemini-1.5-pro', cwd: process.cwd() };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-i' || a === '--interactive') args.interactive = true;
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
    `  -i, --interactive   Interactive multi-turn mode\n` +
    `  -y, --yes           Auto-confirm shell commands\n` +
    `  --flash-model NAME  Model for planning (default: gemini-2.5-flash)\n` +
    `  --pro-model NAME    Model for execution (default: gemini-1.5-pro)\n` +
    `  --cwd PATH          Working directory for tasks\n` +
    `  -h, --help          Show help\n\n` +
    `Env:\n` +
    `  GOOGLE_GENAI_API_KEY or GEMINI_API_KEY   Google AI key (Genkit)\n` +
    `  FLASH_MODEL, PRO_MODEL                   Override defaults\n`);
}

export async function main() {
  loadEnv();
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { printHelp(); return; }
  printHeader();

  if (!process.env.GOOGLE_GENAI_API_KEY && !process.env.GEMINI_API_KEY) {
    console.log(chalk.yellow('Warning: GOOGLE_GENAI_API_KEY or GEMINI_API_KEY is not set. Model calls will fail.'));
  }

  // Prepare session
  ensureSessionDir();
  const session = newSession({ cwd: args.cwd, flashModel: args.flashModel, proModel: args.proModel });

  // Load model adapters (Genkit via Flash)
  const models = await loadModels({ flashModel: args.flashModel, proModel: args.proModel });

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  async function promptOnce(initial) {
    const question = initial ?? await rl.question(chalk.cyan('What do you want to build? '));
    return question.trim();
  }

  let userGoal = args.message;
  if (!userGoal) {
    userGoal = await promptOnce();
  }

  if (!userGoal) {
    console.log(chalk.yellow('No input provided. Exiting.'));
    rl.close();
    return;
  }

  // Orchestrate for the initial goal
  const result = await orchestrate({
    userGoal,
    models,
    session,
    options: { autoConfirm: args.yes }
  });
  saveSession(session);

  // Interactive follow-ups
  if (args.interactive) {
    while (true) {
      const follow = (await rl.question(chalk.cyan('\nAdd more instructions (or Enter to finish): '))).trim();
      if (!follow) break;
      const res2 = await orchestrate({ userGoal: follow, models, session, options: { autoConfirm: args.yes } });
      if (!res2.ok) console.log(chalk.red('Follow-up failed: ') + res2.error);
      saveSession(session);
    }
  }

  rl.close();
}
