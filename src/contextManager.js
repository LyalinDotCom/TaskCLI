import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';

/**
 * Manages local context for TaskCLI sessions in the working directory
 * Creates and manages .taskcli folder in the current working directory
 */
export class ContextManager {
  constructor(workingDir = process.cwd()) {
    this.workingDir = workingDir;
    this.contextDir = path.join(workingDir, '.taskcli');
    this.contextFile = path.join(this.contextDir, 'context.json');
    this.sessionFile = path.join(this.contextDir, 'session.json');
  }

  /**
   * Check if a context exists in the current directory
   */
  hasContext() {
    return fs.existsSync(this.contextFile);
  }

  /**
   * Initialize context directory if it doesn't exist
   */
  initContextDir() {
    if (!fs.existsSync(this.contextDir)) {
      fs.mkdirSync(this.contextDir, { recursive: true });
    }
  }

  /**
   * Save context to the local .taskcli folder
   */
  saveContext(session, options = {}) {
    this.initContextDir();
    
    const context = {
      version: '1.0',
      workingDir: this.workingDir,
      createdAt: session.createdAt,
      updatedAt: new Date().toISOString(),
      sessionId: session.id,
      meta: session.meta,
      resumable: true,
      ...options
    };

    // Save context metadata
    fs.writeFileSync(this.contextFile, JSON.stringify(context, null, 2), 'utf8');
    
    // Save full session data
    fs.writeFileSync(this.sessionFile, JSON.stringify(session, null, 2), 'utf8');
  }

  /**
   * Load context from the local .taskcli folder
   */
  loadContext() {
    if (!this.hasContext()) {
      return null;
    }

    try {
      const contextData = JSON.parse(fs.readFileSync(this.contextFile, 'utf8'));
      const sessionData = JSON.parse(fs.readFileSync(this.sessionFile, 'utf8'));
      
      return {
        context: contextData,
        session: sessionData
      };
    } catch (error) {
      console.error(chalk.yellow('Warning: Failed to load context:'), error.message);
      return null;
    }
  }

  /**
   * Get a summary of the existing context
   */
  getContextSummary() {
    const data = this.loadContext();
    if (!data) return null;

    const { context, session } = data;
    const taskCount = session.tasks?.length || 0;
    const historyCount = session.history?.length || 0;
    const lastUpdate = new Date(context.updatedAt);
    const age = Date.now() - lastUpdate.getTime();
    const ageHours = Math.floor(age / (1000 * 60 * 60));
    const ageMinutes = Math.floor((age % (1000 * 60 * 60)) / (1000 * 60));

    let ageString;
    if (ageHours > 0) {
      ageString = `${ageHours}h ${ageMinutes}m ago`;
    } else {
      ageString = `${ageMinutes}m ago`;
    }

    // Get last goal from history
    let lastGoal = 'No previous goals';
    for (let i = session.history.length - 1; i >= 0; i--) {
      if (session.history[i].type === 'user_goal') {
        lastGoal = session.history[i].message;
        break;
      }
    }

    return {
      workingDir: context.workingDir,
      sessionId: context.sessionId,
      age: ageString,
      taskCount,
      historyCount,
      lastGoal,
      lastUpdate: context.updatedAt
    };
  }

  /**
   * Clear the context (useful for starting fresh)
   */
  clearContext() {
    if (fs.existsSync(this.contextFile)) {
      fs.unlinkSync(this.contextFile);
    }
    if (fs.existsSync(this.sessionFile)) {
      fs.unlinkSync(this.sessionFile);
    }
  }

  /**
   * Archive the current context before starting a new session
   */
  archiveContext() {
    if (!this.hasContext()) return;

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const archiveDir = path.join(this.contextDir, 'archive');
    
    if (!fs.existsSync(archiveDir)) {
      fs.mkdirSync(archiveDir, { recursive: true });
    }

    // Move current context to archive
    const archiveContextFile = path.join(archiveDir, `context-${timestamp}.json`);
    const archiveSessionFile = path.join(archiveDir, `session-${timestamp}.json`);

    fs.renameSync(this.contextFile, archiveContextFile);
    fs.renameSync(this.sessionFile, archiveSessionFile);
  }
}

/**
 * Get context manager for the current working directory
 */
export function getContextManager(workingDir = process.cwd()) {
  return new ContextManager(workingDir);
}