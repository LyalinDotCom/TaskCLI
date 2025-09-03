import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import chalk from 'chalk';
import { fileURLToPath, pathToFileURL } from 'node:url';

export async function runDoctor() {
  const checks = [];
  const push = (name, ok, info = '') => checks.push({ name, ok, info });

  // Node version
  const nodeMajor = parseInt(process.versions.node.split('.')[0], 10);
  push('Node >= 20', nodeMajor >= 20, process.versions.node);

  // Env keys
  const hasKey = !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
  push('Gemini API key configured', hasKey, hasKey ? 'set' : 'missing');

  // Bin is executable
  try {
    fs.accessSync(path.resolve('bin/taskcli.js'), fs.constants.X_OK);
    push('CLI bin is executable', true);
  } catch {
    push('CLI bin is executable', false, 'chmod +x bin/taskcli.js');
  }

  // Print results
  console.log(chalk.bold('\nTaskCLI Doctor'));
  let allOk = true;
  for (const c of checks) {
    allOk &&= c.ok;
    console.log(`${c.ok ? chalk.green('✔') : chalk.red('✖')} ${c.name}${c.info ? chalk.gray(` (${c.info})`) : ''}`);
  }
  if (!allOk) {
    console.log('\n' + chalk.yellow('Some checks failed. Fix them and retry.'));
  } else {
    console.log('\n' + chalk.green('All checks passed.'));
  }
}

