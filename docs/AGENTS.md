# AGENTS.md

This file provides guidance to AI agents (Gemini, Codex, Claude Code, Copilot, Cursor, etc.) when working with code in this repository.

## Project Overview

TaskCLI is a **general-purpose coding agent** that can work with ANY programming language, framework, or technology stack. It uses Google's Gemini models to autonomously execute coding tasks - from fixing bugs to building features to refactoring code.

**IMPORTANT**: This is NOT specialized for any particular domain (games, web apps, etc.). It's designed to be a universal coding assistant that can handle:
- Web development (React, Vue, Angular, Next.js, etc.)
- Backend services (Node.js, Python, Go, Rust, etc.)
- Mobile apps (React Native, Flutter, Swift, Kotlin, etc.)
- Systems programming (C, C++, Rust, etc.)
- Data science (Python, R, Julia, etc.)
- DevOps and infrastructure (Docker, Kubernetes, Terraform, etc.)
- Any other programming task

The agent provides both interactive TUI and headless command-line modes.

**Fixed Model Configuration:**
- Default (v2): Gemini 2.5 Pro only with 8000 token thinking budget (unified planning/execution)
- Legacy (--v1): Gemini Flash (planning) + Gemini Pro (execution)
- No model overrides are supported - these are the only models used

## Development Commands

```bash
# Install and setup
npm install

# Run TaskCLI (v2 unified orchestrator by default)
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
node bin/taskcli.js --v1 "goal"   # Use legacy dual-model orchestrator

# Note: --flash-model and --pro-model options are ignored if provided
```

## Architecture Overview

### Unified Flow (Default - v2)
1. **Entry**: `bin/taskcli.js` → `src/index.js` (main initialization)
2. **Decision**: `src/orchestratorV2.js` uses Gemini Pro to decide approach
3. **Modes**:
   - **EXECUTE_DIRECT**: Simple, unconditional, single-step tasks only
   - **CREATE_PLAN**: Preferred for conditional logic, error handling, multi-step tasks
   - **ASK_USER**: Clarification needed (rarely used)
4. **Smart Planning**: Automatically creates plans for conditional requests like "build and fix errors"
   - Detects conditional phrases ("if errors", "and fix", "if fails")
   - Creates multi-step plans with error analysis tasks
   - Supports special "analyze_and_fix" task type for dynamic error resolution
5. **Adaptive Execution**: Automatic error recovery with FIX_AND_RETRY
   - Analyzes actual error output (not just error messages)
   - Extracts file paths from compilation/build errors
   - Guides Pro to fix specific code issues rather than assuming missing dependencies
6. **Single Model Mode**: Uses only Gemini Pro for all decisions and execution

### Legacy Flow (--v1 flag)
1. **Entry**: `bin/taskcli.js` → `src/index.js` (main initialization)
2. **Planning**: `src/orchestrator.js` uses Gemini models to break down goals
3. **Execution**: `src/agent.js` uses Gemini Pro to execute individual tasks
4. **Tools**: Tasks use tools in `src/tools/` (file ops, shell, search)
5. **UI**: Interactive mode uses React/Ink components in `src/ui/`

### Key Components
- **`src/orchestratorV2.js`**: Default unified Pro-only orchestrator with adaptive execution
- **`src/orchestrator.js`**: Legacy task planning and execution loop (dual-model)
- **`src/agent.js`**: Pro model agent for task execution
- **`src/models.js`**: Google GenAI SDK integration for model access
- **`src/adaptive.js`**: Smart command execution with retry logic
- **`src/session.js`**: Session persistence and memory management
- **`src/agent.js`**: Contains the AGENT_SYSTEM_PROMPT constant that defines AI behavior

### Model Integration
- Uses Google's GenAI SDK directly
- **Fixed models (not configurable):**
  - Gemini Flash for planning (lightweight, fast) in v1 mode
  - Gemini 2.5 Pro for execution (with 8000 token thinking budget)
- Model override arguments and environment variables are ignored

## Environment Setup

Required `.env` file:
```bash
GEMINI_API_KEY=your-key-here  # or GOOGLE_API_KEY
```

**Note:** Model environment variables (FLASH_MODEL, PRO_MODEL, PRO_THINKING, PRO_THINKING_BUDGET) are ignored. Models are hardcoded to Gemini Flash and Gemini 2.5 Pro with 8000 thinking budget.

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

### Build Error Recovery (v2)
**Issue**: When build commands fail with compilation errors, the system would incorrectly try to install dependencies instead of fixing the actual code issues.
**Fix**:
- Enhanced `getRecoveryDecision()` in `src/orchestratorV2.js` to better analyze build output
- Extracts file paths mentioned in error messages
- Emphasizes reading the full error output, not just error messages
- Guides Pro to read and fix specific files rather than assuming dependency issues
- `run_command` in `src/agent.js` now returns stdout/stderr in error responses for better context