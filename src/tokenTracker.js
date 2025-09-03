/**
 * Token usage tracker for Gemini 2.5 Pro
 * Monitors token consumption and provides warnings before hitting limits
 */

import chalk from 'chalk';

export class TokenTracker {
  constructor(maxInputTokens = 1048576, maxOutputTokens = 65536) {
    this.maxInputTokens = maxInputTokens;
    this.maxOutputTokens = maxOutputTokens;
    
    // Current usage
    this.currentInputTokens = 0;
    this.currentOutputTokens = 0;
    this.thoughtsTokens = 0;
    
    // History of token usage
    this.history = [];
    
    // Warning thresholds
    this.thresholds = {
      safe: 0.5,      // 50%
      caution: 0.75,  // 75%
      warning: 0.9,   // 90%
      critical: 0.95  // 95%
    };
  }

  /**
   * Update token counts from a model response
   * @param {Object} usageMetadata - The usageMetadata from Gemini response
   */
  updateFromResponse(usageMetadata) {
    if (!usageMetadata) return;
    
    // Update current counts
    if (usageMetadata.promptTokenCount) {
      this.currentInputTokens = usageMetadata.promptTokenCount;
    }
    if (usageMetadata.responseTokenCount) {
      this.currentOutputTokens = usageMetadata.responseTokenCount;
    }
    if (usageMetadata.thoughtsTokenCount) {
      this.thoughtsTokens = usageMetadata.thoughtsTokenCount;
    }
    
    // Add to history
    this.history.push({
      timestamp: new Date().toISOString(),
      inputTokens: this.currentInputTokens,
      outputTokens: this.currentOutputTokens,
      thoughtsTokens: this.thoughtsTokens
    });
    
    // Keep only last 100 entries
    if (this.history.length > 100) {
      this.history.shift();
    }
  }

  /**
   * Get current token usage status
   */
  getStatus() {
    const inputPercentage = (this.currentInputTokens / this.maxInputTokens) * 100;
    const outputPercentage = (this.currentOutputTokens / this.maxOutputTokens) * 100;
    
    let level = 'safe';
    if (inputPercentage >= this.thresholds.critical * 100) {
      level = 'critical';
    } else if (inputPercentage >= this.thresholds.warning * 100) {
      level = 'warning';
    } else if (inputPercentage >= this.thresholds.caution * 100) {
      level = 'caution';
    } else if (inputPercentage >= this.thresholds.safe * 100) {
      level = 'moderate';
    }
    
    return {
      inputTokens: this.currentInputTokens,
      maxInputTokens: this.maxInputTokens,
      inputPercentage,
      outputTokens: this.currentOutputTokens,
      maxOutputTokens: this.maxOutputTokens,
      outputPercentage,
      thoughtsTokens: this.thoughtsTokens,
      level,
      shouldTrim: inputPercentage >= 80
    };
  }

  /**
   * Format token count for display (e.g., "234K")
   */
  formatTokenCount(count) {
    if (count >= 1000000) {
      return `${(count / 1000000).toFixed(1)}M`;
    } else if (count >= 1000) {
      return `${Math.round(count / 1000)}K`;
    }
    return count.toString();
  }

  /**
   * Get formatted status bar text
   */
  getStatusBarText() {
    const status = this.getStatus();
    const percentage = Math.round(status.inputPercentage);
    const used = this.formatTokenCount(status.inputTokens);
    const max = this.formatTokenCount(status.maxInputTokens);
    
    let color;
    let icon;
    switch (status.level) {
      case 'safe':
        color = 'green';
        icon = '🟢';
        break;
      case 'moderate':
        color = 'cyan';
        icon = '🔵';
        break;
      case 'caution':
        color = 'yellow';
        icon = '🟡';
        break;
      case 'warning':
        color = 'magenta';
        icon = '🟠';
        break;
      case 'critical':
        color = 'red';
        icon = '🔴';
        break;
      default:
        color = 'gray';
        icon = '⚪';
    }
    
    // Create a visual progress bar
    const barLength = 20;
    const filledLength = Math.round((percentage / 100) * barLength);
    const emptyLength = barLength - filledLength;
    const progressBar = '█'.repeat(filledLength) + '░'.repeat(emptyLength);
    
    return {
      text: `${icon} ${percentage}% [${progressBar}] ${used}/${max}`,
      color,
      level: status.level,
      percentage,
      progressBar
    };
  }

  /**
   * Get detailed token report
   */
  getDetailedReport() {
    const status = this.getStatus();
    const report = [];
    
    report.push(chalk.cyan('═══ Token Usage Report ═══'));
    report.push('');
    
    // Input tokens
    const inputBar = this.getProgressBar(status.inputPercentage);
    report.push(chalk.white('Input Tokens:'));
    report.push(`  ${inputBar}`);
    report.push(`  ${this.formatTokenCount(status.inputTokens)} / ${this.formatTokenCount(status.maxInputTokens)} (${Math.round(status.inputPercentage)}%)`);
    report.push('');
    
    // Output tokens
    const outputBar = this.getProgressBar(status.outputPercentage);
    report.push(chalk.white('Output Tokens:'));
    report.push(`  ${outputBar}`);
    report.push(`  ${this.formatTokenCount(status.outputTokens)} / ${this.formatTokenCount(status.maxOutputTokens)} (${Math.round(status.outputPercentage)}%)`);
    
    // Thoughts tokens if any
    if (this.thoughtsTokens > 0) {
      report.push('');
      report.push(chalk.white('Thinking Tokens:'));
      report.push(`  ${this.formatTokenCount(this.thoughtsTokens)}`);
    }
    
    // Recommendations
    report.push('');
    report.push(chalk.white('Status:'));
    if (status.level === 'critical') {
      report.push(chalk.red('  ⚠️ CRITICAL: Context nearly full! Trimming recommended.'));
    } else if (status.level === 'warning') {
      report.push(chalk.yellow('  ⚠️ WARNING: Approaching token limit.'));
    } else if (status.level === 'caution') {
      report.push(chalk.yellow('  ⚡ CAUTION: Token usage above 75%.'));
    } else if (status.level === 'moderate') {
      report.push(chalk.cyan('  ℹ️ Moderate usage. Monitor closely.'));
    } else {
      report.push(chalk.green('  ✅ Token usage is healthy.'));
    }
    
    return report.join('\n');
  }

  /**
   * Get a visual progress bar
   */
  getProgressBar(percentage, width = 30) {
    const filled = Math.round((percentage / 100) * width);
    const empty = width - filled;
    
    let color;
    if (percentage >= 90) color = chalk.red;
    else if (percentage >= 75) color = chalk.yellow;
    else if (percentage >= 50) color = chalk.cyan;
    else color = chalk.green;
    
    const bar = color('█'.repeat(filled)) + chalk.gray('░'.repeat(empty));
    return `[${bar}]`;
  }

  /**
   * Check if we should trim the conversation history
   */
  shouldTrimHistory() {
    const status = this.getStatus();
    return status.inputPercentage >= 80;
  }

  /**
   * Get warning message if needed
   */
  getWarningMessage() {
    const status = this.getStatus();
    
    if (status.level === 'critical') {
      return chalk.red(`🔴 CRITICAL: Token usage at ${Math.round(status.inputPercentage)}% - Context will be trimmed!`);
    } else if (status.level === 'warning') {
      return chalk.yellow(`🟠 WARNING: Token usage at ${Math.round(status.inputPercentage)}% - Approaching limit`);
    } else if (status.level === 'caution' && !this.lastCautionWarning) {
      this.lastCautionWarning = true;
      return chalk.yellow(`🟡 CAUTION: Token usage at ${Math.round(status.inputPercentage)}%`);
    }
    
    return null;
  }

  /**
   * Reset token tracking (for new conversations)
   */
  reset() {
    this.currentInputTokens = 0;
    this.currentOutputTokens = 0;
    this.thoughtsTokens = 0;
    this.history = [];
    this.lastCautionWarning = false;
  }

  /**
   * Export state for persistence
   */
  export() {
    return {
      currentInputTokens: this.currentInputTokens,
      currentOutputTokens: this.currentOutputTokens,
      thoughtsTokens: this.thoughtsTokens,
      history: this.history.slice(-10) // Keep only last 10 entries
    };
  }

  /**
   * Import state from persistence
   */
  import(state) {
    if (state) {
      this.currentInputTokens = state.currentInputTokens || 0;
      this.currentOutputTokens = state.currentOutputTokens || 0;
      this.thoughtsTokens = state.thoughtsTokens || 0;
      this.history = state.history || [];
    }
  }
}

export function createTokenTracker() {
  return new TokenTracker();
}