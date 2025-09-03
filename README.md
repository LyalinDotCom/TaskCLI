TaskCLI — General-Purpose AI Coding Agent

⚠️ **IMPORTANT SAFETY WARNING** ⚠️
This tool is EXPERIMENTAL and executes commands autonomously with AI. It can:
- Modify, create, and delete files in your filesystem
- Execute shell commands with real effects
- Make irreversible changes to your project

**USE AT YOUR OWN RISK**. Always:
- Work in a backed-up or version-controlled environment
- Review actions before confirming (use without -y flag)
- Test in a safe directory first
- Never run with sudo or elevated privileges

This is a "YOLO" tool - it takes actions first and asks questions later. You have been warned! 🚨

Overview

TaskCLI is a general-purpose AI coding agent that can work with ANY programming language or framework:
- **Universal**: Works with Python, JavaScript, TypeScript, Go, Rust, Java, C++, and more
- **Framework Agnostic**: React, Vue, Django, Rails, Spring, Express - it handles them all
- **Full-Stack**: From frontend UI to backend APIs to DevOps scripts
- **Autonomous**: Breaks down complex goals and executes them step-by-step
- **Self-Correcting**: Runs tests, catches errors, and fixes them automatically

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

Context Persistence
- TaskCLI creates a `.taskcli` folder in your working directory to save session context
- On startup, it detects previous sessions and offers to resume
- Context is automatically saved after each interaction
- Use slash commands in interactive mode:
  - `/resume` - Resume from saved context
  - `/save` - Manually save current context
  - `/status` - Show context status
  - `/clear` - Clear all context and start fresh
  - `/init` - Inspect project structure (read-only)
  - `/help` - Show all available commands

Interactive Features
- Smart slash command palette with filtering and tooltips
- Status bar showing current working directory
- Command history with arrow key navigation
- Context-aware session management

Notes
- Task planning and execution uses Google's GenAI SDK directly with Gemini Pro
- The system prompt is defined in `src/agent.js` as `AGENT_SYSTEM_PROMPT`. You can edit this constant to customize AI behavior.
- Pro calls include full session context (prior goals, commands, outputs) to maintain continuity across tasks.
- Web search uses `googlethis` to supplement context
- Interactive UI is built with Ink (React for CLIs). If your terminal doesn't support raw mode, the CLI falls back to non-interactive.