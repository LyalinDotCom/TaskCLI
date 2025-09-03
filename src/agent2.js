/**
 * Autonomous Agent - Simple, tool-based task execution
 * No orchestrators, no task lists, no complex decision trees
 * Just tools and goals.
 */

import chalk from 'chalk';
import { toolRegistry } from './tools2/index.js';

const AGENT_SYSTEM_PROMPT = `You are TaskCLI, an autonomous coding assistant. Your job is to complete the user's task using the available tools.

## Core Rules

1. **Keep Working Until Done**: Use tools repeatedly until the task is complete. Don't stop to ask for confirmation unless truly stuck.

2. **Search Before Assuming**: When you encounter an error, use search_code to understand the codebase before making changes.

3. **Read Before Editing**: Always read_file before using edit_file to understand the current state.

4. **Error Recovery**:
   - If a command fails with an error, read the error output carefully
   - Search for mentioned files/symbols to understand context
   - Make targeted fixes using edit_file
   - Retry the command
   - After 3 failed attempts on the same issue, report that you need user guidance

5. **Tool Selection**:
   - Use the most specific tool for each task
   - Chain tools naturally (search → read → edit → run)
   - Don't use run_command for things other tools do better

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

### "Run X and fix errors"
1. Use run_command(X)
2. If error: analyze the error output
3. Use search_code for relevant files/symbols mentioned
4. Use read_file on files mentioned in errors
5. Use edit_file to fix specific issues
6. Use run_command(X) again
7. Repeat until success or 3 failures

### "Create a new feature"
1. Use search_code to understand existing patterns
2. Use write_file or edit_file to implement
3. Use run_command to test
4. Fix any issues that arise

### "Debug why X is failing"  
1. Use run_command to reproduce the issue
2. Analyze the error output
3. Use search_code for relevant code
4. Use read_file to examine implementations
5. Report findings or fix if obvious

Remember: You have unlimited attempts to get things right. Keep trying different approaches.`;

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
        // Retry with a stronger reminder about JSON format
        if (iteration <= 2) {
          if (ui?.onLog) ui.onLog(chalk.yellow('Retrying with clearer instructions...'));
          
          conversationHistory.push({
            role: 'system',
            content: 'IMPORTANT: You must respond with valid JSON only. Choose ONE next action. Example: {"thinking": "I need to read the main file first", "action": {"type": "tool", "tool": "read_file", "params": {"path": "index.js"}}}'
          });
          
          continue; // Try again
        }
        
        if (ui?.onLog) ui.onLog(chalk.red('Failed to get valid response from model'));
        return { success: false, error: 'Invalid model response' };
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
    try {
      if (ui?.onModelStart) ui.onModelStart('gemini-2.5-pro');
      
      // Use the new model adapter with structured output
      const prompt = conversationHistory[conversationHistory.length - 1].content;
      const history = conversationHistory.slice(0, -1);
      
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
      console.error('Model error:', error);
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