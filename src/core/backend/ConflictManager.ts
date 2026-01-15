/**
 * Conflict Manager
 *
 * Tracks file versions to detect conflicts when the backend tries to
 * modify files that have changed since they were read.
 */

import { App, TFile, Notice } from 'obsidian';

interface FileVersion {
	path: string;
	hash: string;
	mtime: number;
	content: string; // Keep for diff display if needed
}

export interface ConflictInfo {
	path: string;
	expectedContent: string;
	actualContent: string;
	expectedHash: string;
	actualHash: string;
}

export class ConflictManager {
	private versions = new Map<string, FileVersion>();

	constructor(private app: App) {
		// Watch for external file modifications
		this.app.vault.on('modify', (file) => {
			if (file instanceof TFile && this.versions.has(file.path)) {
				this.handleExternalModify(file);
			}
		});
	}

	/**
	 * Record the version of a file that was read
	 */
	recordVersion(path: string, content: string, mtime: number): string {
		const hash = this.hashContent(content);
		this.versions.set(path, { path, hash, mtime, content });
		return hash;
	}

	/**
	 * Clear the tracked version of a file
	 */
	clearVersion(path: string): void {
		this.versions.delete(path);
	}

	/**
	 * Check if a file has conflicts (modified since last read)
	 */
	async checkConflict(path: string): Promise<ConflictInfo | null> {
		const tracked = this.versions.get(path);
		if (!tracked) {
			return null; // No tracked version, no conflict possible
		}

		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) {
			return null; // File was deleted or is not a file
		}

		// Check if mtime changed
		if (file.stat.mtime === tracked.mtime) {
			return null; // No change
		}

		// mtime changed, check content hash
		const currentContent = await this.app.vault.read(file);
		const currentHash = this.hashContent(currentContent);

		if (currentHash === tracked.hash) {
			// Content unchanged despite mtime (metadata change only)
			return null;
		}

		// Conflict detected!
		return {
			path,
			expectedContent: tracked.content,
			actualContent: currentContent,
			expectedHash: tracked.hash,
			actualHash: currentHash,
		};
	}

	/**
	 * Handle external file modifications
	 */
	private async handleExternalModify(file: TFile): Promise<void> {
		const tracked = this.versions.get(file.path);
		if (!tracked) return;

		const currentContent = await this.app.vault.read(file);
		const currentHash = this.hashContent(currentContent);

		if (currentHash !== tracked.hash) {
			console.warn(
				`[ConflictManager] File ${file.path} was modified externally`
			);
			// Note: We don't show a notice here because the backend will
			// check for conflicts before writing. This is just for logging.
		}
	}

	/**
	 * Simple hash function for content comparison
	 */
	private hashContent(content: string): string {
		let hash = 0;
		for (let i = 0; i < content.length; i++) {
			const char = content.charCodeAt(i);
			hash = (hash << 5) - hash + char;
			hash = hash & hash; // Convert to 32-bit integer
		}
		return hash.toString(36);
	}
}
