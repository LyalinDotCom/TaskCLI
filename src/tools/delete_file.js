import fs from 'node:fs/promises';
import path from 'node:path';
import { Tool, ToolResult } from './base.js';

export class DeleteFileTool extends Tool {
  constructor() {
    super(
      'delete_file',
      'Safely delete files or directories',
      {
        path: { 
          type: 'string', 
          required: true, 
          description: 'Path to file or directory to delete' 
        },
        force: { 
          type: 'boolean', 
          required: false, 
          description: 'Force deletion of directories with contents (default: false)' 
        },
        dry_run: { 
          type: 'boolean', 
          required: false, 
          description: 'Preview what would be deleted without actually deleting (default: false)' 
        }
      }
    );

    this.whenToUse = [
      'Removing temporary files',
      'Cleaning up build artifacts',
      'Deleting generated files',
      'Removing backup files'
    ];

    this.whenNotToUse = [
      'Deleting system files',
      'Removing .git directory',
      'Deleting node_modules (use npm/yarn clean instead)'
    ];

    this.examples = [
      { path: 'temp.txt', description: 'Delete a single file' },
      { path: 'build/', force: true, description: 'Delete build directory and contents' },
      { path: 'output/', dry_run: true, description: 'Preview what would be deleted' }
    ];

    // Protected paths that should never be deleted
    this.protectedPaths = [
      '.git',
      '.env',
      'node_modules',
      'package.json',
      'package-lock.json',
      'yarn.lock',
      'pnpm-lock.yaml',
      '.gitignore',
      'tsconfig.json',
      'src',
      '/',
      '/etc',
      '/usr',
      '/bin',
      '/sbin',
      '/home',
      '/Users',
      process.env.HOME
    ];
  }

  isProtected(filePath) {
    const absolute = path.resolve(filePath);
    const normalized = path.normalize(filePath);
    
    // Check if it's a protected path
    for (const protectedPath of this.protectedPaths) {
      if (normalized === protectedPath || 
          absolute === path.resolve(protectedPath) ||
          normalized.startsWith(protectedPath + '/')) {
        return true;
      }
    }
    
    // Don't delete parent directories
    if (normalized === '..' || normalized.startsWith('../')) {
      return true;
    }
    
    return false;
  }

  async execute(params, context) {
    this.validateParams(params);
    
    const { path: targetPath, force = false, dry_run = false } = params;
    const cwd = context?.cwd || process.cwd();
    const fullPath = path.resolve(cwd, targetPath);
    
    // Safety check - prevent deleting protected paths
    if (this.isProtected(targetPath)) {
      return ToolResult.failure(
        `Cannot delete protected path: ${targetPath}`,
        { path: targetPath, reason: 'Protected path' }
      );
    }
    
    try {
      // Check if path exists
      const stats = await fs.stat(fullPath).catch(() => null);
      
      if (!stats) {
        return ToolResult.failure(
          `Path does not exist: ${targetPath}`,
          { path: targetPath, exists: false }
        );
      }
      
      const isDirectory = stats.isDirectory();
      
      if (dry_run) {
        // Dry run - just report what would be deleted
        let info = {
          path: targetPath,
          fullPath: fullPath,
          type: isDirectory ? 'directory' : 'file',
          size: stats.size,
          wouldDelete: true
        };
        
        if (isDirectory) {
          // Count items in directory
          const items = await fs.readdir(fullPath);
          info.itemCount = items.length;
          info.items = items.slice(0, 10); // Show first 10 items
          if (items.length > 10) {
            info.items.push(`... and ${items.length - 10} more items`);
          }
        }
        
        return ToolResult.success({
          message: `[DRY RUN] Would delete ${isDirectory ? 'directory' : 'file'}: ${targetPath}`,
          ...info
        });
      }
      
      // Actual deletion
      if (isDirectory) {
        if (!force) {
          // Check if directory is empty
          const items = await fs.readdir(fullPath);
          if (items.length > 0) {
            return ToolResult.failure(
              `Directory is not empty. Use force: true to delete non-empty directories`,
              { 
                path: targetPath, 
                itemCount: items.length,
                hint: 'Set force: true to delete directory with contents'
              }
            );
          }
          await fs.rmdir(fullPath);
        } else {
          // Force delete directory with contents
          await fs.rm(fullPath, { recursive: true, force: true });
        }
        
        return ToolResult.success({
          message: `Deleted directory: ${targetPath}`,
          path: targetPath,
          type: 'directory',
          forced: force
        });
      } else {
        // Delete file
        await fs.unlink(fullPath);
        
        return ToolResult.success({
          message: `Deleted file: ${targetPath}`,
          path: targetPath,
          type: 'file'
        });
      }
    } catch (error) {
      return ToolResult.failure(
        `Failed to delete ${targetPath}: ${error.message}`,
        { path: targetPath, error: error.message }
      );
    }
  }
}