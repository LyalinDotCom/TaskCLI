import { execa } from 'execa';
import chalk from 'chalk';

export async function runCommand(
  command,
  { cwd, onStdout, onStderr } = {},
) {
  const [cmd, ...rest] = Array.isArray(command) ? command : command.split(' ');
  const args = rest;
  return new Promise((resolve) => {
    const proc = execa(cmd, args, { cwd, stdio: 'pipe', shell: true });
    proc.stdout?.on('data', (d) => {
      const s = d.toString();
      if (onStdout) onStdout(s);
      else process.stdout.write(s);
    });
    proc.stderr?.on('data', (d) => {
      const s = d.toString();
      if (onStderr) onStderr(s);
      else process.stderr.write(s);
    });
    proc
      .then(() => resolve({ ok: true, code: 0 }))
      .catch((err) => {
        const msg = err?.stderr || err?.stdout || err?.message || String(err);
        if (!onStderr) console.error('\n' + chalk.red(`Command failed: ${msg}`));
        resolve({ ok: false, code: err.exitCode ?? 1, error: msg });
      });
  });
}
