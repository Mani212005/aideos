/**
 * File Description: Transaction-Grouped UpdateAction Engine for Aideos Timeline.
 * Implements Pattern 2 (OpenShot / Canva architecture):
 * - Granular UpdateAction records recording JSON paths, old/new values, and transaction UUIDs.
 * - Single user gestures produce multiple actions grouped under one atomic transaction ID.
 * - Universal undo/redo pops and reverses transactions atomically.
 */

export type ActionType = "insert" | "update" | "delete";

export interface UpdateAction {
  type: ActionType;
  path: (string | number)[];
  oldValue: unknown;
  newValue: unknown;
  transactionId: string;
  label: string;
  timestamp: number;
}

export interface TimelineTransaction<T = any> {
  id: string;
  label: string;
  timestamp: number;
  filmSnapshotBefore: T;
  filmSnapshotAfter: T;
  actions: UpdateAction[];
}

export function generateUUID(): string {
  return "tx-" + Math.random().toString(36).substring(2, 9) + "-" + Date.now().toString(36);
}

export class TimelineTransactionManager<T = any> {
  private undoStack: TimelineTransaction<T>[] = [];
  private redoStack: TimelineTransaction<T>[] = [];
  private readonly maxDepth: number;

  constructor(maxDepth = 60) {
    this.maxDepth = maxDepth;
  }

  /**
   * Commit a new atomic transaction consisting of one or more UpdateActions.
   */
  commit(
    filmBefore: T,
    filmAfter: T,
    actions: Array<Omit<UpdateAction, "transactionId" | "timestamp">>,
    label: string,
    txId = generateUUID()
  ): TimelineTransaction<T> {
    const timestamp = Date.now();
    const fullActions: UpdateAction[] = actions.map((a) => ({
      ...a,
      transactionId: txId,
      timestamp,
    }));

    const transaction: TimelineTransaction<T> = {
      id: txId,
      label,
      timestamp,
      filmSnapshotBefore: JSON.parse(JSON.stringify(filmBefore)),
      filmSnapshotAfter: JSON.parse(JSON.stringify(filmAfter)),
      actions: fullActions,
    };

    this.undoStack.push(transaction);
    if (this.undoStack.length > this.maxDepth) {
      this.undoStack.shift();
    }
    this.redoStack = []; // New commit clears redo stack

    return transaction;
  }

  /**
   * Undo the latest transaction in the history stack.
   */
  undo(currentFilm: T): { film: T; transaction: TimelineTransaction<T> } | null {
    if (this.undoStack.length === 0) return null;
    const tx = this.undoStack.pop()!;
    this.redoStack.push({
      ...tx,
      filmSnapshotAfter: JSON.parse(JSON.stringify(currentFilm)),
    });
    return {
      film: JSON.parse(JSON.stringify(tx.filmSnapshotBefore)),
      transaction: tx,
    };
  }

  /**
   * Redo the most recently undone transaction.
   */
  redo(currentFilm: T): { film: T; transaction: TimelineTransaction<T> } | null {
    if (this.redoStack.length === 0) return null;
    const tx = this.redoStack.pop()!;
    this.undoStack.push({
      ...tx,
      filmSnapshotBefore: JSON.parse(JSON.stringify(currentFilm)),
    });
    return {
      film: JSON.parse(JSON.stringify(tx.filmSnapshotAfter)),
      transaction: tx,
    };
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  get depth(): number {
    return this.undoStack.length;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }
}
