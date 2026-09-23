/**
 * File Description: Turns a studio task prompt into one a connected agent can carry out.
 * Studio prompts are written for an agent sitting in the aideos checkout (paths to write, CLI
 * commands to run). An agent reached through `aideos connect` has neither, only the aideos MCP
 * tools, so it gets a short preamble mapping each of those instructions onto a tool.
 */

// Wraps a studio prompt for an agent that works only through the aideos MCP tools.
export function remoteTaskPrompt(taskId: string, prompt: string): string {
  return `You are the coding agent connected to an Aideos studio (task ${taskId}).
You have no shell and no checkout: use only the aideos MCP tools.
- Where the task says to read a file under videos/<film>/, call aideos_read_file (or aideos_design_brief for BRIEF.md).
- Where it says to write videos/<film>/design/design.json or videos/<film>/visuals/<name>.svg, call aideos_write_file.
- Where it says to run \`aideos design build <film>\`, call aideos_design_build; for \`aideos design check\`, call aideos_design_check (review stills are not available remotely).
- Report meaningful progress with aideos_report_step, and finish with aideos_complete_task (taskId "${taskId}") and a one-line summary.

${prompt}`;
}
