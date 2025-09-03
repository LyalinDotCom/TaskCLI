/**
 * Sub-agent evaluator for providing feedback during main agent execution
 * This is a lightweight, read-only agent that evaluates if the main agent needs course correction
 */

import chalk from 'chalk';

const EVALUATOR_SYSTEM_PROMPT = `You are a feedback evaluator sub-agent for TaskCLI. Your ONLY job is to evaluate if the main agent needs any course correction based on new user input.

## Your Role
- You are READ-ONLY - you cannot execute tools or take actions
- You analyze the current execution context and new user input
- You provide concise, actionable feedback ONLY if needed
- You are designed to be fast and lightweight

## Guidelines
1. **When to provide feedback:**
   - User is trying to stop or cancel the current operation
   - User is providing critical correction (e.g., "no not that file, the other one")
   - User is adding important context that changes the approach
   - User notices an error the main agent missed

2. **When to stay silent:**
   - User is just acknowledging or confirming
   - User input is unrelated to current task
   - Main agent is already on the right track
   - User is just expressing impatience

3. **Feedback format:**
   - Be extremely concise (1-2 sentences max)
   - Start with priority: [CRITICAL], [IMPORTANT], or [INFO]
   - Be specific and actionable
   - Never suggest complex new approaches

## Examples:
- User: "stop stop that's the wrong file!" → "[CRITICAL] Stop current operation. User indicates wrong file is being edited."
- User: "ok" → (no feedback needed)
- User: "also make sure it handles null values" → "[IMPORTANT] Add null value handling to current implementation."
- User: "hurry up" → (no feedback needed)

## Current Context
You will be given:
- Current goal the main agent is working on
- Recent actions taken by the main agent
- New user input to evaluate

Respond with either:
- Specific, actionable feedback if needed
- "No feedback needed" if the main agent should continue as-is`;

export class SubAgentEvaluator {
  constructor(modelAdapter) {
    this.modelAdapter = modelAdapter;
  }

  /**
   * Evaluate if the main agent needs any feedback based on new user input
   * @param {Object} context - Current execution context
   * @param {string} context.currentGoal - What the main agent is trying to achieve
   * @param {Array} context.recentActions - Recent actions taken by main agent
   * @param {string} context.newUserInput - New input from user while agent is working
   * @returns {Promise<{needsFeedback: boolean, feedback: string, priority: string}>}
   */
  async evaluate(context) {
    const contextPrompt = `
Current Goal: ${context.currentGoal}

Recent Actions (last 3):
${context.recentActions.slice(-3).map(a => `- ${a}`).join('\n')}

New User Input: "${context.newUserInput}"

Should the main agent receive any feedback? If yes, provide it. If no, respond with "No feedback needed".`;

    try {
      const response = await this.modelAdapter.generateResponse({
        messages: [
          { role: 'system', content: EVALUATOR_SYSTEM_PROMPT },
          { role: 'user', content: contextPrompt }
        ],
        options: {
          temperature: 0.3, // Lower temperature for more consistent evaluation
          maxTokens: 200 // Keep responses short
        }
      });

      const feedback = response.text.trim();
      
      // Parse the response
      if (feedback.toLowerCase().includes('no feedback needed') || feedback === '') {
        return {
          needsFeedback: false,
          feedback: null,
          priority: null
        };
      }

      // Extract priority if present
      let priority = 'INFO';
      if (feedback.includes('[CRITICAL]')) {
        priority = 'CRITICAL';
      } else if (feedback.includes('[IMPORTANT]')) {
        priority = 'IMPORTANT';
      }

      // Clean the feedback text
      const cleanFeedback = feedback
        .replace(/\[(CRITICAL|IMPORTANT|INFO)\]/g, '')
        .trim();

      return {
        needsFeedback: true,
        feedback: cleanFeedback,
        priority
      };
    } catch (error) {
      console.error(chalk.yellow('Sub-agent evaluation failed:'), error.message);
      // Fail gracefully - don't interrupt main agent
      return {
        needsFeedback: false,
        feedback: null,
        priority: null
      };
    }
  }

  /**
   * Format feedback for display in the UI
   */
  formatFeedback(result) {
    if (!result.needsFeedback) {
      return null;
    }

    const priorityColors = {
      'CRITICAL': chalk.red,
      'IMPORTANT': chalk.yellow,
      'INFO': chalk.cyan
    };

    const color = priorityColors[result.priority] || chalk.white;
    const icon = result.priority === 'CRITICAL' ? '🔴' : 
                 result.priority === 'IMPORTANT' ? '🟡' : '🔵';

    return {
      display: `${icon} ${color(result.feedback)}`,
      raw: result.feedback,
      priority: result.priority
    };
  }
}

export function createEvaluator(modelAdapter) {
  return new SubAgentEvaluator(modelAdapter);
}