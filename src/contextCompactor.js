/**
 * Context Compactor - Intelligent conversation summarization
 * Uses a specialized sub-agent to compress context while preserving critical information
 */

import chalk from 'chalk';

const COMPACTOR_SYSTEM_PROMPT = `You are a Context Compactor for TaskCLI. Your job is to intelligently summarize and compress conversation history while preserving ALL critical information needed for task completion.

## Your Mission
Transform verbose conversation history into a compact, information-dense summary that preserves:
1. **Current objectives and goals** - What the user wants to achieve
2. **Active tasks** - What's in progress, what's been tried
3. **Recent errors and issues** - Problems encountered and their context
4. **Key discoveries** - Important findings about the codebase
5. **Critical state** - File paths, configurations, dependencies
6. **Unresolved questions** - Things that need clarification
7. **Solution attempts** - What worked, what didn't, and why

## Compaction Rules
1. **NEVER lose critical information** - Better to be slightly verbose than lose context
2. **Merge redundant exchanges** - Combine multiple back-and-forth into summaries
3. **Preserve exact error messages** - Keep error text verbatim
4. **Maintain chronology** - Keep temporal relationships clear
5. **Flag incomplete work** - Clearly mark what's still pending
6. **Keep recent context detailed** - Last 2-3 exchanges should remain mostly intact
7. **Compress older context aggressively** - Older exchanges can be heavily summarized

## Output Format
Structure your compacted context as:

### Current Objective
[Primary goal the user is trying to achieve]

### Context Summary
[Brief overview of what's been done so far]

### Active Tasks
- [ ] Task 1: [description and current status]
- [ ] Task 2: [description and current status]

### Critical Information
- **Project**: [key details about the project]
- **Environment**: [relevant paths, configs, dependencies]
- **Constraints**: [any limitations or requirements]

### Recent Errors & Issues
[Exact error messages and their context]

### Key Discoveries
[Important findings about the codebase/system]

### Solution History
[What's been tried, outcomes, lessons learned]

### Recent Exchange
[Last 2-3 interactions kept more detailed]

## Example Compaction

BEFORE (1000 tokens):
User: Fix the login bug in auth.js
Assistant: I'll examine auth.js... [reads file]
Assistant: Found issue on line 45... [shows code]
User: That didn't work, getting TypeError
Assistant: Let me check the error... [debugging]
Assistant: The issue is with undefined user object
User: Also need to handle refresh tokens

AFTER (200 tokens):
### Current Objective
Fix login bug in auth.js + handle refresh tokens

### Recent Errors & Issues
TypeError: Cannot read property 'id' of undefined (auth.js:45)

### Solution History
- Examined auth.js, identified issue at line 45
- Initial fix failed due to undefined user object
- Root cause: Missing null check before accessing user.id

### Active Tasks
- [ ] Fix undefined user object bug in auth.js:45
- [ ] Implement refresh token handling

Remember: Your output will REPLACE the conversation history, so it must be self-contained and complete!`;

export class ContextCompactor {
  constructor(modelAdapter) {
    this.modelAdapter = modelAdapter;
  }

  /**
   * Compact conversation history intelligently
   * @param {Array} conversationHistory - Full conversation history
   * @param {Object} additionalContext - Extra context like tasks, errors
   * @returns {Promise<Array>} Compacted conversation history
   */
  async compactConversation(conversationHistory, additionalContext = {}) {
    try {
      // Don't compact if history is already small
      if (conversationHistory.length < 10) {
        return conversationHistory;
      }

      // Prepare the context for compaction
      const contextToCompact = this.prepareContext(conversationHistory, additionalContext);
      
      // Create the compaction request
      const compactionPrompt = `
Please compact the following conversation history while preserving ALL critical information.
The conversation currently uses approximately ${this.estimateTokens(conversationHistory)} tokens.
Target: Reduce by 60-70% while keeping all essential information.

${additionalContext.currentGoal ? `\nCurrent User Goal: ${additionalContext.currentGoal}` : ''}
${additionalContext.recentErrors ? `\nRecent Errors:\n${additionalContext.recentErrors.join('\n')}` : ''}
${additionalContext.activeTasks ? `\nActive Tasks:\n${additionalContext.activeTasks.map(t => `- ${t}`).join('\n')}` : ''}

CONVERSATION TO COMPACT:
${contextToCompact}

Remember: Your summary will REPLACE this conversation, so include EVERYTHING needed to continue the work!`;

      // Use the model to compact
      const history = [
        { role: 'system', content: COMPACTOR_SYSTEM_PROMPT },
        { role: 'user', content: compactionPrompt }
      ];
      
      const response = await this.modelAdapter.generateText(
        compactionPrompt,
        [{ role: 'system', content: COMPACTOR_SYSTEM_PROMPT }],
        0.3 // Lower temperature for consistent summarization
      );

      // Parse the compacted response
      const compactedText = response.text || response;
      
      // Rebuild conversation history
      return this.rebuildConversation(conversationHistory, compactedText);
    } catch (error) {
      console.error(chalk.yellow('Context compaction failed:'), error.message);
      // Return original on failure - better than losing context
      return conversationHistory;
    }
  }

  /**
   * Prepare context for compaction
   */
  prepareContext(conversationHistory, additionalContext) {
    // Skip system prompt, keep last few exchanges detailed
    const systemPrompt = conversationHistory[0];
    const recentCount = 4; // Keep last 2 exchanges (4 messages) detailed
    
    // Split history into sections
    const middleHistory = conversationHistory.slice(1, -recentCount);
    const recentHistory = conversationHistory.slice(-recentCount);
    
    // Format for compaction
    const formatted = [];
    
    // Add middle history (to be compacted)
    formatted.push('=== OLDER CONTEXT (COMPACT AGGRESSIVELY) ===');
    for (const msg of middleHistory) {
      formatted.push(`${msg.role.toUpperCase()}: ${this.truncateMessage(msg.content, 500)}`);
    }
    
    // Add recent history (preserve more detail)
    formatted.push('\n=== RECENT CONTEXT (PRESERVE DETAIL) ===');
    for (const msg of recentHistory) {
      formatted.push(`${msg.role.toUpperCase()}: ${this.truncateMessage(msg.content, 1000)}`);
    }
    
    return formatted.join('\n');
  }

  /**
   * Rebuild conversation with compacted context
   */
  rebuildConversation(originalHistory, compactedText) {
    // Always keep the system prompt
    const systemPrompt = originalHistory[0];
    
    // Keep the last 2-3 exchanges intact
    const recentHistory = originalHistory.slice(-4);
    
    // Create new compacted conversation
    const compactedConversation = [
      systemPrompt,
      {
        role: 'system',
        content: `[CONTEXT COMPACTED at ${new Date().toISOString()}]
        
${compactedText}

[END COMPACTED CONTEXT - Continue from here]`
      },
      ...recentHistory
    ];
    
    return compactedConversation;
  }

  /**
   * Estimate token count (rough approximation)
   */
  estimateTokens(messages) {
    const text = messages.map(m => m.content).join(' ');
    // Rough estimate: 1 token ≈ 4 characters
    return Math.round(text.length / 4);
  }

  /**
   * Truncate message for display
   */
  truncateMessage(content, maxLength) {
    if (content.length <= maxLength) return content;
    return content.substring(0, maxLength) + '... [truncated]';
  }

  /**
   * Check if compaction is recommended
   */
  shouldCompact(tokenUsage) {
    // Recommend compaction at 50% usage to leave room
    return tokenUsage >= 50;
  }

  /**
   * Get compaction statistics
   */
  getCompactionStats(original, compacted) {
    const originalTokens = this.estimateTokens(original);
    const compactedTokens = this.estimateTokens(compacted);
    const reduction = ((originalTokens - compactedTokens) / originalTokens * 100).toFixed(1);
    
    return {
      originalTokens,
      compactedTokens,
      reductionPercent: reduction,
      saved: originalTokens - compactedTokens
    };
  }
}

export function createContextCompactor(modelAdapter) {
  return new ContextCompactor(modelAdapter);
}