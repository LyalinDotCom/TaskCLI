import chalk from 'chalk';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { planningPrompt, codeGenPrompt, editFilePrompt, planAdjustPrompt } from './prompts.js';
import { appendEvent, summarizeMemory, upsertTask } from './session.js';
import { writeFile as writeFs, readFile as readFs } from './tools/fs.js';
import { runCommand } from './tools/shell.js';
import { smartRunCommand } from './adaptive.js';
import { webSearch } from './tools/search.js';
import { printTaskList, startTask, taskSuccess, taskFailure } from './ui.js';
import { runProAgentCycle } from './agent.js';
import { withUICancel, CancelledError } from './utils/cancel.js';

function safeParseJSON(text) {
  try {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    const slice = start >= 0 && end >= 0 ? text.slice(start, end + 1) : text;
    return JSON.parse(slice);
  } catch (e) {
    return null;
  }
}

async function planTasks({ userGoal, models, session, ui }) {
  const memorySummary = summarizeMemory(session);
  const prompt = planningPrompt({ goal: userGoal, memorySummary, cwd: session.meta.cwd });
  if (ui?.onLog) ui.onLog('🧠 Planning with Gemini Flash...');
  if (ui?.onModelStart) ui.onModelStart(session?.meta?.flashModel || 'gemini-2.5-flash');
  const text = await withUICancel(ui, (signal) => models.generateWithFlash(prompt, 0.3, { signal }));
  if (ui?.onModelEnd) ui.onModelEnd();
  const parsed = safeParseJSON(text);
  if (!parsed || !Array.isArray(parsed.tasks)) {
    throw new Error('Planner did not return valid JSON task list.');
  }
  // Append hidden closeout task
  parsed.tasks.push({ id: 'TCLOSE', type: 'session_close', title: 'Close out session', hidden: true });
  if (ui?.onPlan) ui.onPlan(parsed.tasks);
  if (ui?.onLog) {
    const visible = parsed.tasks.filter((t) => t.type !== 'session_close');
    ui.onLog(`Tasks created (${visible.length}):`);
    for (const t of visible) {
      ui.onLog(` - ${t.id} ${t.title} [${t.type}]${t.rationale ? ` — ${t.rationale}` : ''}`);
    }
  }
  return parsed.tasks;
}

async function execTask(task, ctx) {
  const { session, models, options } = ctx;
  if (ctx.ui?.onTaskStart) ctx.ui.onTaskStart(task);
  if (ctx.ui?.onLog) ctx.ui.onLog(`Starting task ${task.id}: ${task.title} [${task.type}]`);
  else startTask(task);
  try {
    switch (task.type) {
      case 'ask_user': {
        const qs = Array.isArray(task.questions) ? task.questions : [];
        const msg = qs.length
          ? 'Needs clarification:\n- ' + qs.join('\n- ')
          : 'Needs clarification from the user to proceed.';
        appendEvent(session, { type: 'ask_user', summary: msg });
        if (ctx.ui?.onLog) ctx.ui.onLog(msg);
        // Stop execution to wait for user input
        throw new Error('user_input_required');
      }
      case 'read_file': {
        const res = await readFs(session.meta.cwd, task.path);
        appendEvent(session, { type: 'read_file', summary: `Read ${task.path}` });
        if (ctx.ui?.onLog) ctx.ui.onLog(`Read file: ${task.path} (${res.content.length} bytes)`);
        if (ctx.ui?.onTaskSuccess) ctx.ui.onTaskSuccess(task, res.content);
        else taskSuccess(task);
        return { ok: true, data: res.content };
      }
      case 'write_file': {
        let content = task.content;
        if (!content && task.content_prompt) {
          if (ctx.ui?.onModelStart) ctx.ui.onModelStart(session?.meta?.proModel || 'gemini-2.5-pro');
          const code = await withUICancel(ctx.ui, (signal) => models.generateProWithContext(
            codeGenPrompt({ instruction: task.content_prompt, context: `Path: ${task.path}` }),
            session,
            0.2,
            { signal },
          ));
          if (ctx.ui?.onModelEnd) ctx.ui.onModelEnd();
          content = code;
        }
        if (!content) throw new Error('No content to write.');
        await writeFs(session.meta.cwd, task.path, content);
        appendEvent(session, { type: 'write_file', summary: `Wrote ${task.path}` });
        if (ctx.ui?.onLog) ctx.ui.onLog(`Wrote file: ${task.path} (${content.length} bytes)`);
        if (ctx.ui?.onTaskSuccess) ctx.ui.onTaskSuccess(task);
        else taskSuccess(task);
        return { ok: true };
      }
      case 'generate_file_from_prompt': {
        if (ctx.ui?.onModelStart) ctx.ui.onModelStart(session?.meta?.proModel || 'gemini-2.5-pro');
        const code = await withUICancel(ctx.ui, (signal) => models.generateProWithContext(
          codeGenPrompt({ instruction: task.prompt, context: `Path: ${task.path}` }),
          session,
          0.2,
          { signal },
        ));
        if (ctx.ui?.onModelEnd) ctx.ui.onModelEnd();
        await writeFs(session.meta.cwd, task.path, code);
        appendEvent(session, { type: 'write_file', summary: `Generated ${task.path}` });
        if (ctx.ui?.onLog) ctx.ui.onLog(`Generated file: ${task.path} (${code.length} bytes)`);
        if (ctx.ui?.onTaskSuccess) ctx.ui.onTaskSuccess(task);
        else taskSuccess(task);
        return { ok: true };
      }
      case 'edit_file': {
        const current = await readFs(session.meta.cwd, task.path);
        if (ctx.ui?.onModelStart) ctx.ui.onModelStart(session?.meta?.proModel || 'gemini-2.5-pro');
        const updated = await withUICancel(ctx.ui, (signal) => models.generateProWithContext(
          editFilePrompt({ filepath: task.path, currentContent: current.content, instruction: task.instruction, context: '' }),
          session,
          0.2,
          { signal },
        ));
        if (ctx.ui?.onModelEnd) ctx.ui.onModelEnd();
        await writeFs(session.meta.cwd, task.path, updated);
        appendEvent(session, { type: 'edit_file', summary: `Edited ${task.path}` });
        if (ctx.ui?.onLog) ctx.ui.onLog(`Edited file: ${task.path} (${updated.length} bytes)`);
        if (ctx.ui?.onTaskSuccess) ctx.ui.onTaskSuccess(task);
        else taskSuccess(task);
        return { ok: true };
      }
      case 'run_command': {
        const confirm = task.confirm === undefined ? true : !!task.confirm;
        // If task.cwd is provided and not absolute, resolve it relative to session cwd
        let cwd = session.meta.cwd;
        if (task.cwd) {
          cwd = path.isAbsolute(task.cwd) ? task.cwd : path.join(session.meta.cwd, task.cwd);
        }
        if (confirm && !options.autoConfirm && ctx.ui?.onLog) {
          ctx.ui.onLog(chalk.yellow(`About to run: ${task.command}`));
          ctx.ui.onLog(chalk.gray('Use --yes to auto-confirm in the future.'));
        } else if (confirm && !options.autoConfirm) {
          console.log(chalk.yellow(`About to run: ${task.command}`));
          console.log(chalk.gray('Use --yes to auto-confirm in the future.'));
        }
        const res = await smartRunCommand({ command: task.command, cwd, ui: ctx.ui, models, options, session });
        appendEvent(session, { type: 'run_command', summary: `${res.ok ? 'Ran' : 'Failed'}: ${task.command}`, stdout: res.stdout, stderr: res.stderr });
        if (!res.ok) throw new Error(res.error || 'Command failed');
        // If the command looks like a directory listing, summarize results with Pro
        const looksLikeList = /(^|\s)(ls|find|tree|dir)(\s|$)/.test(task.command);
        if (looksLikeList && res.stdout) {
          const summaryPrompt = `Summarize the following directory listing concisely for a human:
Provide:
- Top-level files and directories (short bullet list)
- Notable files (README, package.json, etc.)
- Rough counts of subdirectories / files when large
- Keep under ~12 lines; do not repeat the entire listing

Listing:
${res.stdout.slice(-50000)}`;
          try {
          if (ctx.ui?.onModelStart) ctx.ui.onModelStart(session?.meta?.proModel || 'gemini-2.5-pro');
          const summary = await withUICancel(ctx.ui, (signal) => models.generateProWithContext(summaryPrompt, session, 0.2, { signal }));
          if (ctx.ui?.onModelEnd) ctx.ui.onModelEnd();
            if (ctx.ui?.onTaskSuccess) ctx.ui.onTaskSuccess(task, summary);
            else taskSuccess(task);
          } catch {
            if (ctx.ui?.onTaskSuccess) ctx.ui.onTaskSuccess(task);
            else taskSuccess(task);
          }
        } else {
          if (ctx.ui?.onTaskSuccess) ctx.ui.onTaskSuccess(task);
          else taskSuccess(task);
        }
        return { ok: true };
      }
      case 'search_web': {
        const q = task.query || task.q || '';
        const num = task.numResults || 5;
        const res = await webSearch(q, {});
        const top = res.results.slice(0, num);
        appendEvent(session, { type: 'search_web', summary: `Searched: ${q}` });
        if (ctx.ui?.onLog) {
          ctx.ui.onLog(`Search results for: ${q}`);
          for (const r of top) ctx.ui.onLog(` - ${r.title} (${r.url})`);
        }
        if (ctx.ui?.onTaskSuccess) ctx.ui.onTaskSuccess(task, top);
        else taskSuccess(task);
        return { ok: true, data: top };
      }
      case 'session_close': {
        const here = path.dirname(fileURLToPath(import.meta.url));
        const candidates = [
          path.join(here, '..', 'prompts', 'pro-closeout.md'),
          path.join(here, '..', '..', 'TaskCLI', 'prompts', 'pro-closeout.md'),
        ];
        let closeText = 'Compose a concise closing note for the user with completed items, next steps, and open questions.';
        for (const c of candidates) {
          if (fs.existsSync(c)) { closeText = fs.readFileSync(c, 'utf8'); break; }
        }
        if (ctx.ui?.onLog) ctx.ui.onLog('Preparing session closeout...');
        const timeoutMs = Number(process.env.PRO_CLOSEOUT_TIMEOUT_MS || 15000);
        let finalNote;
        try {
          if (ctx.ui?.onModelStart) ctx.ui.onModelStart(session?.meta?.proModel || 'gemini-2.5-pro');
          finalNote = await withUICancel(ctx.ui, (signal) => Promise.race([
            models.generateProWithContext(closeText, session, 0.2, { signal }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Closeout timed out')), timeoutMs)),
          ]));
          if (ctx.ui?.onModelEnd) ctx.ui.onModelEnd();
        } catch (e) {
          if (e && e.cancelled) throw e;
          // Fallback local closeout summary
          const items = [];
          const hist = session.history || [];
          const wrote = hist.filter(h => h.type === 'write_file').map(h => h.summary);
          const ran = hist.filter(h => h.type === 'run_command').map(h => h.summary);
          if (wrote.length) items.push(`Files written: ${wrote.join('; ')}`);
          if (ran.length) items.push(`Commands run: ${ran.join('; ')}`);
          items.push('Next steps: review generated files, rerun commands if needed, and provide any missing preferences.');
          finalNote = items.join('\n');
        }
        if (ctx.ui?.onTaskSuccess) ctx.ui.onTaskSuccess(task, finalNote);
        else taskSuccess(task);
        appendEvent(session, { type: 'closeout', summary: 'Generated closeout note' });
        return { ok: true };
      }
      default:
        throw new Error(`Unknown task type: ${task.type}`);
    }
  } catch (error) {
    if (error && error.cancelled) return { ok: false, error: 'cancelled' };
    if (ctx.ui?.onTaskFailure) ctx.ui.onTaskFailure(task, error);
    else taskFailure(task, error);
    return { ok: false, error: error?.message || String(error) };
  }
}

export async function orchestrate({ userGoal, models, session, options = {}, ui }) {
  appendEvent(session, { type: 'user_goal', message: userGoal });
  let plan;
  try {
    plan = await planTasks({ userGoal, models, session, ui });
  } catch (e) {
    appendEvent(session, { type: 'plan_error', message: String(e) });
    if (ui?.onModelEnd) ui.onModelEnd(); // Ensure spinner is off
    if (ui?.onLog) ui.onLog(chalk.red('Planning failed: ') + String(e?.message || e));
    else console.log(chalk.red('Planning failed: ') + String(e?.message || e));
    return { ok: false, error: e?.message || String(e) };
  }

  // Merge into session tasks store
  for (const t of plan) upsertTask(session, { ...t, status: 'pending' });
  if (!ui?.onPlan) printTaskList(plan);

  // Execute tasks sequentially; each step may require multiple agent cycles
  const MAX_STEP_CYCLES = Number(process.env.TASKCLI_MAX_STEP_CYCLES || 20);
  const visibleTasks = plan.filter((t) => t.type !== 'session_close');

  // If user requested cancel during planning, respect it now
  if (ui?.shouldCancel && ui.shouldCancel()) {
    if (ui?.onModelEnd) ui.onModelEnd(); // Ensure spinner is off
    if (ui?.onLog) ui.onLog('Execution cancelled by user.');
    return { ok: false, error: 'cancelled' };
  }
  for (const task of visibleTasks) {
    // Start visual status
    if (ui?.onTaskStart) ui.onTaskStart(task); else startTask(task);

    let stepDone = false;
    const attemptHistory = [];
    let lastError = null;
    let consecutiveFailures = 0;
    const MAX_CONSECUTIVE_FAILURES = 3;

    for (let i = 0; i < MAX_STEP_CYCLES && !stepDone; i++) {
      // Allow cancel between cycles
      if (ui?.shouldCancel && ui.shouldCancel()) {
        if (ui?.onModelEnd) ui.onModelEnd(); // Ensure spinner is off
        if (ui?.onLog) ui.onLog('Execution cancelled by user.');
        return { ok: false, error: 'cancelled' };
      }

      // For simple tasks that don't need agent reasoning, execute directly
      const directExecuteTasks = ['run_command', 'read_file', 'write_file', 'generate_file_from_prompt', 'edit_file', 'search_web'];
      if (directExecuteTasks.includes(task.type)) {
        const simpleRes = await execTask(task, { session, models, options, ui });
        if (simpleRes.ok) {
          stepDone = true;
          break;
        } else {
          lastError = simpleRes.error;
          attemptHistory.push(`Direct execution failed: ${simpleRes.error}`);
          // For these task types, don't try agent cycle - just fail after max attempts
          consecutiveFailures++;
          if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            if (ui?.onLog) ui.onLog(`Task failed after ${MAX_CONSECUTIVE_FAILURES} attempts.`);
            stepDone = true;
            break;
          }
          continue;
        }
      }

      const agentRes = await runProAgentCycle({ 
        userGoal, 
        plan: [task], 
        session, 
        models, 
        options, 
        ui,
        previousAttempts: attemptHistory.slice(-3), // Only pass last 3 attempts
        lastError 
      });
      
      if (!agentRes.ok) {
        if (agentRes.cancelled) {
          if (ui?.onModelEnd) ui.onModelEnd(); // Ensure spinner is off
          if (ui?.onLog) ui.onLog('Execution cancelled by user.');
          return { ok: false, error: 'cancelled' };
        }
        
        // Track the failure
        lastError = agentRes.error;
        const failureDetail = agentRes.executedActions ? 
          agentRes.executedActions.map(a => `${a.action}: ${a.success ? 'ok' : a.error}`).join(', ') :
          agentRes.error;
        attemptHistory.push(failureDetail);
        consecutiveFailures++;
        
        // If we've failed too many times with the same error, bail out
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          if (ui?.onLog) ui.onLog(`Task failed after ${MAX_CONSECUTIVE_FAILURES} consecutive failures. Moving on.`);
          stepDone = true;
          break;
        }
        
        // Provide better feedback about what went wrong
        if (agentRes.invalidResponse) {
          if (ui?.onLog) ui.onLog('Agent returned invalid JSON. Retrying with clearer instructions...');
        } else if (agentRes.error && agentRes.error.includes('ENOENT')) {
          if (ui?.onLog) ui.onLog('File not found. Agent will try a different approach...');
        } else {
          if (ui?.onLog) ui.onLog(`Agent attempt failed: ${agentRes.error}. Retrying...`);
        }
        continue;
      }
      
      // Reset consecutive failures on success
      consecutiveFailures = 0;

      if (agentRes.next === 'cancel') {
        if (ui?.onModelEnd) ui.onModelEnd(); // Ensure spinner is off
        if (ui?.onLog) ui.onLog('Agent requested cancel.');
        return { ok: false, error: 'cancelled' };
      }
      if (agentRes.next === 'ask_user') {
        if (ui?.onModelEnd) ui.onModelEnd(); // Ensure spinner is off
        if (ui?.onLog) ui.onLog('Agent needs user input to proceed.');
        return { ok: false, error: 'user_input_required' };
      }
      if (agentRes.complete) {
        // Mark task done and show final result if provided
        if (ui?.onTaskSuccess) ui.onTaskSuccess(task, agentRes.final); else taskSuccess(task);
        stepDone = true;
        break;
      }
      // Otherwise continue another cycle to observe outputs and act again
    }

    if (!stepDone) {
      // Defensive: avoid infinite loops
      if (ui?.onLog) ui.onLog(chalk.yellow(`Max cycles reached for ${task.id}. Marking as done.`));
      if (ui?.onTaskSuccess) ui.onTaskSuccess(task); else taskSuccess(task);
    }

    // Update session task state
    upsertTask(session, { ...task, status: 'done' });

    // After each step, check for queued user inputs to adjust or cancel
    const queued = typeof ui?.drainQueuedInputs === 'function' ? ui.drainQueuedInputs() : [];
    if (queued && queued.length > 0) {
      const adjustPrompt = planAdjustPrompt({ goal: userGoal, currentPlan: plan.filter((t) => !t.hidden), queuedInputs: queued });
      const text = await models.generateWithFlash(adjustPrompt, 0.2);
      const parsed = safeParseJSON(text) || {};
      if (parsed.action === 'cancel') {
        if (ui?.onLog) ui.onLog(`Cancelled: ${parsed.note || ''}`);
        return { ok: false, error: 'cancelled' };
      }
      if (parsed.action === 'update' && Array.isArray(parsed.tasks)) {
        // Replace remaining plan and restart execution from the new plan
        const closeTask = plan.find((p) => p.type === 'session_close');
        plan = parsed.tasks.concat(closeTask ? [closeTask] : []);
        // Reset state for next tasks
        if (ui?.onPlan) ui.onPlan(plan); else printTaskList(plan);
      }
    }
  }

  // Final closeout task (if present)
  const close = plan.find((t) => t.type === 'session_close');
  if (close) {
    const res = await execTask(close, { session, models, options, ui });
    if (!res.ok) {
      appendEvent(session, { type: 'task_failed', message: close.title, error: res.error });
      return { ok: false, error: res.error };
    }
  }

  const total = plan.length;
  appendEvent(session, { type: 'completed', summary: `Completed ${total} tasks` });
  
  // Ensure model spinner is turned off
  if (ui?.onModelEnd) ui.onModelEnd();
  
  if (ui?.onComplete) ui.onComplete(total);
  else console.log(chalk.green(`\nAll ${total} tasks completed.`));
  return { ok: true };
}
