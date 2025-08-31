import { execa } from 'execa';
import chalk from 'chalk';

export async function runCommand(
  command,
  { cwd, onStdout, onStderr, env, timeoutMs, idleTimeoutMs } = {},
) {
  const [cmd, ...rest] = Array.isArray(command) ? command : command.split(' ');
  const args = rest;
  return new Promise((resolve) => {
    const collected = { stdout: '', stderr: '' };
    let inactivityTimer;
    const resetInactivity = () => {
      if (idleTimeoutMs) {
        clearTimeout(inactivityTimer);
        inactivityTimer = setTimeout(() => {
          try { proc.kill('SIGTERM', { forceKillAfterTimeout: 2000 }); } catch {}
          resolve({ ok: false, code: 124, error: 'Interactive or idle timeout', ...collected, timeout: 'idle' });
        }, idleTimeoutMs);
      }
    };

    const proc = execa(cmd, args, { cwd, stdio: 'pipe', shell: true, env, timeout: timeoutMs });
    resetInactivity();
    proc.stdout?.on('data', (d) => {
      const s = d.toString();
      collected.stdout += s;
      if (onStdout) onStdout(s); else process.stdout.write(s);
      resetInactivity();
    });
    proc.stderr?.on('data', (d) => {
      const s = d.toString();
      collected.stderr += s;
      if (onStderr) onStderr(s); else process.stderr.write(s);
      resetInactivity();
    });
    proc
      .then(() => {
        clearTimeout(inactivityTimer);
        resolve({ ok: true, code: 0, ...collected });
      })
      .catch((err) => {
        clearTimeout(inactivityTimer);
        const msg = err?.stderr || err?.stdout || err?.message || String(err);
        if (!onStderr) console.error('\n' + chalk.red(`Command failed: ${msg}`));
        resolve({ ok: false, code: err.exitCode ?? 1, error: msg, ...collected });
      });
  });
}
