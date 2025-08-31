import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { stuckAnalysisPrompt, retryCommandPrompt } from './prompts.js';

// Lightweight bridge to Flash's Genkit build
async function importFlashGenkit() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // Search upwards for Flash/packages/genkit/dist/index.js
  let dir = here;
  for (let i = 0; i < 7; i++) {
    const candidate = path.join(dir, 'Flash', 'packages', 'genkit', 'dist', 'index.js');
    if (fs.existsSync(candidate)) {
      const url = pathToFileURL(candidate).href;
      return await import(url);
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('Flash Genkit build not found nearby. Expected Flash/packages/genkit/dist to exist in repo.');
}

function findProSystemPath(fromUrl) {
  let dir = path.dirname(fileURLToPath(fromUrl));
  for (let i = 0; i < 7; i++) {
    const p1 = path.join(dir, 'TaskCLI', 'prompts', 'pro-system.md');
    const p2 = path.join(dir, 'prompts', 'pro-system.md');
    if (fs.existsSync(p1)) return p1;
    if (fs.existsSync(p2)) return p2;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function loadProSystem(fromUrl) {
  const p = findProSystemPath(fromUrl);
  if (p) return fs.readFileSync(p, 'utf8');
  return (process.env.PRO_SYSTEM || `You are TaskCLI's persistent coding agent. Your role is to generate and modify code, plan non-interactive CLI steps, and resolve build/runtime issues autonomously when safe. Prefer explicit, non-interactive flags for CLIs. When uncertain or missing info, ask the user clearly. Output only the requested code or JSON control structures when asked, not commentary.`).trim();
}

function buildTranscript(session) {
  if (!session || !Array.isArray(session.history)) return '';
  const lines = [];
  for (const h of session.history) {
    const time = h.time ? `[${h.time}] ` : '';
    if (h.type === 'user_goal') lines.push(`${time}USER: ${h.message}`);
    else if (h.type === 'run_command') {
      lines.push(`${time}CMD: ${h.summary}`);
      if (h.stdout) lines.push(`STDOUT:\n${h.stdout}`);
      if (h.stderr) lines.push(`STDERR:\n${h.stderr}`);
    } else if (h.type === 'task_failed') lines.push(`${time}AGENT: Task failed - ${h.message} (${h.error || ''})`);
    else if (h.type === 'completed') lines.push(`${time}AGENT: ${h.summary}`);
    else if (h.type === 'write_file' || h.type === 'read_file' || h.type === 'edit_file') lines.push(`${time}AGENT: ${h.summary}`);
  }
  return lines.join('\n');
}

export async function loadModels({ flashModel, proModel }) {
  const gen = await importFlashGenkit();
  const PRO_SYSTEM = loadProSystem(import.meta.url);

  if (process.env.TASKCLI_SMOKE === '1') {
    // Smoke mode: no network calls; return canned responses
    async function generateWithFlash(prompt, temperature = 0.0) {
      return JSON.stringify({
        tasks: [
          { id: 'T1', type: 'run_command', title: 'Echo test', rationale: 'Verify shell execution', command: 'echo SMOKE_OK' },
          { id: 'T2', type: 'write_file', title: 'Write file', rationale: 'Verify fs write', path: 'SMOKE.txt', content: 'OK' },
          { id: 'T3', type: 'read_file', title: 'Read file', rationale: 'Verify fs read', path: 'SMOKE.txt' },
          { id: 'T4', type: 'generate_file_from_prompt', title: 'Generate JS', rationale: 'Verify Pro codegen', path: 'smoke.js', prompt: 'Write a Node.js script that prints SMOKE_CODEGEN_OK' },
          { id: 'T5', type: 'run_command', title: 'Run JS', rationale: 'Execute generated code', command: 'node smoke.js' },
        ]
      });
    }
    async function generateWithPro(prompt, temperature = 0.0) {
      return 'console.log("SMOKE_CODEGEN_OK")\n';
    }
    async function generateProWithContext(prompt, session, temperature = 0.0) {
      return await generateWithPro(prompt, temperature);
    }
    return { generateWithFlash, generateWithPro, generateProWithContext, analyzeStuck: async () => '{}', planRetry: async () => '{}' };
  }

  async function generateWithFlash(prompt, temperature = 0.3) {
    const text = await gen.generateText({ prompt, provider: 'google', model: flashModel, temperature });
    return text;
  }

  async function generateWithPro(prompt, temperature = 0.2) {
    const wrapped = `${PRO_SYSTEM}\n\n${prompt}`;
    const modelId = proModel.startsWith('googleai/') ? proModel : `googleai/${proModel}`;
    if (gen.ai && typeof gen.ai.generate === 'function') {
      const response = await gen.ai.generate({
        model: modelId,
        prompt: wrapped,
        config: { temperature, thinkingConfig: { thinkingBudget: 8000 } },
      });
      return response.text;
    }
    const text = await gen.generateText({ prompt: wrapped, provider: 'google', model: proModel, temperature });
    return text;
  }

  async function generateProWithContext(prompt, session, temperature = 0.2) {
    const transcript = buildTranscript(session);
    const wrapped = `${PRO_SYSTEM}\n\nContext Transcript (all prior steps):\n${transcript || '(no prior history)'}\n\n${prompt}`;
    const modelId = proModel.startsWith('googleai/') ? proModel : `googleai/${proModel}`;
    if (gen.ai && typeof gen.ai.generate === 'function') {
      const response = await gen.ai.generate({
        model: modelId,
        prompt: wrapped,
        config: { temperature, thinkingConfig: { thinkingBudget: 8000 } },
      });
      return response.text;
    }
    const text = await gen.generateText({ prompt: wrapped, provider: 'google', model: proModel, temperature });
    return text;
  }

  async function analyzeStuck(context) {
    const prompt = stuckAnalysisPrompt(context);
    return await generateWithFlash(prompt, 0.2);
  }

  async function planRetry(payload, session) {
    const prompt = retryCommandPrompt(payload);
    return await generateProWithContext(prompt, session, 0.2);
  }

  return { generateWithFlash, generateWithPro, generateProWithContext, analyzeStuck, planRetry };
}
