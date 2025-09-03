import fs from 'node:fs/promises';
import path from 'node:path';
import { Tool, ToolResult } from './base.js';

export class WriteFileTool extends Tool {
  constructor() {
    super(
      'write_file',
      'Create or overwrite a file with new content',
      {
        path: { type: 'string', required: true, description: 'Path where file should be written' },
        content: { type: 'string', required: true, description: 'Content to write to the file' }
      }
    );

    this.whenToUse = [
      'Creating new files from scratch',
      'Writing generated code',
      'Creating configuration files',
      'Saving output or results'
    ];

    this.whenNotToUse = [
      'Modifying parts of existing files (use edit_file)',
      'Appending to files (use edit_file or run_command with >>)'
    ];

    this.examples = [
      { path: 'config.json', content: '{"key": "value"}', description: 'Create config file' },
      { path: 'src/newComponent.tsx', content: '// Component code...', description: 'Create new component' }
    ];
  }

  async execute(params, context) {
    this.validateParams(params);
    
    const { path: filePath, content } = params;
    const cwd = context.cwd || process.cwd();
    const fullPath = path.isAbsolute(filePath) ? filePath : path.join(cwd, filePath);

    try {
      // Ensure directory exists
      const dir = path.dirname(fullPath);
      await fs.mkdir(dir, { recursive: true });

      // Write the file
      await fs.writeFile(fullPath, content, 'utf-8');

      return ToolResult.success({
        path: filePath,
        bytesWritten: Buffer.byteLength(content, 'utf-8'),
        linesWritten: content.split('\n').length
      });
    } catch (error) {
      return ToolResult.failure(`Failed to write file: ${error.message}`, { path: filePath });
    }
  }
}