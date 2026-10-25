/**
 * File Description: Emits Node test TODO cases and skipped cases as machine-readable JSON for CI summaries.
 * Inputs and outputs: Node test event stream -> JSON object with todos and skipped test names.
 * Used by: scripts/ci.ts journey and unit test reporters.
 */

/** Collects TODO and skipped test names from structured Node test events. */
module.exports = async function* ciTodoReporter(source) {
  const todos = [];
  const skipped = [];
  for await (const event of source) {
    if (event.type === "test:pass" || event.type === "test:fail") {
      if (event.data.todo !== undefined && event.data.skip === undefined) {
        todos.push(event.data.name);
      }
      if (event.data.skip !== undefined) {
        skipped.push(event.data.name);
      }
    }
  }
  yield `${JSON.stringify({ todos, skipped })}\n`;
};
