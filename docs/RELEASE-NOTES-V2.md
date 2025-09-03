# TaskCLI v2 Release Notes

## 🎉 Complete Rewrite - Simpler, Cleaner, More Reliable

### What's New

#### 🏗️ New Architecture
- **No More Orchestrators**: Replaced complex orchestrator system with a single autonomous agent
- **Tool-Based Design**: 5 discrete tools that do one thing well
- **Structured JSON Output**: Using Google AI's `responseMimeType` for reliable JSON
- **Deterministic Retry Logic**: Simple "3 attempts then ask for help" rule

#### 🎨 Beautiful Interactive TUI
- Gradient header with "TASKCLI v2" branding
- Clean message display with color-coded output
- Tool execution visualization (→ for calls, ✓/✗ for results)
- Command history with ↑/↓ navigation
- Queue support for multiple tasks
- Model thinking indicator with spinner
- Double-ESC to cancel running tasks

#### 🛠️ Core Tools
1. **run_command**: Execute shell commands with timeout support
2. **read_file**: Read file contents (with line range support)
3. **write_file**: Create or overwrite files
4. **edit_file**: Make targeted edits with find/replace
5. **search_code**: Search codebase with ripgrep (falls back to grep)

#### 🤖 Smarter Agent
- Autonomous execution until task completion
- Reads error output to understand failures
- Searches for mentioned files automatically
- Makes targeted fixes based on actual errors
- No more rigid task lists that can't adapt

### Usage

#### Interactive Mode (Default)
```bash
taskcli
# Beautiful TUI launches
# Type your goal and press Enter
```

#### Headless Mode
```bash
taskcli --headless "run npm build and fix errors"
# Runs without UI, perfect for scripts
```

#### With Initial Goal
```bash
taskcli "create a React component for user profile"
# Launches TUI with goal pre-filled
```

### Real-World Example

```
> run npm build and fix any syntax errors

→ run_command(command: "npm build")
  ✗ Failed: SyntaxError in index.js:3
→ read_file(path: "index.js", start_line: 3)
  ✓ Success
→ edit_file(path: "index.js", edits: [fix missing parenthesis])
  ✓ Success  
→ run_command(command: "npm build")
  ✓ Success
✨ Successfully fixed the syntax error
```

### Migration from v1

- `taskcli` now uses v2 by default
- Old orchestrator files have been removed
- TUI has been rewritten for the new architecture
- All your existing workflows should work better

### Technical Improvements

1. **Simplified Codebase**
   - Before: 3 orchestrator files, complex decision trees
   - After: 1 agent file, 5 tool files

2. **Better Error Handling**
   - Extracts file paths from error messages
   - Reads actual error output, not just error codes
   - Makes targeted fixes instead of guessing

3. **Reliable Model Integration**
   - Uses Gemini Flash Thinking model
   - Structured JSON output mode
   - Automatic role mapping for chat history

### Known Limitations

- Slash commands from v1 not yet ported
- Some TUI features still being refined
- Maximum 50 iterations per task (safety limit)

### What's Next

- [ ] Port slash commands (/help, /clear, etc.)
- [ ] Add more tools (git, testing, etc.)
- [ ] Enhance search with semantic capabilities
- [ ] Add progress bars for long operations
- [ ] Support for multi-file operations

### Credits

Inspired by analyzing the Cursor AI agent architecture - learning that tools > prompts, autonomous > step-by-step, and simple > complex.

---

**The old complex system has been replaced with something clean and reliable. Enjoy!** 🚀