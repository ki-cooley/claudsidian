/** Unsent composer text per session, kept for the plugin's lifetime so switching sessions loses nothing. */
const drafts = new Map<string, string>();

export function getDraft(sessionId: string): string {
  return drafts.get(sessionId) ?? '';
}

export function setDraft(sessionId: string, text: string): void {
  if (text) drafts.set(sessionId, text);
  else drafts.delete(sessionId);
}

/** Tests only. */
export function resetDrafts(): void {
  drafts.clear();
}
