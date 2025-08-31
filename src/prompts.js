export function planningPrompt({ goal, memorySummary, cwd }) {
  return `You are TaskCLI's planning brain (Gemini Flash). Your job is to break down the user's goal into a clear, executable task list for a coding-oriented CLI.

CONTEXT
- Working directory: ${cwd}
- Memory summary: ${memorySummary || 'None yet'}

REQUIREMENTS
- Output strictly as JSON with a top-level object {"tasks": Task[]} with no extra prose.
- Prefer many small, safe steps over one giant step.
- Use only these task types:
  - write_file { path: string, content_prompt?: string, content?: string }
  - read_file { path: string }
  - run_command { command: string, cwd?: string, confirm?: boolean }
  - search_web { query: string, numResults?: number }
  - generate_file_from_prompt { path: string, prompt: string }
  - edit_file { path: string, instruction: string }
  - ask_user { questions: string[] }  // Use this when the goal is vague/ambiguous/incomplete.
- If code/content must be generated, do NOT inline it here. Provide a concise 'content_prompt' or 'prompt' that the Pro model will use to generate high-quality code.
- Use relative paths under the working dir. Ensure parent folders exist implicitly.
- Always include a short title and rationale for each task.
- For exploration tasks, use explicit commands like 'ls -la' or 'find . -type f -name "*.js"' instead of expecting the agent to read non-existent files.

CLARIFICATION POLICY (IMPORTANT)
- Only use ask_user when the goal is severely vague/ambiguous or missing critical decisions that materially change the plan.
- Examples of SEVERELY vague inputs: "test", "help", a single word, or no concrete deliverable/context.
- Otherwise, DO NOT ask the user. Proceed with safe, standard assumptions (e.g., conventional defaults, current working directory) and let the executor (Pro) resolve details.
- Never turn a reasonably specific request into questions if you can plan actionable steps safely.


GOAL
${goal}

Return JSON only, like:
{"tasks":[
  {"id":"T1","type":"run_command","title":"List directory contents","rationale":"Explore project structure","command":"ls -la"},
  {"id":"T2","type":"run_command","title":"Find all JS files","rationale":"Locate JavaScript code","command":"find . -type f -name \"*.js\" | head -20"},
  {"id":"T3","type":"generate_file_from_prompt","title":"Summarize findings","rationale":"Document discovered projects","path":"project-summary.md","prompt":"Based on the file listing from previous steps, create a markdown summary of the projects found"}
]}

If the goal is severely vague, return:
{"tasks":[
  {"id":"T1","type":"ask_user","title":"Clarify requirements","rationale":"The goal is too vague to plan safely.","questions":[
    "What do you want to build or test specifically?",
    "Which language/framework or target directory should we use?"
  ]}
]}`;
}

export function codeGenPrompt({ instruction, context }) {
  return `You are TaskCLI's coding brain (Gemini Pro). Produce complete, high-quality code.

INSTRUCTION
${instruction}

CONTEXT
${context || 'N/A'}

IMPORTANT: Use only information that has been explicitly provided. Do not assume files exist unless they were shown in previous command outputs.

OUTPUT
- Return only the final code content. No markdown fences, no commentary.`;
}

export function editFilePrompt({ filepath, currentContent, instruction, context }) {
  return `You are TaskCLI's coding brain (Gemini Pro). Edit the provided file based on the instruction.

FILE PATH
${filepath}

CURRENT CONTENT
${currentContent}

INSTRUCTION
${instruction}

CONTEXT
${context || 'N/A'}

OUTPUT
- Return only the full updated file content. No comments or fences.`;
}

export function stuckAnalysisPrompt(context) {
  return `You are the planning brain (Gemini Flash). Determine if a command run was interactive, failed, or stuck, and give a concise hint.

Return JSON only: {"status":"interactive|error|stuck","summary":"...","hint":"..."}

Context:
${JSON.stringify(context, null, 2)}`;
}

export function retryCommandPrompt(payload) {
  return `You are the coding/execution brain (Gemini Pro). Given command context and a brief assessment, propose a precise next step.

Return JSON only. One of:
{"action":"run","commands":["..."],"note":"..."}
{"action":"ask_user","question":"..."}
{"action":"abort","note":"..."}

Rules:
- Prefer non-interactive flags (e.g., --yes/--no-*, --force) and CI-friendly settings.
- Use explicit flags for popular tools (e.g., create-next-app: --turbopack/--no-turbopack, --tailwind/--no-tailwind etc.).
- If critical info is missing, ask user.

Input:
${JSON.stringify(payload, null, 2)}`;
}

export function planAdjustPrompt({ goal, currentPlan, queuedInputs }) {
  return `You are TaskCLI's planning brain (Gemini Flash). Adjust the current plan based on new user inputs.

GOAL
${goal}

CURRENT PLAN (array of Task with id/type/title/rationale/command/path)
${JSON.stringify(currentPlan, null, 2)}

NEW USER INPUTS
${queuedInputs && queuedInputs.length ? queuedInputs.map((s, i) => `${i + 1}. ${s}`).join('\n') : '(none)'}

Return JSON only with one of:
{"action":"cancel","note":"why"}
or
{"action":"update","tasks": Task[], "note":"short rationale"}

Constraints:
- Keep tasks valid for the executor (types: write_file, read_file, run_command, search_web, generate_file_from_prompt, edit_file).
- Preserve existing task IDs when still relevant; use new IDs for added items.
- Remove tasks that are no longer applicable.
- Keep the list concise and safe.`;
}
