/**
 * TaskCLI v2 - Simplified, tool-based architecture
 * No orchestrators, no task lists, just autonomous execution
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';
import dotenv from 'dotenv';
import { AutonomousAgent } from './agent.js';
import { createModelAdapter } from './models.js';
import { ensureSessionDir, newSession, saveSession } from './session.js';
import { getContextManager } from './contextManager.js';
import { printHeader } from './ui.js';
import { runDoctor } from './doctor.js';
import { startTUI } from './ui/tuiEnhanced.js';

function loadEnv() {
  const cwd = process.cwd();
  const envPath = path.join(cwd, '.env');
  let loaded = false;
  
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
    loaded = true;
  }
  
  if (!loaded) {
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
  const args = { 
    cwd: process.cwd(),
    headless: false,
    yes: false,
    thinkingBudget: -1,  // Default to dynamic thinking
    showThoughts: true    // Default to showing thoughts
  };
  
  const rest = [];
  
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--headless') {
      args.headless = true;
    } else if (a === '--doctor') {
      args.doctor = true;
    } else if (a === '--yes' || a === '-y') {
      args.yes = true;
    } else if (a === '--cwd' && argv[i + 1]) {
      args.cwd = path.resolve(argv[++i]);
    } else if (a === '--thinking' && argv[i + 1]) {
      args.thinkingBudget = parseInt(argv[++i], 10);
    } else if (a === '--no-thoughts') {
      args.showThoughts = false;
    } else if (a === '-h' || a === '--help') {
      args.help = true;
    } else {
      rest.push(a);
    }
  }
  
  args.goal = rest.join(' ').trim();
  return args;
}

function printHelp() {
  console.log(`
TaskCLI v2 - Autonomous Task Executor

Usage:
  taskcli "your goal"

Options:
  --headless        Run without interactive UI
  --doctor          Run environment checks
  -y, --yes         Auto-confirm all actions
  --cwd PATH        Working directory for tasks
  --thinking NUM    Thinking budget for Gemini 2.5 Pro (default: -1 for dynamic, 0 to disable)
  --no-thoughts     Hide model thinking process from output
  -h, --help        Show help

Examples:
  taskcli "run npm build and fix any errors"
  taskcli "create a React component for user profile"
  taskcli "debug why the tests are failing"

Environment:
  GEMINI_API_KEY or GOOGLE_API_KEY    Required for Google AI access
`);
}

export async function main() {
  loadEnv();
  const args = parseArgs(process.argv.slice(2));
  
  if (args.help) {
    printHelp();
    return;
  }
  
  if (args.doctor) {
    await runDoctor();
    return;
  }
  
  printHeader();
  
  if (!process.env.GEMINI_API_KEY && !process.env.GOOGLE_API_KEY) {
    console.log(chalk.yellow('Warning: GEMINI_API_KEY or GOOGLE_API_KEY is not set. Model calls will fail.'));
    console.log(chalk.yellow('Run with --doctor to check your environment.'));
  }
  
  // Setup session
  ensureSessionDir();
  const session = newSession({ 
    cwd: args.cwd,
    thinkingBudget: args.thinkingBudget
  });
  
  // Create model adapter with thinking budget and thoughts display
  const modelAdapter = createModelAdapter(args.thinkingBudget, args.showThoughts);
  
  // Interactive mode (default if TTY and not headless)
  if (!args.headless && process.stdin.isTTY) {
    // Use enhanced TUI with context management
    startTUI({
      session,
      modelAdapter,
      options: { autoConfirm: args.yes },
      initialInput: args.goal
    });
    return;
  }
  
  // Headless mode
  if (!args.goal) {
    console.log(chalk.yellow('Please provide a goal. Example: taskcli "run npm build and fix errors"'));
    return;
  }
  
  // Create UI callbacks for headless mode
  const ui = {
    onLog: (message) => console.log(message),
    onModelStart: (model) => {
      if (args.headless) return;
      process.stdout.write(chalk.gray(`[${model}] Thinking...`));
    },
    onModelEnd: () => {
      if (args.headless) return;
      process.stdout.write('\r\x1b[K'); // Clear the line
    }
  };
  
  // Create and run agent
  const agent = new AutonomousAgent(modelAdapter, {
    cwd: args.cwd,
    session,
    autoConfirm: args.yes
  });
  
  console.log(chalk.cyan('Goal:'), args.goal);
  console.log(chalk.gray('─'.repeat(50)));
  
  try {
    const result = await agent.execute(args.goal, ui);
    
    if (result.success) {
      console.log(chalk.gray('─'.repeat(50)));
      console.log(chalk.green('✅ Success!'));
      if (result.message) {
        console.log(chalk.gray(result.message));
      }
    } else if (result.needsHelp) {
      console.log(chalk.gray('─'.repeat(50)));
      console.log(chalk.yellow('⚠️  Need help:'));
      console.log(result.message);
    } else {
      console.log(chalk.gray('─'.repeat(50)));
      console.log(chalk.red('❌ Failed:'), result.error || 'Unknown error');
    }
    
    // Save session and local context
    saveSession(session);
    const contextManager = getContextManager(args.cwd);
    contextManager.saveContext(session);
  } catch (error) {
    console.error(chalk.red('Fatal error:'), error);
    process.exit(1);
  }
}