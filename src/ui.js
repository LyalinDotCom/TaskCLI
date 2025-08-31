import chalk from 'chalk';

export function printHeader() {
  const title = chalk.bold.cyan('TaskCLI');
  console.log(`${title} — AI Task Orchestrator for coding`);
}

export function printTaskList(tasks) {
  console.log(chalk.bold('\nPlanned Tasks:'));
  for (const t of tasks) {
    console.log(`  ${chalk.gray(t.id)} ${chalk.white(t.title)} ${chalk.gray('[' + t.type + ']')}`);
    if (t.rationale) console.log(`    ${chalk.dim(t.rationale)}`);
  }
}

export function startTask(task) {
  const label = `${task.id} ${task.title}`;
  process.stdout.write(`→ ${chalk.white(label)} ${chalk.gray('...')}\n`);
}

export function taskSuccess(task) {
  const label = `${task.id} ${task.title}`;
  console.log(`${chalk.green('✔')} ${chalk.white(label)}`);
}

export function taskFailure(task, error) {
  const label = `${task.id} ${task.title}`;
  console.log(`${chalk.red('✖')} ${chalk.white(label)} ${chalk.red(String(error || 'failed'))}`);
}

