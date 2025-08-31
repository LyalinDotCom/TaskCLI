import { execa } from 'execa';
import chalk from 'chalk';

export async function runCommand(command, { cwd, interactive = true } = {}) {
  const [cmd, ...args] = Array.isArray(command) ? command : command.split(' ');
  return new Promise((resolve) => {
    const proc = execa(cmd, args, { cwd, stdio: 'pipe', shell: true });
    proc.stdout?.on('data', (d) => process.stdout.write(d.toString()));
    proc.stderr?.on('data', (d) => process.stderr.write(d.toString()));
    proc.then(() => resolve({ ok: true, code: 0 })).catch((err) => {
      const msg = err?.stderr || err?.stdout || err?.message || String(err);
      console.error('\n' + chalk.red(`Command failed: ${msg}`));
      resolve({ ok: false, code: err.exitCode ?? 1, error: msg });
    });
  });
}
