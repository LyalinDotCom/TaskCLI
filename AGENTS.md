# AGENTS.md

This file provides guidance to AI agents (Gemini, Codex, Claude Code, Copilot, Cursor, etc.) when working with code in this repository.

## Project Overview

TaskCLI is an AI-powered task orchestration CLI that uses Google's Gemini models to break down goals into actionable tasks and execute them autonomously. It's part of the larger Flash project monorepo and provides both interactive TUI and headless command-line modes.

**Fixed Model Configuration:**
- Planning: Gemini 2.5 Flash (hardcoded)
- Execution: Gemini 2.5 Pro with 8000 token thinking budget (hardcoded)
- No model overrides are supported - these are the only models used

## Development Commands

```bash
# Install and setup
npm install

# Run TaskCLI
npm start                      # Interactive mode
npm run dev                    # Interactive mode (alias)
node bin/taskcli.js --headless "your goal"  # Headless mode

# Testing and validation
npm run doctor                 # Environment health check
npm run smoke                  # Run smoke test (non-interactive)
npm run check                  # Full validation (doctor + smoke + pack)

# Direct CLI options
node bin/taskcli.js --help
node bin/taskcli.js --doctor
node bin/taskcli.js --yes "goal"  # Auto-confirm shell commands

# Note: --flash-model and --pro-model options are ignored if provided
```

## Architecture Overview

### Core Flow
1. **Entry**: `bin/taskcli.js` → `src/index.js` (main initialization)
2. **Planning**: `src/orchestrator.js` uses Gemini Flash to break down goals
3. **Execution**: `src/agent.js` uses Gemini Pro to execute individual tasks
4. **Tools**: Tasks use tools in `src/tools/` (file ops, shell, search)
5. **UI**: Interactive mode uses React/Ink components in `src/ui/`

### Key Components
- **`src/orchestrator.js`**: Main task planning and execution loop
- **`src/agent.js`**: Pro model agent for task execution
- **`src/models.js`**: Genkit integration with Flash's AI adapter
- **`src/adaptive.js`**: Smart command execution with retry logic
- **`src/session.js`**: Session persistence and memory management
- **`prompts/pro-system.md`**: Comprehensive system prompt for task execution

### Model Integration
- Uses Flash's Genkit package from `../Flash/packages/genkit/`
- **Fixed models (not configurable):**
  - Gemini 2.5 Flash for planning (lightweight, fast)
  - Gemini 2.5 Pro for execution (with 8000 token thinking budget)
- Model override arguments and environment variables are ignored

## Environment Setup

Required `.env` file:
```bash
GEMINI_API_KEY=your-key-here  # or GOOGLE_API_KEY
```

**Note:** Model environment variables (FLASH_MODEL, PRO_MODEL, PRO_THINKING, PRO_THINKING_BUDGET) are ignored. Models are hardcoded to Gemini 2.5 Flash and Gemini 2.5 Pro with 8000 thinking budget.

## Testing Approach

The project uses integration testing through smoke tests rather than unit tests:
- `npm run smoke` runs a comprehensive smoke test
- Test workspace created in `.taskcli/smoke/`
- Uses `TASKCLI_SMOKE=1` environment variable for test mode
- Verifies shell execution, file operations, and code generation

## Session Management

- Sessions stored in `.taskcli/sessions/` as timestamped JSON files
- Each session maintains full conversation history
- Memory summarization for context management across tasks
- **Important**: Task lists are cleared between orchestration runs in TUI mode to prevent task persistence issues

## Slash Commands

TaskCLI supports slash commands for runtime configuration and control:

- `/thinkingBudget <number>` - Set Gemini Pro thinking budget (tokens, -1 to disable)
- `/model` - Show current model configuration
- `/session` - Show session information
- `/clear` - Clear message history
- `/help` - Show all available commands

Type `/` to see command suggestions. Commands are case-insensitive.

## Important Patterns

### Tool Execution
Tools in `src/tools/` follow a consistent pattern:
- Each tool exports a descriptor object with name, description, and parameters
- Tools receive parsed arguments and return results or throw errors
- Shell commands require confirmation for destructive operations unless `--yes` flag

### Error Handling
- Adaptive execution in `src/adaptive.js` handles retries and error recovery
- Model errors are caught and displayed with helpful context
- Environment issues detected early via doctor checks

### UI Modes
- Interactive TUI (default): Uses Ink/React for rich terminal UI
- Headless mode: Plain text output for automation/scripting
- Mode selection automatic based on TTY detection or `--headless` flag

## Dependencies and Requirements

- **Node.js >= 20** required
- **Flash Genkit**: Must be built at `../Flash/packages/genkit/dist/`
- **Gemini API Key**: Essential for AI functionality
- File permissions: `bin/taskcli.js` must be executable

## Known Issues and Fixes

### Task List Persistence Between Runs
**Issue**: Tasks from previous runs were persisting and displaying in new orchestration runs.
**Fix**: 
- Added task and task status clearing in `src/ui/tui.js:runOrchestrator()` function when starting new orchestration
- Clear session.tasks array at the start of `orchestrate()` in `src/orchestrator.js`
- Use tasksRef to ensure callbacks always have the latest tasks array (including onTaskFailure)
- All task display callbacks now use tasksRef.current for accurate task lists

### Path Resolution in Multi-Step Tasks
**Issue**: When tasks create files in subdirectories, subsequent tasks may lose context of the actual file location.
**Fix**:
- Enhanced `summarizeMemory()` in `src/session.js` to track created directories and files from command history
- Memory summary now includes "Created directories" and "Created/modified files" sections
- Command summaries include working directory context when different from session cwd
- Planning prompt updated to emphasize using correct paths from memory summary
- Session history now provides comprehensive context about project structure