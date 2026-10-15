/**
 * File Description: Emits Node test TODO cases as a machine-readable JSON array for CI summaries.
 * Inputs and outputs: Node test event stream -> JSON array of TODO test names.
 * Used by: scripts/ci.ts journey test reporter.
 */

/** Collects TODO test names from structured Node test events. */
module.exports = async function* ciTodoReporter(source) {
  const names = [];
  for await (const event of source) {
    if ((event.type === "test:pass" || event.type === "test:fail") && event.data.todo !== undefined && event.data.skip === undefined) {
      names.push(event.data.name);
    }
  }
  yield `${JSON.stringify(names)}\n`;
};
