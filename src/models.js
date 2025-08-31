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

  async function generateWithFlash(prompt, temperature = 0.3) {
    const text = await gen.generateText({ prompt, provider: 'google', model: flashModel, temperature });
    return text;
  }

  async function generateWithPro(prompt, temperature = 0.2) {
    const text = await gen.generateText({ prompt, provider: 'google', model: proModel, temperature });
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
