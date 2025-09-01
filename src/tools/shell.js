import { execa } from 'execa';
import chalk from 'chalk';
import fs from 'node:fs';
import path from 'node:path';

export async function runCommand(
  command,
  { cwd, onStdout, onStderr, env, timeoutMs, idleTimeoutMs, onStart } = {},
) {
  // Validate cwd exists if provided
  if (cwd && !fs.existsSync(cwd)) {
    const errorMsg = `Working directory does not exist: ${cwd}`;
    if (onStderr) onStderr(errorMsg + '\n');
    else console.error(chalk.red(errorMsg));
    return { 
      ok: false, 
      code: 1, 
      error: errorMsg,
      stdout: '', 
      stderr: errorMsg 
    };
  }
  const [cmd, ...rest] = Array.isArray(command) ? command : command.split(' ');
  const args = rest;
  return new Promise((resolve) => {
    const collected = { stdout: '', stderr: '' };
    let inactivityTimer;
    let cancelledSignal = null;
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
    if (typeof onStart === 'function') {
      try { onStart(proc); } catch {}
    }
    proc.on('exit', (_code, signal) => { if (signal) cancelledSignal = signal; });
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
        // Better error message extraction
        let msg = '';
        if (err?.code === 'ENOENT') {
          // Command not found or cwd doesn't exist
          if (err?.path === cmd) {
            msg = `Command not found: ${cmd}`;
          } else if (err?.message?.includes('cwd')) {
            msg = `Invalid working directory: ${cwd}\n${err.message}`;
          } else {
            msg = err.message || `Command failed with ENOENT: ${cmd}`;
          }
        } else {
          // Use stderr/stdout if available, otherwise use the error message
          msg = collected.stderr || collected.stdout || err?.message || String(err);
          // If we still have no output but have an exit code, provide a better message
          if (!msg || msg === String(err)) {
            msg = `Command failed with exit code ${err.exitCode ?? 1}: ${command}`;
          }
        }
        
        // Add the error to stderr if it's not already there
        if (!collected.stderr && msg) {
          collected.stderr = msg;
        }
        
        if (!onStderr && msg) console.error('\n' + chalk.red(`Command failed: ${msg}`));
        const isCancelled = !!(err?.signal || cancelledSignal) && ['SIGINT','SIGTERM','SIGKILL'].includes(err?.signal || cancelledSignal);
        resolve({ 
          ok: false, 
          code: err.exitCode ?? 1, 
          error: msg, 
          ...collected, 
          cancelled: isCancelled, 
          signal: err?.signal || cancelledSignal 
        });
      });
  });
}
