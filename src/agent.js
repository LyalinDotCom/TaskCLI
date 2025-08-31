import chalk from 'chalk';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFile as writeFs, readFile as readFs } from './tools/fs.js';
import { runCommand } from './tools/shell.js';
import { smartRunCommand } from './adaptive.js';
import { webSearch } from './tools/search.js';
import { appendEvent } from './session.js';
import { codeGenPrompt, editFilePrompt } from './prompts.js';
import { withUICancel } from './utils/cancel.js';

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

function toolSpec() {
  return `You can propose tool actions as JSON for the CLI to execute. Do NOT claim to have executed commands yourself.

Return JSON only with this shape:
{"speak":["short status lines to show the user"],
 "actions":[ ToolAction ... ],
 "completedTasks":["T1","T2"],
 "next":"continue|cancel|done",
 "complete": true|false,
 "final": "optional short summary/result for this step",
 "planUpdates": {"add":[Task], "remove":["Tid"], "note":"optional rationale"}}

Where ToolAction is one of:
- {"type":"run_command","command":"...","cwd":"optional","confirm":false}
- {"type":"write_file","path":"relative/path","content":"full content"}
- {"type":"generate_file_from_prompt","path":"relative/path","prompt":"codegen instruction"}
- {"type":"edit_file","path":"relative/path","instruction":"how to modify"}
- {"type":"read_file","path":"relative/path"}
- {"type":"search_web","query":"...","numResults":3}

Rules:
- Prefer non-interactive flags and CI-friendly options.
- Limit to at most 5 actions per cycle.
- Prefer acting on the next pending tasks from the plan; include their IDs in completedTasks.
- Avoid asking the user; make reasonable, safe assumptions and continue. Only use next="cancel" if proceeding would be destructive or clearly unsafe.
- If all work appears complete, set next="done" and include a brief recap in speak[].`;
}

function buildAgentPrompt({ userGoal, plan, cwd }) {
  const planSnapshot = (plan || [])
    .filter((t) => t && !t.hidden && t.type !== 'session_close')
    .map((t) => ({ id: t.id, type: t.type, title: t.title, rationale: t.rationale, path: t.path, command: t.command }))
    ;
  return `You are the Gemini Pro execution agent for TaskCLI. Focus on completing the current step end-to-end. You may need multiple cycles: run tools, observe output, then decide if more tool use is needed. Only mark complete when the user's step is fully satisfied.

GOAL
${userGoal}

WORKING DIR
${cwd}

CURRENT PLAN (pending only)
${JSON.stringify(planSnapshot, null, 2)}

FOCUS STEP (complete this one now)
${JSON.stringify({ id: plan?.[0]?.id, type: plan?.[0]?.type, title: plan?.[0]?.title, rationale: plan?.[0]?.rationale, path: plan?.[0]?.path, command: plan?.[0]?.command }, null, 2)}

CONTROL SPEC
${toolSpec()}

Output strictly JSON with no commentary.`;
}

async function execAction(action, ctx) {
  const { session, models, options, ui } = ctx;
  const cwd = session.meta.cwd;
  const type = action.type;
  try {
    switch (type) {
      case 'read_file': {
        const res = await readFs(cwd, action.path);
        appendEvent(session, { type: 'read_file', summary: `Read ${action.path}` });
        if (ui?.onLog) ui.onLog(`Read file: ${action.path} (${res.content.length} bytes)`);
        if (ui?.onTaskSuccess) ui.onTaskSuccess({ id: 'AG', title: `Read ${action.path}`, type }, res.content);
        return { ok: true, data: res.content };
      }
      case 'write_file': {
        let content = action.content;
        if (!content && action.content_prompt) {
          if (ui?.onModelStart) ui.onModelStart(session?.meta?.proModel || 'gemini-2.5-pro');
          const code = await withUICancel(ui, (signal) => models.generateProWithContext(
            codeGenPrompt({ instruction: action.content_prompt, context: `Path: ${action.path}` }),
            session,
            0.2,
            { signal },
          ));
          if (ui?.onModelEnd) ui.onModelEnd();
          content = code;
        }
        if (!content) throw new Error('No content provided for write_file');
        await writeFs(cwd, action.path, content);
        appendEvent(session, { type: 'write_file', summary: `Wrote ${action.path}` });
        if (ui?.onLog) ui.onLog(`Wrote file: ${action.path} (${content.length} bytes)`);
        if (ui?.onTaskSuccess) ui.onTaskSuccess({ id: 'AG', title: `Write ${action.path}`, type });
        return { ok: true };
      }
      case 'generate_file_from_prompt': {
        if (ui?.onModelStart) ui.onModelStart(session?.meta?.proModel || 'gemini-2.5-pro');
        const code = await withUICancel(ui, (signal) => models.generateProWithContext(
          codeGenPrompt({ instruction: action.prompt, context: `Path: ${action.path}` }),
          session,
          0.2,
          { signal },
        ));
        if (ui?.onModelEnd) ui.onModelEnd();
        await writeFs(cwd, action.path, code);
        appendEvent(session, { type: 'write_file', summary: `Generated ${action.path}` });
        if (ui?.onLog) ui.onLog(`Generated file: ${action.path} (${code.length} bytes)`);
        if (ui?.onTaskSuccess) ui.onTaskSuccess({ id: 'AG', title: `Generate ${action.path}`, type });
        return { ok: true };
      }
      case 'edit_file': {
        const current = await readFs(cwd, action.path);
        if (ui?.onModelStart) ui.onModelStart(session?.meta?.proModel || 'gemini-2.5-pro');
        const updated = await withUICancel(ui, (signal) => models.generateProWithContext(
          editFilePrompt({ filepath: action.path, currentContent: current.content, instruction: action.instruction, context: '' }),
          session,
          0.2,
          { signal },
        ));
        if (ui?.onModelEnd) ui.onModelEnd();
        await writeFs(cwd, action.path, updated);
        appendEvent(session, { type: 'edit_file', summary: `Edited ${action.path}` });
        if (ui?.onLog) ui.onLog(`Edited file: ${action.path} (${updated.length} bytes)`);
        if (ui?.onTaskSuccess) ui.onTaskSuccess({ id: 'AG', title: `Edit ${action.path}`, type });
        return { ok: true };
      }
      case 'run_command': {
        const cmd = action.command;
        const res = await smartRunCommand({ command: cmd, cwd: action.cwd || cwd, ui, models, options, session });
        appendEvent(session, { type: 'run_command', summary: `${res.ok ? 'Ran' : 'Failed'}: ${cmd}`, stdout: res.stdout, stderr: res.stderr });
        if (!res.ok) {
          if (res.cancelled) return { ok: false, cancelled: true };
          return { ok: false, error: res.error || 'Command failed' };
        }
        return { ok: true };
      }
      case 'search_web': {
        const q = action.query || action.q || '';
        const num = action.numResults || 5;
        const res = await webSearch(q, {});
        const top = res.results.slice(0, num);
        appendEvent(session, { type: 'search_web', summary: `Searched: ${q}` });
        if (ui?.onLog) ui.onLog(`Search results for: ${q}`);
        if (ui?.onTaskSuccess) ui.onTaskSuccess({ id: 'AG', title: `Search: ${q}`, type }, top);
        return { ok: true, data: top };
      }
      default:
        return { ok: false, error: `Unknown tool action: ${type}` };
    }
  } catch (e) {
    if (ui?.onLog) ui.onLog(chalk.red(String(e?.message || e)));
    return { ok: false, error: e?.message || String(e) };
  }
}

export async function runProAgentCycle({ userGoal, plan, session, models, options = {}, ui, maxActions = 5 }) {
  // Early cancellation check
  if (ui?.shouldCancel && ui.shouldCancel()) {
    return { ok: false, cancelled: true };
  }
  // Smoke mode: deterministic canned actions
  if (process.env.TASKCLI_SMOKE === '1') {
    const canned = {
      speak: ['Running smoke actions...'],
      actions: [
        { type: 'run_command', command: 'echo SMOKE_OK' },
        { type: 'write_file', path: 'SMOKE.txt', content: 'OK' },
        { type: 'read_file', path: 'SMOKE.txt' },
        { type: 'generate_file_from_prompt', path: 'smoke.js', prompt: 'Write a Node.js script that prints SMOKE_CODEGEN_OK' },
        { type: 'run_command', command: 'node smoke.js' },
      ],
      completedTasks: [],
      next: 'done',
    };
    for (const line of canned.speak) ui?.onLog?.(line);
    let count = 0;
    for (const a of canned.actions) {
      if (ui?.shouldCancel && ui.shouldCancel()) return { ok: false, cancelled: true };
      const r = await execAction(a, { session, models, options, ui });
      if (!r.ok) return { ok: false, error: r.error || 'Action failed' };
      if (++count >= maxActions) break;
    }
    return { ok: true, completedTasks: canned.completedTasks, next: canned.next };
  }

  const prompt = buildAgentPrompt({ userGoal, plan, cwd: session.meta.cwd });
  if (ui?.onModelStart) ui.onModelStart(session?.meta?.proModel || 'gemini-2.5-pro');
  let text;
  try {
    text = await withUICancel(ui, (signal) => models.generateProWithContext(prompt, session, 0.2, { signal }));
  } finally {
    if (ui?.onModelEnd) ui.onModelEnd();
  }
  const parsed = safeParseJSON(text);
  if (!parsed || !Array.isArray(parsed.actions)) {
    if (ui?.onLog) ui.onLog('Agent did not return valid JSON actions.');
    return { ok: false, error: 'invalid_agent_json' };
  }
  const speak = Array.isArray(parsed.speak) ? parsed.speak : [];
  for (const line of speak) ui?.onLog?.(line);

  let execCount = 0;
  for (const action of parsed.actions.slice(0, maxActions)) {
    if (ui?.shouldCancel && ui.shouldCancel()) return { ok: false, cancelled: true };
    const r = await execAction(action, { session, models, options, ui });
    if (!r.ok) return { ok: false, error: r.error || 'Action failed' };
    execCount++;
  }

  const next = parsed.next || 'continue';
  const complete = !!parsed.complete || next === 'done';
  const final = typeof parsed.final === 'string' ? parsed.final : undefined;
  return { ok: true, next, complete, final, completedTasks: Array.isArray(parsed.completedTasks) ? parsed.completedTasks : [], planUpdates: parsed.planUpdates };
}
