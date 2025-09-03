import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { Tool, ToolResult } from './base.js';

const execAsync = promisify(exec);

export class RunCommandTool extends Tool {
  constructor() {
    super(
      'run_command',
      'Execute a shell command and return output',
      {
        command: { type: 'string', required: true, description: 'The command to execute' },
        working_dir: { type: 'string', required: false, description: 'Working directory for command' },
        timeout: { type: 'number', required: false, description: 'Timeout in milliseconds (default: 30000)' },
        continue_on_error: { type: 'boolean', required: false, description: 'Continue even if command fails' }
      }
    );

    this.whenToUse = [
      'Running build commands (npm build, npm test)',
      'Executing scripts',
      'Installing dependencies',
      'Running linters or formatters'
    ];

    this.whenNotToUse = [
      'Reading files (use read_file)',
      'Searching for code (use search_code)',
      'Making file edits (use edit_file)'
    ];

    this.examples = [
      { command: 'npm run build', description: 'Build the project' },
      { command: 'npm test', working_dir: './src', description: 'Run tests from src directory' }
    ];
  }

  async execute(params, context) {
    this.validateParams(params);
    
    const { command, working_dir, timeout = 30000, continue_on_error = false } = params;
    const cwd = working_dir || context.cwd || process.cwd();

    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd,
        timeout,
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer
        env: { ...process.env, FORCE_COLOR: '0' } // Disable color output for cleaner logs
      });

      // Many commands write to stderr even on success (npm, git, etc)
      const output = (stdout + (stderr ? `\nstderr:\n${stderr}` : '')).trim();
      
      return ToolResult.success({
        command,
        output,
        cwd,
        exitCode: 0
      });
    } catch (error) {
      const output = (error.stdout || '') + (error.stderr || '');
      const result = {
        command,
        output,
        cwd,
        exitCode: error.code || 1,
        error: error.message
      };

      if (continue_on_error) {
        return ToolResult.success(result); // Return as success but with error info
      }
      
      return ToolResult.failure(error.message, result);
    }
  }
}