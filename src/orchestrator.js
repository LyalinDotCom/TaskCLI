import chalk from 'chalk';
import { planningPrompt, codeGenPrompt, editFilePrompt } from './prompts.js';
import { appendEvent, summarizeMemory, upsertTask } from './session.js';
import { writeFile as writeFs, readFile as readFs } from './tools/fs.js';
import { runCommand } from './tools/shell.js';
import { smartRunCommand } from './adaptive.js';
import { webSearch } from './tools/search.js';
import { printTaskList, startTask, taskSuccess, taskFailure } from './ui.js';

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
  if (ui?.onPlan) ui.onPlan(parsed.tasks);
  return parsed.tasks;
}

async function execTask(task, ctx) {
  const { session, models, options } = ctx;
  if (ctx.ui?.onTaskStart) ctx.ui.onTaskStart(task);
  else startTask(task);
  try {
    switch (task.type) {
      case 'read_file': {
        const res = await readFs(session.meta.cwd, task.path);
        appendEvent(session, { type: 'read_file', summary: `Read ${task.path}` });
        if (ctx.ui?.onTaskSuccess) ctx.ui.onTaskSuccess(task, res.content);
        else taskSuccess(task);
        return { ok: true, data: res.content };
      }
      case 'write_file': {
        let content = task.content;
        if (!content && task.content_prompt) {
          const code = await models.generateWithPro(codeGenPrompt({ instruction: task.content_prompt, context: `Path: ${task.path}` }));
          content = code;
        }
        if (!content) throw new Error('No content to write.');
        await writeFs(session.meta.cwd, task.path, content);
        appendEvent(session, { type: 'write_file', summary: `Wrote ${task.path}` });
        if (ctx.ui?.onTaskSuccess) ctx.ui.onTaskSuccess(task);
        else taskSuccess(task);
        return { ok: true };
      }
      case 'generate_file_from_prompt': {
        const code = await models.generateWithPro(codeGenPrompt({ instruction: task.prompt, context: `Path: ${task.path}` }));
        await writeFs(session.meta.cwd, task.path, code);
        appendEvent(session, { type: 'write_file', summary: `Generated ${task.path}` });
        if (ctx.ui?.onTaskSuccess) ctx.ui.onTaskSuccess(task);
        else taskSuccess(task);
        return { ok: true };
      }
      case 'edit_file': {
        const current = await readFs(session.meta.cwd, task.path);
        const updated = await models.generateWithPro(
          editFilePrompt({ filepath: task.path, currentContent: current.content, instruction: task.instruction, context: '' })
        );
        await writeFs(session.meta.cwd, task.path, updated);
        appendEvent(session, { type: 'edit_file', summary: `Edited ${task.path}` });
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
        const res = await smartRunCommand({ command: task.command, cwd, ui: ctx.ui, models, options });
        appendEvent(session, { type: 'run_command', summary: `${res.ok ? 'Ran' : 'Failed'}: ${task.command}` });
        if (!res.ok) throw new Error(res.error || 'Command failed');
        if (ctx.ui?.onTaskSuccess) ctx.ui.onTaskSuccess(task);
        else taskSuccess(task);
        return { ok: true };
      }
      case 'search_web': {
        const q = task.query || task.q || '';
        const num = task.numResults || 5;
        const res = await webSearch(q, {});
        const top = res.results.slice(0, num);
        appendEvent(session, { type: 'search_web', summary: `Searched: ${q}` });
        if (ctx.ui?.onTaskSuccess) ctx.ui.onTaskSuccess(task, top);
        else taskSuccess(task);
        return { ok: true, data: top };
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
  let tasks;
  try {
    tasks = await planTasks({ userGoal, models, session, ui });
  } catch (e) {
    appendEvent(session, { type: 'plan_error', message: String(e) });
    if (ui?.onLog) ui.onLog(chalk.red('Planning failed: ') + String(e?.message || e));
    else console.log(chalk.red('Planning failed: ') + String(e?.message || e));
    return { ok: false, error: e?.message || String(e) };
  }

  // Merge into session tasks
  for (const t of tasks) upsertTask(session, { ...t, status: 'pending' });
  if (!ui?.onPlan) printTaskList(tasks);

  // Execute tasks in order
  for (const task of tasks) {
    const res = await execTask(task, { session, models, options, ui });
    if (!res.ok) {
      appendEvent(session, { type: 'task_failed', message: task.title, error: res.error });
      return { ok: false, error: res.error };
    }
    upsertTask(session, { ...task, status: 'done' });
  }

  appendEvent(session, { type: 'completed', summary: `Completed ${tasks.length} tasks` });
  if (ui?.onComplete) ui.onComplete(tasks.length);
  else console.log(chalk.green(`\nAll ${tasks.length} tasks completed.`));
  return { ok: true };
}
