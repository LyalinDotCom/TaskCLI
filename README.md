TaskCLI — AI Task Orchestrator CLI

Overview
- Intelligently breaks down complex goals into actionable tasks
- Executes each task autonomously using Gemini Pro and local tools
- Writes/reads files, runs commands, and searches the web
- Keeps a session log under `TaskCLI/.taskcli/sessions/`

Setup
1) In `TaskCLI/`, copy `.env.example` to `.env` and set `GEMINI_API_KEY` (or `GOOGLE_API_KEY`)

Install
```bash
cd TaskCLI
npm install
```

Quick Health Check
```bash
npm run doctor
```

Usage
```bash
# Interactive UI (default)
node bin/taskcli.js

# Headless (no UI)
node bin/taskcli.js --headless "Build an Express API skeleton with tests"

# Auto-confirm shell commands
node bin/taskcli.js -y --headless "Initialize a Node project with chalk and execa"

# Use legacy v1 orchestrator (uses Gemini Flash for planning)
node bin/taskcli.js --v1 --headless "Create a TypeScript CLI"
```

Non-Interactive Smoke Test (no network)
```bash
# Runs a canned plan that verifies shell, file write/read, codegen and execution
npm run smoke
```

Notes
- Task planning and execution uses Google's GenAI SDK directly with Gemini Pro
- Code generation always receives a persistent system prompt loaded from `TaskCLI/prompts/pro-system.md`. You can edit this file to tune behavior.
- Pro calls include full session context (prior goals, commands, outputs) to maintain continuity across tasks.
- Web search uses `googlethis` to supplement context
- Interactive UI is built with Ink (React for CLIs). If your terminal doesn't support raw mode, the CLI falls back to non-interactive.