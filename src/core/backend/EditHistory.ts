/**
 * EditHistory - Tracks file snapshots for revert functionality
 *
 * Stores snapshots of files before edits, allowing users to
 * undo changes made by the AI assistant.
 */

import type { App } from 'obsidian';

export interface FileSnapshot {
	path: string;
	content: string;
	timestamp: number;
	activityId: string; // Links to ActivityEvent
}

export class EditHistory {
	private snapshots = new Map<string, FileSnapshot[]>();
	private maxVersions: number;
	private app: App;

	constructor(app: App, maxVersions: number = 5) {
		this.app = app;
		this.maxVersions = maxVersions;
	}

	/**
	 * Record a snapshot of a file before editing
	 */
	recordBefore(path: string, content: string, activityId: string): void {
		const snapshot: FileSnapshot = {
			path,
			content,
			timestamp: Date.now(),
			activityId,
		};

		const existing = this.snapshots.get(path) || [];
		existing.push(snapshot);

		// Trim to max versions
		while (existing.length > this.maxVersions) {
			existing.shift();
		}

		this.snapshots.set(path, existing);
	}

	/**
	 * Get all snapshots for a file
	 */
	getSnapshots(path: string): FileSnapshot[] {
		return this.snapshots.get(path) || [];
	}

	/**
	 * Get the most recent snapshot for a file
	 */
	getLatestSnapshot(path: string): FileSnapshot | undefined {
		const snapshots = this.snapshots.get(path);
		return snapshots?.[snapshots.length - 1];
	}

	/**
	 * Get snapshot by activity ID
	 */
	getSnapshotByActivityId(activityId: string): FileSnapshot | undefined {
		for (const snapshots of this.snapshots.values()) {
			const found = snapshots.find((s) => s.activityId === activityId);
			if (found) return found;
		}
		return undefined;
	}

	/**
	 * Revert a file to a specific snapshot
	 */
	async revert(path: string, snapshotIndex: number): Promise<boolean> {
		const snapshots = this.snapshots.get(path);
		if (!snapshots || snapshotIndex < 0 || snapshotIndex >= snapshots.length) {
			return false;
		}

		const snapshot = snapshots[snapshotIndex];

		try {
			const file = this.app.vault.getAbstractFileByPath(path);
			if (!file || !('stat' in file)) {
				return false;
			}

			if (snapshot.content === '') {
				// Empty snapshot means the file didn't exist before — delete it to revert
				await this.app.vault.trash(file as any, true);
			} else {
				await this.app.vault.modify(file as any, snapshot.content);
			}

			// Remove this and all newer snapshots after revert
			this.snapshots.set(path, snapshots.slice(0, snapshotIndex));
			return true;
		} catch (error) {
			console.error('[EditHistory] Failed to revert:', error);
			return false;
		}
	}

	/**
	 * Revert to the snapshot associated with a specific activity
	 */
	async revertByActivityId(activityId: string): Promise<boolean> {
		for (const [path, snapshots] of this.snapshots.entries()) {
			const index = snapshots.findIndex((s) => s.activityId === activityId);
			if (index !== -1) {
				return this.revert(path, index);
			}
		}
		return false;
	}

	/**
	 * Clear all snapshots for a file
	 */
	clear(path: string): void {
		this.snapshots.delete(path);
	}

	/**
	 * Clear all snapshots
	 */
	clearAll(): void {
		this.snapshots.clear();
	}

	/**
	 * Get statistics about stored snapshots
	 */
	getStats(): { files: number; totalSnapshots: number } {
		let totalSnapshots = 0;
		for (const snapshots of this.snapshots.values()) {
			totalSnapshots += snapshots.length;
		}
		return {
			files: this.snapshots.size,
			totalSnapshots,
		};
	}
}

// Singleton instance - will be initialized when app is available
let editHistoryInstance: EditHistory | null = null;

export function getEditHistory(app?: App): EditHistory {
	if (!editHistoryInstance && app) {
		editHistoryInstance = new EditHistory(app);
	}
	if (!editHistoryInstance) {
		throw new Error('EditHistory not initialized - app required');
	}
	return editHistoryInstance;
}

export function initEditHistory(app: App, maxVersions?: number): EditHistory {
	editHistoryInstance = new EditHistory(app, maxVersions);
	return editHistoryInstance;
}
