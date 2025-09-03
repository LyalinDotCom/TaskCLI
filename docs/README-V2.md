# TaskCLI v2 - Clean Architecture

## What Changed?

### Before (v1 - Overcomplicated)
- **Two orchestrators** (v1 with Flash+Pro, v2 with Pro only)
- **Complex decision trees** (EXECUTE_DIRECT vs CREATE_PLAN vs ASK_USER)  
- **Task lists** that persist incorrectly
- **Elaborate error recovery prompts**
- **LLM-generated JSON actions** (unreliable)
- **Multiple files**: orchestrator.js, orchestratorV2.js, agent.js

### After (v2 - Simple & Clean)
- **No orchestrators** - just an autonomous agent
- **Tool-based architecture** - discrete tools that do one thing well
- **No intermediate decisions** - agent just uses tools until done
- **Deterministic retry logic** - 3 attempts then ask for help
- **Structured JSON output** - using Google AI's responseMimeType
- **Single file**: agent2.js (plus tools)

## Architecture

```
src/
├── agent2.js           # Autonomous agent (replaces all orchestrators)
├── models2.js          # Clean model adapter with structured output
├── index2.js           # Simplified entry point
├── tools2/
│   ├── base.js         # Base tool class
│   ├── run_command.js  # Execute shell commands
│   ├── read_file.js    # Read file contents
│   ├── write_file.js   # Create/overwrite files
│   ├── edit_file.js    # Edit specific parts of files
│   ├── search_code.js  # Search codebase with ripgrep
│   └── index.js        # Tool registry
```

## How It Works

1. **User provides a goal**: "run npm build and fix errors"
2. **Agent loops autonomously**:
   - Decides next tool to use based on conversation history
   - Executes tool and adds result to history
   - Continues until task is complete or needs help
3. **Smart error recovery**:
   - If a command fails, agent reads error output
   - Searches for mentioned files
   - Makes targeted fixes
   - Retries (up to 3 times per unique failure)

## Example Execution

```bash
$ taskcli2 "run npm run build and fix any syntax errors"

Goal: run npm run build and fix any syntax errors
──────────────────────────────────────────────────
→ run_command(command: "npm run build")
  ✗ Failed: SyntaxError in index.js:3
→ read_file(path: "index.js", start_line: 3)
  ✓ Success
→ edit_file(path: "index.js", edits: [fix missing parenthesis])
  ✓ Success
→ run_command(command: "npm run build")
  ✓ Success
✨ Successfully fixed the syntax error
──────────────────────────────────────────────────
✅ Success!
```

## Key Improvements

### 1. Tool-First Design
Each tool has:
- Clear purpose and parameters
- When to use / when NOT to use guidelines
- Examples
- Validation

### 2. No More Task Lists
- No rigid plans that can't adapt
- Agent decides next action based on current state
- Much more flexible and responsive

### 3. Better Error Handling
```javascript
// Old way: Complex prompts asking LLM to understand errors
const prompt = `Analyze this error and decide: FIX_AND_RETRY, SKIP, or ABORT...`

// New way: Simple deterministic logic
if (attempts[key] >= 3) {
  return { needsHelp: true, message: "Failed 3 times, need guidance" }
}
```

### 4. Structured Output
Using Google AI's `responseMimeType: 'application/json'` ensures we get valid JSON every time, no more parsing failures.

## Testing

```bash
# Run smoke test
TASKCLI_SMOKE=1 node bin/taskcli2.js --headless test

# Test with real project
cd test-project
node ../bin/taskcli2.js "run npm build and fix errors"

# Debug mode
DEBUG_AGENT=1 node bin/taskcli2.js "your goal"
```

## Migration from v1

1. **For users**: Just use `taskcli2` instead of `taskcli`
2. **For developers**: 
   - Tools are in `tools2/` 
   - Agent is `agent2.js`
   - Entry is `index2.js`
   - Old code still exists but can be deleted once v2 is stable

## Lessons Learned

From analyzing the Cursor agent prompt, we learned:
1. **Tools over prompts** - Don't ask LLM to decide modes, give it tools
2. **Autonomous execution** - Keep going until done, don't stop every step
3. **Simple retry logic** - "3 times then ask" beats complex recovery prompts
4. **Search first** - Always gather info before making changes
5. **Clear boundaries** - Each tool does ONE thing well

## Next Steps

- [ ] Add more tools (git operations, testing, etc.)
- [ ] Improve search with semantic capabilities
- [ ] Add memory/learning across sessions
- [ ] Better progress indicators
- [ ] Remove old v1 code once stable