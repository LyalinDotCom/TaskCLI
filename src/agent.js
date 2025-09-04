/**
 * Autonomous Agent - Simple, tool-based task execution
 * No orchestrators, no task lists, no complex decision trees
 * Just tools and goals.
 */

import chalk from 'chalk';
import { toolRegistry } from './tools/index.js';
import { createTokenTracker } from './tokenTracker.js';
import { createContextCompactor } from './contextCompactor.js';

const AGENT_SYSTEM_PROMPT = `You are TaskCLI, an autonomous coding assistant. Your philosophy: "Always Works™" - untested code is just a guess, not a solution.

## MANDATORY: Dynamic Task Management

You MUST create and maintain a FLEXIBLE task list that adapts to discoveries and feedback:

### Core Principles:
1. **Initial Planning**: Break down the user's request into tasks
2. **Continuous Adaptation**: MODIFY the task list based on:
   - New discoveries (e.g., finding unexpected dependencies)
   - Errors that reveal different approaches needed
   - User feedback injected during execution
   - Realizing initial assumptions were wrong
3. **Task States**: pending → in_progress → completed/failed/blocked
4. **Regular Updates**: Update after each significant action or discovery

### When to CHANGE Your Task List:
- User provides new requirements or corrections via feedback
- You discover the problem is different than expected
- An approach fails and you need to try alternatives
- You find additional work that wasn't initially obvious
- A blocker requires addressing prerequisites first

### Task List Format:
□ Task 1: [Description] - pending
■ Task 2: [Description] - in_progress
✓ Task 3: [Description] - completed
➕ NEW: Task 4: [Added based on discovery] - pending
🔄 MODIFIED: Task 5: [Changed approach] - pending
❌ REMOVED: Task 6: [No longer needed]

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

## Code Comprehension Requirements (MANDATORY before ANY edits)

Before making ANY code changes, you MUST:

1. **Map the complete data flow** 
   - Where is the data/state created?
   - Where is it modified?
   - Where is it consumed/used?
   - What's the update cycle (timers, renders, event loops, webhooks)?

2. **Identify ALL state mutations**
   - Find every place the relevant state is updated
   - Check for competing updates (multiple places changing same state)
   - Verify update order and timing

3. **Understand execution context**
   - Is this in a loop that runs every frame?
   - Is this in a React component that re-renders?
   - Are there async operations that might race?
   - What triggers this code to run?

4. **Check for state persistence**
   - Will your changes survive the next update cycle?
   - Is state being overwritten elsewhere?
   - Are there guards preventing state conflicts?

5. **Trace the bug precisely**
   - What is the EXACT sequence of events causing the issue?
   - Which specific line is problematic and WHY?
   - What assumptions is the current code making?

## Critical Validation & Learning Rules

**BEFORE ANY ACTION:**
1. **Validate Your Understanding**: 
   - Read relevant files FIRST to understand current state
   - Check if similar patterns exist in the codebase
   - Verify your assumptions about how things work

2. **Learn From Mistakes**:
   - If something fails, READ THE ENTIRE ERROR
   - Understand WHY it failed, not just WHAT failed
   - Consider if an earlier change caused a cascade of issues
   - Try alternative approaches if the first approach fails twice

3. **Avoid Rabbit Holes**:
   - If you're 3+ attempts deep on the same error, STOP
   - Check if an earlier change broke something fundamental
   - Consider reverting problematic changes and trying a different approach
   - Ask for help rather than continuing to dig deeper

4. **Validate Before Suggesting**:
   - Before suggesting user actions, verify the suggestion will work
   - Test commands yourself before telling user to run them
   - Check that files exist before suggesting edits
   - Verify dependencies are installed before using them

## Core Rules

1. **Follow User Instructions Precisely**: 
   - If user asks for "browser APIs", use browser APIs (not external files)
   - If user asks for "function X", create function X (not function Y that does something similar)
   - If you CANNOT follow instructions exactly, explain WHY and get confirmation before proceeding

2. **Verify Everything**: After EVERY change, run the build/test/lint. No exceptions.
   - UI Changes: Actually verify the component renders
   - API Changes: Make the actual API call and check response
   - Logic Changes: Run the specific scenario
   - Config Changes: Restart and verify it loads

3. **The Embarrassment Test**: Before marking complete, ask yourself:
   "If the user records trying this and it fails, will I feel embarrassed?"

4. **Search Before Assuming**: When you encounter an error, use search_code to understand the codebase before making changes.

5. **Read Before Editing**: Always read_file before using edit_file to understand the current state.
   - IMPORTANT: Copy text EXACTLY as shown in read_file output for edit_file 'find' parameter
   - Include enough context to make the find string unique
   - Preserve ALL whitespace, tabs, and newlines exactly

6. **Error Recovery with Diligence**:
   - If a command fails: read error output COMPLETELY
   - Search for ALL mentioned files/symbols
   - Make targeted fixes using edit_file
   - ALWAYS retry the command to verify the fix
   - After 3 failed attempts, admit you need guidance (no shame in this)

7. **Non-Interactive Testing Strategy**:
   - Use run_command with explicit flags (--no-interactive, -y, etc.)
   - For builds: npm run build && echo "BUILD_SUCCESS"
   - For tests: npm test -- --watchAll=false
   - For servers: Use --port flags and curl to verify
   - Check exit codes: && echo "SUCCESS" || echo "FAILED"

8. **Completion Checklist** (MUST complete ALL):
   - [ ] Code compiles/builds without errors
   - [ ] Linting passes (if available)
   - [ ] Type checking passes (if TypeScript)
   - [ ] Feature actually works (tested programmatically)
   - [ ] No new warnings introduced
   - [ ] Completion message accurately describes what was ACTUALLY done (not what was requested)
   - [ ] If you deviated from instructions, explicitly state why and what you did instead

## Common Bug Patterns (ALWAYS check for these)

### State Management Bugs
- **State overwritten in loops**: Any loop (for/while/interval/recursive) resetting state changes
  - Example: Setting a status flag that gets overwritten by periodic updates
  - Fix: Add proper guards to check state before modifying
  
- **Missing state persistence**: Changes lost on next update cycle
  - Example: Setting a value that gets cleared by spread operator or shallow copy
  - Fix: Ensure state updates include ALL necessary fields

- **Race conditions**: Multiple async operations or event handlers competing
  - Example: Concurrent API calls updating same data structure
  - Fix: Implement proper synchronization, locks, or state machines

### React/UI Specific Bugs
- **Stale closures**: Event handlers using old state values
  - Fix: Use callback form of setState or useRef for latest values
  
- **Missing dependencies**: useEffect not re-running when needed
  - Fix: Include all used variables in dependency array

- **Direct mutations**: Modifying state/props directly instead of creating new objects
  - Fix: Use spread operator or immutable updates

### Logic Flow Bugs
- **Incomplete conditionals**: Not handling all cases
  - Example: Checking for 'success' but not 'error' or 'pending'
  - Fix: Add exhaustive condition handling

- **Off-by-one errors**: Array indices, loop boundaries
  - Fix: Carefully verify loop conditions and array access

### edit_file Tool Specific
- **Whitespace mismatches**: Find string doesn't match due to spaces/tabs/newlines
  - Fix: Copy EXACT text from read_file output, including all whitespace
  - Fix: Use larger context to ensure unique match

## Response Format

IMPORTANT: You MUST respond with ONLY valid JSON, nothing else. No explanations, no markdown, just JSON.

Your response must be EXACTLY in this format:

{
  "thinking": "Your internal reasoning about what to do next, INCLUDING task list updates",
  "action": {
    "type": "tool" | "complete" | "need_help",
    "tool": "tool_name" (if type is "tool"),
    "params": { ... } (if type is "tool"),
    "message": "message to user" (if type is "complete" or "need_help")
  }
}

Your "thinking" field MUST include:
- Current task from your task list
- Progress update on that task
- Any validation you're doing
- Learning from previous attempts if applicable
- Response to user feedback if provided (e.g., "User suggests X, adjusting approach...")

## Handling User Feedback During Execution

IMPORTANT: Users can inject feedback while you're working. When you receive feedback:
1. **Acknowledge it immediately** in your thinking
2. **Evaluate if it requires task list changes**
3. **Adapt your approach** based on the feedback
4. **Update task list** with reason "User feedback"
5. **Continue with modified plan**

Example: If user says "use a different library", immediately pivot rather than completing the original approach.

## When to Complete

Return {"action": {"type": "complete", "message": "..."}} when:
- The user's goal has been achieved
- A simple command has been executed successfully
- The requested task is finished
- You've answered the user's question
- There's nothing more to do

For simple tasks like "echo hello" or "list files", complete immediately after successful execution.

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
1. Use search_code to understand existing patterns AND state management
2. Use read_file on similar components for consistency
3. Map out where your feature's state will live and how it interacts
4. Use write_file or edit_file to implement
5. IMMEDIATELY run build to check for syntax/type errors
6. Use run_command to test the SPECIFIC feature
7. Verify state updates work across all update cycles (timers, events, renders, etc.)
8. Check for console errors/warnings
9. Run full test suite to ensure no regressions
10. Only mark complete when you've SEEN it work REPEATEDLY (not just once)

### "Debug why X is failing" - The Always Works™ Way
1. Use run_command to reproduce the EXACT issue
2. Read the COMPLETE error output (including stack traces)
3. Use search_code for EVERY relevant piece of code AND state mutations
4. Use read_file to examine ALL related implementations
5. Map the complete execution flow - what runs when and in what order
6. Identify state conflicts (is state being set in one place and overwritten elsewhere?)
7. Form hypothesis and TEST it with targeted changes
8. Add console.log/debugger statements if needed to trace execution
9. Verify fix with the EXACT failing scenario MULTIPLE times
10. Check edge cases and timing issues
11. Run related tests to ensure no side effects

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
    this.isPaused = false;
    this.pendingFeedback = null;
    this.recentActions = []; // Track recent actions for sub-agent context
    this.currentGoal = null;
    this.tokenTracker = createTokenTracker(); // Initialize token tracker
    this.contextCompactor = createContextCompactor(modelAdapter); // Initialize context compactor
    this.compactionInProgress = false;
    this.lastCompactionAt = 0; // Track last compaction percentage
    this.recentErrors = []; // Track recent errors for context preservation
  }

  /**
   * Get the token tracker for external access
   */
  getTokenTracker() {
    return this.tokenTracker;
  }

  /**
   * Pause the agent to process feedback
   */
  async pauseForFeedback(feedback) {
    this.isPaused = true;
    this.pendingFeedback = feedback;
  }

  /**
   * Resume the agent after processing feedback
   */
  resume() {
    this.isPaused = false;
    const feedback = this.pendingFeedback;
    this.pendingFeedback = null;
    return feedback;
  }

  /**
   * Main execution loop - keeps running until task is complete
   */
  async execute(userGoal, ui) {
    this.currentGoal = userGoal;
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

      // Check if we're paused for feedback
      if (this.isPaused && this.pendingFeedback) {
        const feedback = this.resume();
        
        // Add feedback to conversation history
        if (feedback && feedback.needsFeedback) {
          conversationHistory.push({
            role: 'system',
            content: `User feedback during execution: ${feedback.feedback}\nPriority: ${feedback.priority}`
          });
          
          // Log that we received feedback
          if (ui?.onLog) {
            const icon = feedback.priority === 'CRITICAL' ? '🔴' : 
                        feedback.priority === 'IMPORTANT' ? '🟡' : '🔵';
            ui.onLog(chalk.cyan(`\n${icon} Feedback incorporated: ${feedback.feedback}`));
          }
        }
      }

      // Check if we should proactively compact based on token usage
      const tokenStatus = this.tokenTracker.getStatus();
      
      // Be more aggressive with compaction if we're seeing large results
      const hasLargeResults = conversationHistory.some(msg => 
        msg.content && msg.content.length > 50000
      );
      const compactionThreshold = hasLargeResults ? 40 : 50; // Lower threshold with large data
      
      const shouldCompact = tokenStatus.inputPercentage >= compactionThreshold && 
                           !this.compactionInProgress &&
                           tokenStatus.inputPercentage > this.lastCompactionAt + 10; // Don't compact too frequently
      
      if (shouldCompact) {
        this.compactionInProgress = true;
        
        if (ui?.onLog) {
          ui.onLog(chalk.yellow(`\n📦 Context at ${Math.round(tokenStatus.inputPercentage)}% capacity - intelligently compacting...`));
        }
        
        // Prepare additional context for compactor
        const additionalContext = {
          currentGoal: this.currentGoal,
          recentErrors: this.recentErrors.slice(-5),
          activeTasks: this.recentActions.filter(a => a.includes('tool:')).slice(-10)
        };
        
        // Use intelligent compaction
        const compacted = await this.contextCompactor.compactConversation(
          conversationHistory, 
          additionalContext
        );
        
        if (compacted && compacted.length < conversationHistory.length) {
          const stats = this.contextCompactor.getCompactionStats(conversationHistory, compacted);
          
          if (ui?.onLog) {
            ui.onLog(chalk.green(`✓ Context compacted: ${stats.saved} tokens saved (${stats.reductionPercent}% reduction)`));
            ui.onLog(chalk.gray(`  Preserved: objectives, errors, active tasks, recent context`));
          }
          
          conversationHistory = compacted;
          this.lastCompactionAt = tokenStatus.inputPercentage;
        }
        
        this.compactionInProgress = false;
      } else if (this.tokenTracker.shouldTrimHistory() && tokenStatus.inputPercentage >= 85) {
        // Emergency trim if we're getting critically close despite compaction
        if (ui?.onLog) {
          ui.onLog(chalk.red('\n🚨 Critical token limit - emergency trimming...'));
        }
        conversationHistory = await this._trimConversationHistory(conversationHistory, ui) || conversationHistory;
      }
      
      // Get next action from LLM
      const response = await this._getNextAction(conversationHistory, ui);
      
      // Save state after AI response for crash recovery
      if (ui?.onAIResponse && response) {
        ui.onAIResponse({
          thinking: response.thinking,
          action: response.action,
          iteration,
          timestamp: new Date().toISOString()
        });
      }
      
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
        
        // Retry with self-correction
        const retryAttempt = this.attempts['invalid-response'] || 0;
        if (retryAttempt < 3) {
          this.attempts['invalid-response'] = retryAttempt + 1;
          
          if (ui?.onLog) ui.onLog(chalk.yellow(`\n🔄 Self-correcting (attempt ${retryAttempt + 1}/3)...`));
          
          // Build a corrective prompt based on what we received
          let correctivePrompt = 'CRITICAL: Your response is missing required fields.\n\n';
          
          if (!response) {
            correctivePrompt += 'You returned null or undefined. You MUST return valid JSON.\n';
          } else if (!response.action) {
            correctivePrompt += `You returned: ${JSON.stringify(response).substring(0, 200)}\n`;
            correctivePrompt += 'This is missing the "action" field.\n';
          }
          
          correctivePrompt += '\nCorrect format:\n';
          correctivePrompt += '{\n';
          correctivePrompt += '  "thinking": "your reasoning here",\n';
          correctivePrompt += '  "action": {\n';
          correctivePrompt += '    "type": "tool" | "complete" | "need_help",\n';
          correctivePrompt += '    "tool": "tool_name" (if type is tool),\n';
          correctivePrompt += '    "params": {...} (if type is tool),\n';
          correctivePrompt += '    "message": "..." (if type is complete or need_help)\n';
          correctivePrompt += '  }\n';
          correctivePrompt += '}\n\n';
          correctivePrompt += 'Please provide a valid response with the action field.';
          
          conversationHistory.push({
            role: 'system',
            content: correctivePrompt
          });
          
          continue; // Try again
        }
        
        // Reset retry counter on failure
        delete this.attempts['invalid-response'];
        
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

      // Track recent actions for sub-agent context
      this.recentActions.push(`${action.type}: ${action.tool || action.message || 'unknown'}`);
      if (this.recentActions.length > 10) {
        this.recentActions.shift(); // Keep only last 10 actions
      }

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
          
          // Don't truncate - rely on intelligent compaction instead
          const toolResultContent = JSON.stringify(result, null, 2);
          
          // Check if result is large and suggest compaction
          if (toolResultContent.length > 50000 && ui?.onLog) {
            const sizeKB = Math.round(toolResultContent.length / 1024);
            ui.onLog(chalk.yellow(`  📊 Large result (${sizeKB}KB) - compaction will handle if needed`));
          }
          
          conversationHistory.push({
            role: 'user',
            content: `Tool result:\n${toolResultContent}`
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
      
      // Update token tracker with usage metadata
      const usageMetadata = response?.usageMetadata || this.model.getLastUsageMetadata();
      if (usageMetadata) {
        this.tokenTracker.updateFromResponse(usageMetadata);
        
        // Check for warnings
        const warning = this.tokenTracker.getWarningMessage();
        if (warning && ui?.onLog) {
          ui.onLog(warning);
        }
        
        // Pass token status to UI
        if (ui?.onTokenUpdate) {
          ui.onTokenUpdate(this.tokenTracker.getStatusBarText());
        }
      }
      
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
      
      // Check if this is a token limit error
      const isTokenLimitError = error.message?.includes('exceeds the maximum number of tokens') || 
                               error.message?.includes('token count') ||
                               error.message?.includes('1048576');
      
      if (isTokenLimitError) {
        if (ui?.onLog) {
          ui.onLog(chalk.yellow('\n⚠️ Token Limit Exceeded'));
          ui.onLog(chalk.yellow('━'.repeat(60)));
          ui.onLog(chalk.yellow('The conversation has grown too large. Attempting to recover...'));
        }
        
        // Try to recover by trimming the conversation history
        const trimmed = await this._trimConversationHistory(conversationHistory, ui);
        if (trimmed) {
          conversationHistory = trimmed;
          
          if (ui?.onLog) {
            ui.onLog(chalk.green('✓ Trimmed conversation history'));
            ui.onLog(chalk.gray(`Reduced from ${history?.length || 0} to ${trimmed.length} messages`));
            ui.onLog(chalk.yellow('Retrying with smaller context...'));
            ui.onLog(chalk.yellow('━'.repeat(60)));
          }
          
          // Retry with trimmed context
          return await this._getNextAction(trimmed, ui);
        }
      }
      
      // Comprehensive error logging for other errors
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
   * Trim conversation history to reduce token count
   * Keep system prompt, initial goal, and recent interactions
   */
  async _trimConversationHistory(history, ui) {
    if (!history || history.length < 10) return null;
    
    // First attempt: Try intelligent compaction if not already in progress
    if (!this.compactionInProgress) {
      try {
        this.compactionInProgress = true;
        
        // Prepare additional context for compaction
        const additionalContext = {
          currentGoal: this.currentGoal,
          recentErrors: this.recentErrors.slice(-5),
          activeTasks: this.recentActions.slice(-5)
        };
        
        if (ui?.onLog) {
          ui.onLog(chalk.yellow('🧠 Attempting intelligent context compaction...'));
        }
        
        const compacted = await this.contextCompactor.compactConversation(
          history, 
          additionalContext
        );
        
        if (compacted && compacted.length < history.length) {
          const stats = this.contextCompactor.getCompactionStats(history, compacted);
          if (ui?.onLog) {
            ui.onLog(chalk.green(`✓ Context compacted: ${stats.reductionPercent}% reduction`));
            ui.onLog(chalk.gray(`Saved ${stats.saved} tokens`));
          }
          this.compactionInProgress = false;
          return compacted;
        }
        
        this.compactionInProgress = false;
      } catch (error) {
        this.compactionInProgress = false;
        if (ui?.onLog) {
          ui.onLog(chalk.yellow('⚠️ Compaction failed, falling back to simple trim'));
        }
      }
    }
    
    // Fallback: Simple trimming if compaction fails or is unavailable
    const systemPrompt = history[0];
    const initialGoal = history[1];
    
    // Keep only the last 6-8 interactions (3-4 exchanges)
    const recentHistory = history.slice(-8);
    
    // Build trimmed history
    const trimmed = [
      systemPrompt,
      initialGoal,
      {
        role: 'system',
        content: '[Previous conversation trimmed to reduce token count. Continue with the current task.]'
      },
      ...recentHistory
    ];
    
    return trimmed;
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
      
      // Save state after tool execution for crash recovery
      if (ui?.onToolComplete) {
        ui.onToolComplete({
          tool: toolName,
          params,
          result,
          timestamp: new Date().toISOString()
        });
      }
      
      if (result.success) {
        // Handle task_list tool specially to update UI
        if (toolName === 'task_list' && ui?.onTaskUpdate) {
          const tasks = params.tasks || [];
          const activeIndex = tasks.findIndex(t => t.status === 'in_progress');
          ui.onTaskUpdate(tasks, activeIndex >= 0 ? activeIndex : 0);
        }
        
        // Provide more descriptive success messages
        if (ui?.onLog) {
          switch(toolName) {
            case 'task_list':
              const completed = params.tasks?.filter(t => t.status === 'completed').length || 0;
              const total = params.tasks?.length || 0;
              ui.onLog(chalk.green(`  ✓ Task list updated (${completed}/${total} complete)`));
              break;
            case 'read_file':
              ui.onLog(chalk.green(`  ✓ Read ${params.path} (${result.data?.content?.split('\n').length || 0} lines)`));
              break;
            case 'write_file':
              ui.onLog(chalk.green(`  ✓ Wrote ${params.path}`));
              break;
            case 'edit_file':
              ui.onLog(chalk.green(`  ✓ Edited ${params.path}`));
              break;
            case 'search_code':
              ui.onLog(chalk.green(`  ✓ Found ${result.data?.matchCount || 0} matches`));
              break;
            case 'run_command':
              ui.onLog(chalk.green(`  ✓ Command executed`));
              break;
            default:
              ui.onLog(chalk.green(`  ✓ Success`));
          }
        }
        
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