import chalk from 'chalk';
import { runCommand } from './tools/shell.js';

function detectInteractive(stdout, stderr) {
  const text = (stdout || '') + '\n' + (stderr || '');
  const patterns = [
    /\?\s.*(yes|no|y\/n|No \/ Yes|Yes \/ No)/i,
    /Would you like to/i,
    /Select a package manager/i,
    /Enter .*:/i,
    /Password:/i,
    /Press Enter to continue/i,
    /›\s/,
  ];
  return patterns.some((re) => re.test(text));
}

export async function smartRunCommand({ command, cwd, ui, models, options = {}, session }) {
  const baseEnv = {
    CI: '1',
    ADBLOCK: '1',
    FORCE_COLOR: '1',
    npm_config_yes: options.autoConfirm ? 'true' : undefined,
  };
  if (ui?.onLog) ui.onLog(chalk.gray(`Executing command...`));
  if (ui?.onCommandStart) ui.onCommandStart(command);
  const res = await runCommand(command, {
    cwd,
    env: baseEnv,
    onStdout: ui?.onCommandOut,
    onStderr: ui?.onCommandErr,
    idleTimeoutMs: 15000,
    timeoutMs: 15 * 60 * 1000,
  });
  if (ui?.onCommandDone) ui.onCommandDone({ code: res.code ?? 0, ok: !!res.ok });
  if (res.ok) return { ok: true, stdout: res.stdout, stderr: res.stderr };

  const interactive = res.timeout === 'idle' || detectInteractive(res.stdout, res.stderr);
  const failure = !interactive;

  // Ask Flash to classify and provide guidance
  const context = {
    command,
    cwd,
    exitCode: res.code,
    interactive,
    stdoutTail: (res.stdout || '').slice(-2000),
    stderrTail: (res.stderr || '').slice(-2000),
  };
  const analysisPrompt = `You are the planning brain (Gemini Flash) helping a CLI detect issues when running commands. Classify the situation and suggest a strategy.
Return compact JSON only:
{"status":"interactive|error|stuck","summary":"...","hint":"short tip"}`;
  const analysisText = await models.generateWithFlash(
    `${analysisPrompt}\n\nContext:\n${JSON.stringify(context, null, 2)}`,
    0.2,
  );
  let classification;
  try { classification = JSON.parse(analysisText.replace(/^[^\{]*/,'').replace(/\}[^\}]*$/,'}')); } catch {}
  if (classification && ui?.onLog) ui.onLog(`Flash says: ${classification.status || 'unknown'} - ${classification.summary || ''}`);

  // Ask Pro to craft next step
  const retryPrompt = `You are the coding/execution brain (Gemini Pro). Given the command context and Flash assessment, propose the next step.
Return JSON only with one of the following actions:
{"action":"run","commands":["exact command to run"],"note":"why"}
or
{"action":"ask_user","question":"what you need"}
or
{"action":"abort","note":"why"}

Rules:
- Prefer non-interactive flags (e.g., --yes/--no-, CI=1) and explicit answers (e.g., --no-turbopack for Next.js).
- You may chain commands with '&&' or return multiple commands.
- Keep commands safe and idempotent if possible.
- If critical missing info, choose ask_user.`;

  const retryText = await models.generateProWithContext(
    `${retryPrompt}\n\nContext:\n${JSON.stringify({ context, classification }, null, 2)}`,
    session,
    0.2,
  );
  let retry;
  try { retry = JSON.parse(retryText.replace(/^[^\{]*/,'').replace(/\}[^\}]*$/,'}')); } catch {}
  if (!retry || !retry.action) {
    if (ui?.onLog) ui.onLog('Pro did not return a valid plan. Aborting.');
    return { ok: false, error: 'No valid retry plan' };
  }

  if (retry.action === 'ask_user') {
    if (ui?.onLog) ui.onLog(`Needs input: ${retry.question || 'additional details required.'}`);
    return { ok: false, error: 'User input required' };
  }
  if (retry.action === 'abort') {
    if (ui?.onLog) ui.onLog(`Aborted: ${retry.note || ''}`);
    return { ok: false, error: 'Aborted by model' };
  }
  if (retry.action === 'run') {
    const cmds = Array.isArray(retry.commands) ? retry.commands : [String(retry.commands || '')];
    if (ui?.onLog && retry.note) ui.onLog(retry.note);
    for (const cmd of cmds) {
      if (ui?.onCommandStart) ui.onCommandStart(cmd);
      const again = await runCommand(cmd, {
        cwd,
        env: baseEnv,
        onStdout: ui?.onCommandOut,
        onStderr: ui?.onCommandErr,
        idleTimeoutMs: 15000,
        timeoutMs: 15 * 60 * 1000,
      });
      if (ui?.onCommandDone) ui.onCommandDone({ code: again.code ?? 0, ok: !!again.ok });
      if (!again.ok) {
        return { ok: false, error: again.error || 'Retry failed', stdout: again.stdout, stderr: again.stderr };
      }
    }
    return { ok: true };
  }

  return { ok: false, error: 'Unknown retry action', stdout: res.stdout, stderr: res.stderr };
}
