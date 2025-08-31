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

export async function loadModels({ flashModel, proModel }) {
  const gen = await importFlashGenkit();
  const PRO_SYSTEM = (process.env.PRO_SYSTEM || `You are TaskCLI's persistent coding agent. Your role is to generate and modify code, plan non-interactive CLI steps, and resolve build/runtime issues autonomously when safe. Prefer explicit, non-interactive flags for CLIs. When uncertain or missing info, ask the user clearly. Output only the requested code or JSON control structures when asked, not commentary.`).trim();

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
    return { generateWithFlash, generateWithPro, analyzeStuck: async () => '{}', planRetry: async () => '{}' };
  }

  async function generateWithFlash(prompt, temperature = 0.3) {
    const text = await gen.generateText({ prompt, provider: 'google', model: flashModel, temperature });
    return text;
  }

  async function generateWithPro(prompt, temperature = 0.2) {
    const wrapped = `${PRO_SYSTEM}\n\n${prompt}`;
    const text = await gen.generateText({ prompt: wrapped, provider: 'google', model: proModel, temperature });
    return text;
  }

  async function analyzeStuck(context) {
    const prompt = stuckAnalysisPrompt(context);
    return await generateWithFlash(prompt, 0.2);
  }

  async function planRetry(payload) {
    const prompt = retryCommandPrompt(payload);
    return await generateWithPro(prompt, 0.2);
  }

  return { generateWithFlash, generateWithPro, analyzeStuck, planRetry };
}
