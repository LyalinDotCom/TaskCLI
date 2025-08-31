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
  const text = await models.generateWithFlash(prompt, 0.3);
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
          const code = await models.generateProWithContext(
            codeGenPrompt({ instruction: task.content_prompt, context: `Path: ${task.path}` }),
            session,
          );
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
        const code = await models.generateProWithContext(
          codeGenPrompt({ instruction: task.prompt, context: `Path: ${task.path}` }),
          session,
        );
        await writeFs(session.meta.cwd, task.path, code);
        appendEvent(session, { type: 'write_file', summary: `Generated ${task.path}` });
        if (ctx.ui?.onLog) ctx.ui.onLog(`Generated file: ${task.path} (${code.length} bytes)`);
        if (ctx.ui?.onTaskSuccess) ctx.ui.onTaskSuccess(task);
        else taskSuccess(task);
        return { ok: true };
      }
      case 'edit_file': {
        const current = await readFs(session.meta.cwd, task.path);
        const updated = await models.generateProWithContext(
          editFilePrompt({ filepath: task.path, currentContent: current.content, instruction: task.instruction, context: '' }),
          session,
        );
        await writeFs(session.meta.cwd, task.path, updated);
        appendEvent(session, { type: 'edit_file', summary: `Edited ${task.path}` });
        if (ctx.ui?.onLog) ctx.ui.onLog(`Edited file: ${task.path} (${updated.length} bytes)`);
        if (ctx.ui?.onTaskSuccess) ctx.ui.onTaskSuccess(task);
        else taskSuccess(task);
        return { ok: true };
      }
      case 'run_command': {
        const confirm = task.confirm === undefined ? true : !!task.confirm;
        const cwd = task.cwd ? task.cwd : session.meta.cwd;
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
            const summary = await models.generateProWithContext(summaryPrompt, session, 0.2);
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
          finalNote = await Promise.race([
            models.generateProWithContext(closeText, session, 0.2),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Closeout timed out')), timeoutMs)),
          ]);
        } catch (e) {
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
    if (ui?.onLog) ui.onLog(chalk.red('Planning failed: ') + String(e?.message || e));
    else console.log(chalk.red('Planning failed: ') + String(e?.message || e));
    return { ok: false, error: e?.message || String(e) };
  }

  // Merge into session tasks store
  for (const t of plan) upsertTask(session, { ...t, status: 'pending' });
  if (!ui?.onPlan) printTaskList(plan);

  const done = new Set();
  const byId = new Map(plan.map((t) => [t.id, t]));

  // Helper: remaining visible tasks (exclude session_close)
  const remaining = () => plan.filter((t) => t.type !== 'session_close' && !done.has(t.id));

  // Main loop: alternate agent cycles with optional plan adjustment
  let cycles = 0;
  const MAX_CYCLES = Number(process.env.TASKCLI_MAX_CYCLES || 20);
  while (cycles < MAX_CYCLES && remaining().length > 0) {
    cycles++;
    const agentRes = await runProAgentCycle({ userGoal, plan: remaining(), session, models, options, ui });
    if (!agentRes.ok) {
      if (agentRes.cancelled) {
        if (ui?.onLog) ui.onLog('Execution cancelled by user.');
        return { ok: false, error: 'cancelled' };
      }
      // Fallback: execute the very next task directly using the classic path
      const nextTask = remaining()[0];
      if (!nextTask) break;
      const res = await execTask(nextTask, { session, models, options, ui });
      if (!res.ok) {
        appendEvent(session, { type: 'task_failed', message: nextTask.title, error: res.error });
        return { ok: false, error: res.error };
      }
      done.add(nextTask.id);
      upsertTask(session, { ...nextTask, status: 'done' });
    } else {
      // Mark completed by ID if supplied
      for (const tid of agentRes.completedTasks || []) {
        if (byId.has(tid)) {
          done.add(tid);
          upsertTask(session, { ...byId.get(tid), status: 'done' });
        }
      }

      // Heuristic: if agent executed actions but no completedTasks, advance one item
      if ((!agentRes.completedTasks || agentRes.completedTasks.length === 0) && remaining().length > 0) {
        // Mark the first pending as progressed when actions ran
        done.add(remaining()[0].id);
        upsertTask(session, { ...remaining()[0], status: 'done' });
      }

      if (agentRes.next === 'cancel') {
        if (ui?.onLog) ui.onLog('Agent requested cancel.');
        return { ok: false, error: 'cancelled' };
      }
    }

    // After each cycle, check for new user inputs to adjust the plan
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
        // Replace plan with new tasks + append closeout
        const newPlan = parsed.tasks.concat(plan.find((t) => t.type === 'session_close') || []);
        plan = newPlan;
        // Rebuild maps and preserve done where possible
        byId.clear();
        for (const t of plan) byId.set(t.id, t);
        // If any tasks were removed, ignore their done state
        if (ui?.onPlan) ui.onPlan(plan);
        else printTaskList(plan);
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
  if (ui?.onComplete) ui.onComplete(total);
  else console.log(chalk.green(`\nAll ${total} tasks completed.`));
  return { ok: true };
}
