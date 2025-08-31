TaskCLI — AI Task Orchestrator CLI

Overview
- Breaks a goal into tasks with Gemini Flash
- Executes each task using Gemini Pro and local tools
- Writes/reads files, runs commands, and searches the web
- Keeps a session log under `TaskCLI/.taskcli/sessions/`

Setup
1) From repo root, ensure Flash’s Genkit is built (already bundled in this repo)
2) In `TaskCLI/`, copy `.env.example` to `.env` and set `GOOGLE_GENAI_API_KEY`

Install
```bash
cd TaskCLI
npm install
```

Usage
```bash
# One-shot
node bin/taskcli.js "Build an Express API skeleton with tests"

# Interactive
node bin/taskcli.js -i

# Auto-confirm shell commands
node bin/taskcli.js -y "Initialize a Node project with chalk and execa"

# Override models
node bin/taskcli.js --flash-model gemini-2.5-flash --pro-model gemini-1.5-pro "Create a TypeScript CLI"
```

Notes
- Task planning uses Flash’s Genkit adapter from `Flash/packages/genkit/dist`
- Code generation uses Pro; content is saved directly to files per planned tasks
- Web search uses `googlethis` to supplement context

