# TaskCLI Redesign Proposal

## Problems with Current Architecture

1. **Overcomplicated Decision Tree**: EXECUTE_DIRECT vs CREATE_PLAN vs ASK_USER adds unnecessary complexity
2. **Flash Dependency**: Using Flash for planning when Pro can do everything
3. **Poor Error Recovery**: Complex prompts trying to get LLM to understand errors instead of deterministic rules
4. **Task List Persistence**: Orchestrator creates rigid task lists that can't adapt
5. **LLM-Generated JSON Actions**: Unreliable compared to discrete tool calls

## New Architecture: Tool-Based Autonomous Agent

### Core Principles

1. **Single Model**: Use only Gemini Pro with thinking budget
2. **Tool-First**: Define clear, discrete tools that do one thing well
3. **Autonomous Resolution**: Agent keeps working until task is complete or needs user input
4. **Deterministic Error Handling**: Simple retry rules, not complex LLM decisions
5. **No Intermediate Plans**: Agent decides what tools to use as it goes

### Tool Definitions

```javascript
// Core tools that map to clear actions
const tools = {
  run_command: {
    description: "Execute a shell command",
    parameters: {
      command: "string",
      working_dir: "string (optional)",
      continue_on_error: "boolean (optional)"
    },
    when_to_use: "Running build commands, tests, npm scripts",
    when_not_to_use: "Reading files (use read_file), searching code (use search_code)"
  },

  read_file: {
    description: "Read contents of a file",
    parameters: {
      path: "string",
      start_line: "number (optional)",
      end_line: "number (optional)"
    },
    when_to_use: "Examining specific files mentioned in errors",
    when_not_to_use: "Searching for patterns (use search_code)"
  },

  write_file: {
    description: "Create or overwrite a file",
    parameters: {
      path: "string",
      content: "string"
    },
    when_to_use: "Creating new files from scratch",
    when_not_to_use: "Modifying existing files (use edit_file)"
  },

  edit_file: {
    description: "Edit specific parts of an existing file",
    parameters: {
      path: "string",
      edits: [{
        find: "string (exact text to find)",
        replace: "string (replacement text)"
      }]
    },
    when_to_use: "Fixing errors in existing code",
    when_not_to_use: "Creating new files (use write_file)"
  },

  search_code: {
    description: "Search for patterns in codebase",
    parameters: {
      pattern: "string (regex or text)",
      file_pattern: "string (optional, e.g. '*.js')"
    },
    when_to_use: "Finding where something is defined or used",
    when_not_to_use: "Reading known files (use read_file)"
  },

  analyze_output: {
    description: "Analyze command output or error messages",
    parameters: {
      output: "string",
      question: "string (what to look for)"
    },
    when_to_use: "Understanding build errors, test failures",
    when_not_to_use: "Simple pattern matching (check output directly)"
  }
};
```

### Agent System Prompt

```markdown
You are TaskCLI, an autonomous coding assistant. Your job is to complete the user's task using the available tools.

## Core Rules

1. **Keep Working Until Done**: Use tools repeatedly until the task is complete. Don't stop to ask for confirmation unless truly stuck.

2. **Search Before Assuming**: When you encounter an error, use search_code to understand the codebase before making changes.

3. **Read Before Editing**: Always read_file before using edit_file to understand the current state.

4. **Error Recovery**:
   - If a command fails with an error, read the error output
   - Search for mentioned files/symbols to understand context
   - Make targeted fixes using edit_file
   - Retry the command
   - After 3 failed attempts on the same issue, ask the user for guidance

5. **Tool Selection**:
   - Use the most specific tool for each task
   - Chain tools naturally (search → read → edit → run)
   - Don't use run_command for things other tools do better

## Task Patterns

### "Run X and fix errors"
1. run_command(X)
2. If error: analyze_output to understand the error
3. search_code for relevant files/symbols
4. read_file on files mentioned in errors
5. edit_file to fix specific issues
6. run_command(X) again
7. Repeat until success or 3 failures

### "Create a new feature"
1. search_code to understand existing patterns
2. write_file or edit_file to implement
3. run_command to test
4. Fix any issues that arise

### "Debug why X is failing"
1. run_command to reproduce the issue
2. analyze_output to understand the failure
3. search_code for relevant code
4. read_file to examine implementations
5. Report findings or fix if obvious
```

### Simplified Execution Flow

```javascript
async function executeTask(userGoal, tools, session) {
  const agent = new Agent({
    model: 'gemini-2.5-pro',
    thinkingBudget: 8000,
    tools: tools,
    systemPrompt: AGENT_PROMPT
  });

  let attempts = {};
  
  while (true) {
    // Agent decides next action based on conversation history
    const action = await agent.decideNextAction(session);
    
    if (action.type === 'complete') {
      return { success: true, summary: action.summary };
    }
    
    if (action.type === 'need_user_input') {
      return { success: false, question: action.question };
    }
    
    // Execute the tool
    const result = await executeool(action.tool, action.parameters);
    session.addToolResult(action.tool, result);
    
    // Simple retry logic
    if (!result.success) {
      const key = `${action.tool}-${action.parameters.command || action.parameters.path}`;
      attempts[key] = (attempts[key] || 0) + 1;
      
      if (attempts[key] >= 3) {
        session.addMessage(`Failed 3 times. Need user help: ${result.error}`);
        return { success: false, error: result.error };
      }
    }
  }
}
```

### Benefits of This Approach

1. **Simpler**: No orchestrator, no task lists, no complex decision trees
2. **More Flexible**: Agent adapts based on actual results, not predetermined plans
3. **Better Error Handling**: Deterministic retry logic + tool-based investigation
4. **More Reliable**: Tools have clear contracts, not LLM-generated JSON
5. **Easier to Debug**: Each tool call is logged, clear execution flow

### Migration Path

1. **Phase 1**: Implement new tools alongside existing system
2. **Phase 2**: Create new agent.js that uses tools instead of orchestrator
3. **Phase 3**: Add Cursor-style tool descriptions and examples
4. **Phase 4**: Remove orchestrator.js and orchestratorV2.js
5. **Phase 5**: Simplify UI to show tool calls instead of task lists

### Example Execution

User: "run npm build and fix any errors"

```
→ run_command("npm build")
  ✗ Error: TypeScript error in src/App.tsx:31

→ read_file("src/App.tsx", {start_line: 25, end_line: 35})
  ✓ Shows: const countRef = useRef<number>();

→ search_code("useRef", {file_pattern: "*.tsx"})
  ✓ Finds other usages with initial values

→ edit_file("src/App.tsx", {
    edits: [{
      find: "const countRef = useRef<number>();",
      replace: "const countRef = useRef<number>(0);"
    }]
  })
  ✓ File updated

→ run_command("npm build")
  ✓ Build successful

→ complete("Fixed TypeScript error by adding initial value to useRef")
```

This is much cleaner than our current flow of:
1. Flash creates task list
2. Pro executes tasks
3. Complex error recovery prompts
4. Unclear when to stop

## Next Steps

1. Implement the tool definitions in `src/tools/` 
2. Create new `src/agent.js` with simplified execution
3. Test with real-world scenarios
4. Remove old orchestrator code once stable