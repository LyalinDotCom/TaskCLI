/**
 * Autonomous Agent - Simple, tool-based task execution
 * No orchestrators, no task lists, no complex decision trees
 * Just tools and goals.
 */

import chalk from 'chalk';
import { toolRegistry } from './tools/index.js';

const AGENT_SYSTEM_PROMPT = `You are TaskCLI, an autonomous coding assistant. Your philosophy: "Always Works™" - untested code is just a guess, not a solution.

## Core Philosophy - Always Works™

**"Should work" ≠ "does work"** - You're not paid to write code, you're paid to solve problems.

### The 30-Second Reality Check (MUST answer YES to ALL before marking complete):
- Did I run/build the code?
- Did I trigger the exact feature I changed?
- Did I see the expected result with my own observation?
- Did I check for error messages and warnings?
- Would I bet $100 this works?

### NEVER say these phrases:
- "This should work now" 
- "I've fixed the issue" (without verification)
- "Try it now" (without trying it yourself)
- "The logic is correct so..."

## Core Rules

1. **Verify Everything**: After EVERY change, run the build/test/lint. No exceptions.
   - UI Changes: Actually verify the component renders
   - API Changes: Make the actual API call and check response
   - Logic Changes: Run the specific scenario
   - Config Changes: Restart and verify it loads

2. **The Embarrassment Test**: Before marking complete, ask yourself:
   "If the user records trying this and it fails, will I feel embarrassed?"

3. **Search Before Assuming**: When you encounter an error, use search_code to understand the codebase before making changes.

4. **Read Before Editing**: Always read_file before using edit_file to understand the current state.

5. **Error Recovery with Diligence**:
   - If a command fails: read error output COMPLETELY
   - Search for ALL mentioned files/symbols
   - Make targeted fixes using edit_file
   - ALWAYS retry the command to verify the fix
   - After 3 failed attempts, admit you need guidance (no shame in this)

6. **Non-Interactive Testing Strategy**:
   - Use run_command with explicit flags (--no-interactive, -y, etc.)
   - For builds: npm run build && echo "BUILD_SUCCESS"
   - For tests: npm test -- --watchAll=false
   - For servers: Use --port flags and curl to verify
   - Check exit codes: && echo "SUCCESS" || echo "FAILED"

7. **Completion Checklist** (MUST complete ALL):
   - [ ] Code compiles/builds without errors
   - [ ] Linting passes (if available)
   - [ ] Type checking passes (if TypeScript)
   - [ ] Feature actually works (tested programmatically)
   - [ ] No new warnings introduced

## Response Format

IMPORTANT: You MUST respond with ONLY valid JSON, nothing else. No explanations, no markdown, just JSON.

Your response must be EXACTLY in this format:

{
  "thinking": "Your internal reasoning about what to do next",
  "action": {
    "type": "tool" | "complete" | "need_help",
    "tool": "tool_name" (if type is "tool"),
    "params": { ... } (if type is "tool"),
    "message": "message to user" (if type is "complete" or "need_help")
  }
}

Examples:
{"thinking": "I need to run the build command first", "action": {"type": "tool", "tool": "run_command", "params": {"command": "npm run build"}}}
{"thinking": "Build failed, let me read the error", "action": {"type": "tool", "tool": "read_file", "params": {"path": "src/index.ts"}}}
{"thinking": "Task is complete", "action": {"type": "complete", "message": "Successfully fixed the TypeScript error"}}

## Task Patterns

### "Run X and fix errors" - The Always Works™ Way
1. Use run_command(X) to establish baseline
2. If error: READ THE ENTIRE ERROR OUTPUT (not just first line)
3. Use search_code for ALL files/symbols mentioned
4. Use read_file on EVERY file mentioned in errors
5. Use edit_file to fix specific issues
6. Use run_command(X) again - VERIFY THE FIX WORKED
7. Run build/lint/test to ensure no regressions
8. Repeat until success (no "should work" - MUST work)

### "Create a new feature" - The Always Works™ Way
1. Use search_code to understand existing patterns
2. Use read_file on similar components for consistency
3. Use write_file or edit_file to implement
4. IMMEDIATELY run build to check for syntax/type errors
5. Use run_command to test the SPECIFIC feature
6. Check for console errors/warnings
7. Run full test suite to ensure no regressions
8. Only mark complete when you've SEEN it work

### "Debug why X is failing" - The Always Works™ Way
1. Use run_command to reproduce the EXACT issue
2. Read the COMPLETE error output (including stack traces)
3. Use search_code for EVERY relevant piece of code
4. Use read_file to examine ALL related implementations
5. Form hypothesis and TEST it with targeted changes
6. Verify fix with the EXACT failing scenario
7. Run related tests to ensure no side effects

### "Enhance/modify existing code" - The Always Works™ Way
1. FIRST run existing build/tests to establish baseline
2. Use search_code to find ALL usages of what you're changing
3. Use read_file on the code AND its tests
4. Make changes incrementally with verification after EACH
5. Run build after EVERY file change
6. Test the SPECIFIC enhancement thoroughly
7. Run full test suite before marking complete

## Time Reality Check
- Time saved skipping tests: 30 seconds
- Time wasted when it doesn't work: 30 minutes  
- User trust lost: Immeasurable

Remember: A user describing a bug for the third time isn't thinking "this AI is trying hard" - they're thinking "why am I wasting time with this incompetent tool?"

Your reputation is on the line with EVERY task. Make it Always Work™.`;

export class AutonomousAgent {
  constructor(modelAdapter, options = {}) {
    this.model = modelAdapter;
    this.options = options;
    this.context = {
      cwd: options.cwd || process.cwd(),
      session: options.session || { history: [] }
    };
    this.attempts = {}; // Track retry attempts
  }

  /**
   * Main execution loop - keeps running until task is complete
   */
  async execute(userGoal, ui) {
    // Smoke test mode - deterministic actions
    if (process.env.TASKCLI_SMOKE === '1') {
      const smokeActions = [
        { thinking: "Running build command", action: { type: "tool", tool: "run_command", params: { command: "echo SMOKE_BUILD" } } },
        { thinking: "Writing test file", action: { type: "tool", tool: "write_file", params: { path: "smoke.txt", content: "SMOKE_OK" } } },
        { thinking: "Reading test file", action: { type: "tool", tool: "read_file", params: { path: "smoke.txt" } } },
        { thinking: "Task complete", action: { type: "complete", message: "Smoke test completed successfully" } }
      ];
      
      for (const response of smokeActions) {
        if (process.env.DEBUG_AGENT) {
          console.error(chalk.gray(`[Thinking] ${response.thinking}`));
        }
        
        const { action } = response;
        
        if (action.type === 'complete') {
          if (ui?.onLog) ui.onLog(chalk.green('✨ ' + action.message));
          return { success: true, message: action.message };
        }
        
        if (action.type === 'tool') {
          await this._executeTool(action.tool, action.params, ui);
        }
      }
      
      return { success: true, message: "Smoke test completed" };
    }
    
    const conversationHistory = [
      { role: 'system', content: AGENT_SYSTEM_PROMPT + '\n\n' + toolRegistry.formatForPrompt() },
      { role: 'user', content: userGoal }
    ];

    let iteration = 0;
    const MAX_ITERATIONS = 50; // Safety limit

    while (iteration < MAX_ITERATIONS) {
      iteration++;

      // Get next action from LLM
      const response = await this._getNextAction(conversationHistory, ui);
      
      if (!response || !response.action) {
        // Show detailed debug info
        if (ui?.onLog) {
          ui.onLog(chalk.red('\n❌ Invalid Model Response'));
          ui.onLog(chalk.red('━'.repeat(60)));
          ui.onLog(chalk.yellow(`Iteration ${iteration}/50`));
          
          // Show what we got
          ui.onLog(chalk.gray('\nReceived response:'));
          ui.onLog(chalk.gray(JSON.stringify(response, null, 2).substring(0, 500)));
          
          // Show last conversation context
          const lastUserMsg = conversationHistory[conversationHistory.length - 1];
          if (lastUserMsg) {
            ui.onLog(chalk.gray('\nLast message:'));
            ui.onLog(chalk.gray(JSON.stringify(lastUserMsg, null, 2).substring(0, 300)));
          }
          
          // Show model's last thoughts if available
          const lastThoughts = this.model.getLastThoughts();
          if (lastThoughts) {
            ui.onLog(chalk.gray('\nModel thoughts:'));
            ui.onLog(chalk.gray(lastThoughts.substring(0, 300)));
          }
          
          ui.onLog(chalk.red('━'.repeat(60)));
        }
        
        // Retry with a stronger reminder about JSON format
        if (iteration <= 2) {
          if (ui?.onLog) ui.onLog(chalk.yellow('\nRetrying with clearer instructions...'));
          
          conversationHistory.push({
            role: 'system',
            content: 'CRITICAL: You MUST respond with valid JSON only. No markdown, no explanations. The JSON must have "action" field. Example: {"thinking": "analyzing", "action": {"type": "tool", "tool": "read_file", "params": {"path": "file.js"}}}'
          });
          
          continue; // Try again
        }
        
        if (ui?.onLog) {
          ui.onLog(chalk.red('\n❌ Failed after retries'));
          ui.onLog(chalk.red('The model is not returning valid JSON with an "action" field'));
        }
        return { success: false, error: 'Invalid model response - missing action field' };
      }

      // Log thinking if in debug mode
      if (process.env.DEBUG_AGENT && response.thinking) {
        console.error(chalk.gray(`[Thinking] ${response.thinking}`));
      }

      const { action } = response;

      // Handle different action types
      switch (action.type) {
        case 'complete': {
          if (ui?.onLog) ui.onLog(chalk.green('✨ Task completed: ' + action.message));
          return { success: true, message: action.message };
        }

        case 'need_help': {
          if (ui?.onLog) ui.onLog(chalk.yellow('❓ ' + action.message));
          return { success: false, needsHelp: true, message: action.message };
        }

        case 'tool': {
          const result = await this._executeTool(action.tool, action.params, ui);
          
          // Add to conversation history
          conversationHistory.push({
            role: 'assistant',
            content: JSON.stringify(response)
          });
          
          conversationHistory.push({
            role: 'user',
            content: `Tool result:\n${JSON.stringify(result, null, 2)}`
          });

          // Track retry attempts for error recovery
          if (!result.success) {
            const key = `${action.tool}-${JSON.stringify(action.params)}`;
            this.attempts[key] = (this.attempts[key] || 0) + 1;
            
            if (this.attempts[key] >= 3) {
              if (ui?.onLog) {
                ui.onLog(chalk.red(`Failed 3 times with ${action.tool}. Moving to different approach.`));
              }
              // Add hint to conversation
              conversationHistory.push({
                role: 'system',
                content: 'This approach has failed 3 times. Try a different strategy or ask for help if stuck.'
              });
            }
          } else {
            // Reset attempts on success
            const key = `${action.tool}-${JSON.stringify(action.params)}`;
            delete this.attempts[key];
          }
          break;
        }

        default: {
          if (ui?.onLog) ui.onLog(chalk.red('Unknown action type: ' + action.type));
          return { success: false, error: 'Unknown action type' };
        }
      }
    }

    if (ui?.onLog) ui.onLog(chalk.yellow('Reached maximum iterations. Task may be incomplete.'));
    return { success: false, error: 'Max iterations reached' };
  }

  /**
   * Get next action from the model
   */
  async _getNextAction(conversationHistory, ui) {
    // Define these outside try block for error handling
    let prompt, history;
    
    try {
      if (ui?.onModelStart) ui.onModelStart('gemini-2.5-pro');
      
      // Use the new model adapter with structured output
      prompt = conversationHistory[conversationHistory.length - 1].content;
      history = conversationHistory.slice(0, -1);
      
      const response = await this.model.generateAction(prompt, history, 0.1);
      
      if (ui?.onModelEnd) ui.onModelEnd();
      
      // Display thoughts if available
      const thoughts = this.model.getLastThoughts();
      if (thoughts && ui?.onLog) {
        ui.onLog(chalk.gray('\n💭 Model thinking:'));
        ui.onLog(chalk.gray('─'.repeat(50)));
        // Show first 500 chars of thoughts
        const thoughtPreview = thoughts.length > 500 ? thoughts.substring(0, 500) + '...' : thoughts;
        ui.onLog(chalk.gray(thoughtPreview));
        ui.onLog(chalk.gray('─'.repeat(50)));
      }

      return response;
    } catch (error) {
      if (ui?.onModelEnd) ui.onModelEnd();
      
      // Comprehensive error logging
      if (ui?.onLog) {
        ui.onLog(chalk.red('\n❌ Model API Error'));
        ui.onLog(chalk.red('━'.repeat(60)));
        ui.onLog(chalk.red('Error Type: ' + error.constructor.name));
        ui.onLog(chalk.red('Error Message: ' + error.message));
        
        if (error.stack) {
          ui.onLog(chalk.gray('\nStack Trace:'));
          ui.onLog(chalk.gray(error.stack.split('\n').slice(0, 5).join('\n')));
        }
        
        // Show request context
        ui.onLog(chalk.gray('\nRequest Context:'));
        ui.onLog(chalk.gray('- Prompt length: ' + prompt?.length + ' chars'));
        ui.onLog(chalk.gray('- History items: ' + history?.length));
        ui.onLog(chalk.gray('- Temperature: 0.1'));
        
        // Show raw error details
        ui.onLog(chalk.gray('\nRaw Error:'));
        ui.onLog(chalk.gray(JSON.stringify(error, Object.getOwnPropertyNames(error), 2).substring(0, 500)));
        
        ui.onLog(chalk.red('━'.repeat(60)));
      }
      
      console.error('Full error object:', error);
      return null;
    }
  }

  /**
   * Execute a tool and display results
   */
  async _executeTool(toolName, params, ui) {
    if (ui?.onLog) {
      const paramStr = this._formatParams(params);
      ui.onLog(chalk.blue(`→ ${toolName}(${paramStr})`));
    }

    try {
      const result = await toolRegistry.execute(toolName, params, this.context);
      
      if (result.success) {
        if (ui?.onLog) ui.onLog(chalk.green(`  ✓ Success`));
        
        // Show relevant output
        if (result.data) {
          if (result.data.output && toolName === 'run_command') {
            // Show command output (truncated if too long)
            const output = result.data.output;
            const lines = output.split('\n');
            const maxLines = 20;
            
            if (lines.length > maxLines) {
              if (ui?.onLog) {
                ui.onLog(chalk.gray(lines.slice(0, maxLines).join('\n')));
                ui.onLog(chalk.gray(`... (${lines.length - maxLines} more lines)`));
              }
            } else {
              if (ui?.onLog) ui.onLog(chalk.gray(output));
            }
          } else if (result.data.matchCount !== undefined && toolName === 'search_code') {
            if (ui?.onLog) ui.onLog(chalk.gray(`  Found ${result.data.matchCount} matches`));
          } else if (result.data.editsApplied && toolName === 'edit_file') {
            if (ui?.onLog) {
              for (const edit of result.data.editsApplied) {
                ui.onLog(chalk.gray(`  Applied ${edit.occurrences} replacement(s)`));
              }
            }
          }
        }
      } else {
        if (ui?.onLog) ui.onLog(chalk.red(`  ✗ Failed: ${result.error}`));
      }
      
      return result;
    } catch (error) {
      if (ui?.onLog) ui.onLog(chalk.red(`  ✗ Error: ${error.message}`));
      return { success: false, error: error.message };
    }
  }

  /**
   * Format parameters for display
   */
  _formatParams(params) {
    const items = [];
    for (const [key, value] of Object.entries(params)) {
      if (typeof value === 'string') {
        const truncated = value.length > 50 ? value.substring(0, 47) + '...' : value;
        items.push(`${key}: "${truncated}"`);
      } else if (Array.isArray(value)) {
        items.push(`${key}: [${value.length} items]`);
      } else {
        items.push(`${key}: ${JSON.stringify(value)}`);
      }
    }
    return items.join(', ');
  }

  /**
   * Extract JSON from model response
   */
  _extractJSON(text) {
    // First try: response might be pure JSON
    try {
      return JSON.parse(text);
    } catch (e) {
      // Continue to extraction
    }
    
    // Second try: find JSON object in the response
    // Look for the LAST complete JSON object (in case there are multiple)
    const matches = text.match(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g);
    if (matches && matches.length > 0) {
      // Try parsing from last to first (most likely to be the actual response)
      for (let i = matches.length - 1; i >= 0; i--) {
        try {
          const parsed = JSON.parse(matches[i]);
          // Validate it has the expected structure
          if (parsed.action && parsed.thinking) {
            return parsed;
          }
        } catch (e) {
          // Try next match
        }
      }
    }
    
    throw new Error('No valid JSON found in response');
  }
}