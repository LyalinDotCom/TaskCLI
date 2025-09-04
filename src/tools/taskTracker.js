/**
 * Task Tracker Tool
 * Allows the agent to maintain and display a task list
 */

export class TaskTrackerTool {
  constructor() {
    this.name = 'task_list';
    this.description = 'Manage and display task list for current goal';
  }
  
  getSpec() {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        action: {
          type: 'string',
          required: true,
          description: 'Action to perform: "show" or "update"'
        },
        tasks: {
          type: 'array',
          required: true,
          description: 'Array of tasks with description, status, and optional changeType (new/modified/removed)'
        },
        reason: {
          type: 'string',
          required: false,
          description: 'Reason for task list changes (e.g., "User feedback", "Discovery", "Error recovery")'
        }
      },
      whenToUse: [
        'At the start of any multi-step task',
        'When user feedback requires task list changes',
        'When discovering new requirements or blockers',
        'After completing/failing a task',
        'When changing approach based on errors'
      ],
      whenNotToUse: [
        'For single, simple commands'
      ],
      examples: [
        { action: 'show', tasks: [{description: 'Fix build error', status: 'in_progress'}] },
        { action: 'update', tasks: [{description: 'Fix TypeScript errors', status: 'completed'}, {description: 'Handle new peer dependency issue', status: 'pending', changeType: 'new'}], reason: 'Discovered missing peer deps' }
      ]
    };
  }
  
  async execute(params) {
    const { action, tasks, reason } = params;
    
    if (action === 'show') {
      // Format and display the current task list
      const formatted = formatTaskList(tasks);
      return {
        success: true,
        data: {
          output: formatted,
          taskCount: tasks.length,
          completed: tasks.filter(t => t.status === 'completed').length
        }
      };
    } else if (action === 'update') {
      // Update task statuses with reason if provided
      let output = reason ? `📝 Task list updated (${reason}):\n` : 'Task list updated:\n';
      
      // Highlight changes
      const hasChanges = tasks.some(t => t.changeType);
      if (hasChanges) {
        output += '\n🔄 Changes:\n';
        tasks.filter(t => t.changeType === 'new').forEach(t => {
          output += `  ➕ Added: ${t.description}\n`;
        });
        tasks.filter(t => t.changeType === 'modified').forEach(t => {
          output += `  🔄 Modified: ${t.description}\n`;
        });
        tasks.filter(t => t.changeType === 'removed').forEach(t => {
          output += `  ❌ Removed: ${t.description}\n`;
        });
        output += '\n';
      }
      
      const formatted = formatTaskList(tasks.filter(t => t.changeType !== 'removed'));
      output += formatted;
      
      return {
        success: true,
        data: {
          output: output,
          taskCount: tasks.filter(t => t.changeType !== 'removed').length,
          completed: tasks.filter(t => t.status === 'completed' && t.changeType !== 'removed').length
        }
      };
    }
    
    return {
      success: false,
      error: `Unknown action: ${action}. Use 'show' or 'update'`
    };
  }
}

function formatTaskList(tasks) {
  if (!tasks || tasks.length === 0) {
    return 'No tasks defined yet.';
  }
  
  const lines = ['📋 Task List:', ''];
  
  tasks.forEach((task, index) => {
    let icon;
    let status;
    
    switch (task.status) {
      case 'completed':
        icon = '✅';
        status = 'completed';
        break;
      case 'in_progress':
        icon = '🔄';
        status = 'in progress';
        break;
      case 'failed':
        icon = '❌';
        status = 'failed';
        break;
      case 'blocked':
        icon = '⚠️';
        status = 'blocked';
        break;
      default:
        icon = '⬜';
        status = 'pending';
    }
    
    lines.push(`${icon} Task ${index + 1}: ${task.description} - ${status}`);
    
    if (task.notes) {
      lines.push(`   └─ ${task.notes}`);
    }
  });
  
  // Add summary
  const completed = tasks.filter(t => t.status === 'completed').length;
  const total = tasks.length;
  const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;
  
  lines.push('');
  lines.push(`Progress: ${completed}/${total} tasks (${percentage}%)`);
  
  return lines.join('\n');
}