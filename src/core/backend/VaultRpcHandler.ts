/**
 * Vault RPC Handler
 *
 * Handles RPC requests from the backend for vault operations.
 * Uses Obsidian's API to read, write, search, list, and delete files.
 */

import { App, TFile, TFolder, Notice } from 'obsidian';
import type { SearchResult, FileInfo, GrepResult } from './protocol';
import { getEditHistory } from './EditHistory';

export class VaultRpcHandler {
	constructor(private app: App) {}

	/**
	 * Check if a path is a dotfile/dotfolder (starts with . in any segment).
	 * Obsidian's vault API doesn't index these, so we must use the adapter.
	 */
	private isDotfilePath(path: string): boolean {
		return path.split('/').some(segment => segment.startsWith('.'));
	}

	/**
	 * Handle an RPC request from the backend
	 * @param activityId - Optional activity ID for tracking edits
	 */
	async handleRpc(
		method: string,
		params: Record<string, unknown>,
		activityId?: string
	): Promise<unknown> {
		switch (method) {
			case 'vault_read':
				return this.vaultRead(params.path as string);
			case 'vault_write':
				return this.vaultWrite(
					params.path as string,
					params.content as string,
					activityId
				);
			case 'vault_edit':
				return this.vaultEdit(
					params.path as string,
					params.old_string as string,
					params.new_string as string,
					activityId
				);
			case 'vault_search':
				return this.vaultSearch(
					params.query as string,
					(params.limit as number) || 20
				);
			case 'vault_grep':
				return this.vaultGrep(
					params.pattern as string,
					(params.folder as string) || '',
					(params.file_pattern as string) || '*.md',
					(params.limit as number) || 50
				);
			case 'vault_glob':
				return this.vaultGlob(params.pattern as string);
			case 'vault_list':
				return this.vaultList((params.folder as string) || '');
			case 'vault_rename':
				return this.vaultRename(
					params.old_path as string,
					params.new_path as string,
					activityId
				);
			case 'vault_delete':
				return this.vaultDelete(params.path as string, activityId);
			default:
				throw new Error(`Unknown RPC method: ${method}`);
		}
	}

	/**
	 * Read file content from vault
	 */
	private async vaultRead(path: string): Promise<{ content: string }> {
		// Dotfiles aren't indexed by Obsidian — use adapter directly
		if (this.isDotfilePath(path)) {
			const adapter = this.app.vault.adapter;
			if (!(await adapter.exists(path))) {
				throw new Error(`File not found: ${path}`);
			}
			const content = await adapter.read(path);
			return { content };
		}

		const file = this.app.vault.getAbstractFileByPath(path);

		if (!file) {
			throw new Error(`File not found: ${path}`);
		}

		if (!(file instanceof TFile)) {
			throw new Error(`Path is not a file: ${path}`);
		}

		const content = await this.app.vault.cachedRead(file);

		return { content };
	}

	/**
	 * Write content to a file (create or overwrite)
	 */
	private async vaultWrite(
		path: string,
		content: string,
		activityId?: string
	): Promise<{ success: boolean }> {
		// Dotfiles aren't indexed by Obsidian — use adapter directly
		if (this.isDotfilePath(path)) {
			const adapter = this.app.vault.adapter;
			const exists = await adapter.exists(path);
			if (exists && activityId) {
				try {
					const oldContent = await adapter.read(path);
					getEditHistory(this.app).recordBefore(path, oldContent, activityId);
				} catch (e) {
					console.warn('[VaultRpcHandler] Failed to record snapshot:', e);
				}
			} else if (!exists && activityId) {
				getEditHistory(this.app).recordBefore(path, '', activityId);
			}
			// Ensure parent directory exists
			const folderPath = path.substring(0, path.lastIndexOf('/'));
			if (folderPath && !(await adapter.exists(folderPath))) {
				await adapter.mkdir(folderPath);
			}
			await adapter.write(path, content);
			return { success: true };
		}

		const existingFile = this.app.vault.getAbstractFileByPath(path);

		if (existingFile instanceof TFile) {
			// File exists - record snapshot before overwriting
			if (activityId) {
				try {
					const oldContent = await this.app.vault.read(existingFile);
					getEditHistory(this.app).recordBefore(path, oldContent, activityId);
				} catch (e) {
					console.warn('[VaultRpcHandler] Failed to record snapshot:', e);
				}
			}
			// Modify the file
			await this.app.vault.modify(existingFile, content);
		} else if (existingFile instanceof TFolder) {
			throw new Error(`Path is a folder, not a file: ${path}`);
		} else {
			// File doesn't exist, create it
			// Record empty snapshot for new files (so revert = delete)
			if (activityId) {
				getEditHistory(this.app).recordBefore(path, '', activityId);
			}
			// First, ensure parent folders exist
			const folderPath = path.substring(0, path.lastIndexOf('/'));
			if (folderPath) {
				await this.ensureFolderExists(folderPath);
			}

			await this.app.vault.create(path, content);
		}

		return { success: true };
	}

	/**
	 * Edit a file by replacing a specific string
	 */
	private async vaultEdit(
		path: string,
		oldString: string,
		newString: string,
		activityId?: string
	): Promise<{ success: boolean }> {
		// Dotfiles aren't indexed by Obsidian — use adapter directly
		if (this.isDotfilePath(path)) {
			const adapter = this.app.vault.adapter;
			if (!(await adapter.exists(path))) {
				throw new Error(`File not found: ${path}`);
			}
			const content = await adapter.read(path);

			if (!content.includes(oldString)) {
				throw new Error(
					`String not found in file. Make sure old_string matches exactly (including whitespace).`
				);
			}
			const occurrences = content.split(oldString).length - 1;
			if (occurrences > 1) {
				throw new Error(
					`String appears ${occurrences} times in file. Provide more context to make it unique.`
				);
			}
			if (activityId) {
				try {
					getEditHistory(this.app).recordBefore(path, content, activityId);
				} catch (e) {
					console.warn('[VaultRpcHandler] Failed to record snapshot:', e);
				}
			}
			const newContent = content.replace(oldString, newString);
			await adapter.write(path, newContent);
			return { success: true };
		}

		const file = this.app.vault.getAbstractFileByPath(path);

		if (!file) {
			throw new Error(`File not found: ${path}`);
		}

		if (!(file instanceof TFile)) {
			throw new Error(`Path is not a file: ${path}`);
		}

		const content = await this.app.vault.read(file);

		// Check if old_string exists in file
		if (!content.includes(oldString)) {
			throw new Error(
				`String not found in file. Make sure old_string matches exactly (including whitespace).`
			);
		}

		// Check if old_string is unique
		const occurrences = content.split(oldString).length - 1;
		if (occurrences > 1) {
			throw new Error(
				`String appears ${occurrences} times in file. Provide more context to make it unique.`
			);
		}

		// Record snapshot before editing
		if (activityId) {
			try {
				getEditHistory(this.app).recordBefore(path, content, activityId);
			} catch (e) {
				console.warn('[VaultRpcHandler] Failed to record snapshot:', e);
			}
		}

		// Replace the string
		const newContent = content.replace(oldString, newString);
		await this.app.vault.modify(file, newContent);

		return { success: true };
	}

	/**
	 * Search for files matching a query
	 */
	private async vaultSearch(
		query: string,
		limit: number
	): Promise<SearchResult[]> {
		const results: SearchResult[] = [];
		const files = this.app.vault.getMarkdownFiles();
		const queryLower = query.toLowerCase();

		for (const file of files) {
			if (results.length >= limit) break;

			// Check filename first
			if (file.path.toLowerCase().includes(queryLower)) {
				results.push({
					path: file.path,
					snippet: `Filename match: ${file.basename}`,
				});
				continue;
			}

			// Check file content
			try {
				const content = await this.app.vault.cachedRead(file);
				const contentLower = content.toLowerCase();
				const index = contentLower.indexOf(queryLower);

				if (index !== -1) {
					// Extract snippet around match
					const start = Math.max(0, index - 50);
					const end = Math.min(
						content.length,
						index + query.length + 50
					);
					let snippet = content.substring(start, end);

					// Add ellipsis
					if (start > 0) snippet = '...' + snippet;
					if (end < content.length) snippet = snippet + '...';

					results.push({ path: file.path, snippet });
				}
			} catch (error) {
				console.error(
					`[VaultRpcHandler] Error reading file ${file.path}:`,
					error
				);
			}
		}

		return results;
	}

	/**
	 * Search file contents using a regex pattern
	 */
	private async vaultGrep(
		pattern: string,
		folder: string,
		filePattern: string,
		limit: number
	): Promise<GrepResult[]> {
		const results: GrepResult[] = [];
		const files = this.app.vault.getMarkdownFiles();

		// Compile regex
		let regex: RegExp;
		try {
			regex = new RegExp(pattern, 'gi');
		} catch (e) {
			throw new Error(`Invalid regex pattern: ${pattern}`);
		}

		// Convert glob pattern to regex for file matching
		const fileRegex = this.globToRegex(filePattern);

		for (const file of files) {
			if (results.length >= limit) break;

			// Check folder filter
			if (folder && !file.path.startsWith(folder)) {
				continue;
			}

			// Check file pattern
			if (!fileRegex.test(file.name)) {
				continue;
			}

			try {
				const content = await this.app.vault.cachedRead(file);
				const lines = content.split('\n');

				for (let i = 0; i < lines.length && results.length < limit; i++) {
					const line = lines[i];
					if (regex.test(line)) {
						// Reset lastIndex after test
						regex.lastIndex = 0;
						results.push({
							path: file.path,
							line: i + 1,
							content: line.trim(),
						});
					}
				}
			} catch (error) {
				console.error(
					`[VaultRpcHandler] Error reading file ${file.path}:`,
					error
				);
			}
		}

		return results;
	}

	/**
	 * Find files matching a glob pattern
	 */
	private async vaultGlob(pattern: string): Promise<string[]> {
		const files = this.app.vault.getFiles();
		const regex = this.globToRegex(pattern);
		const matches: string[] = [];

		for (const file of files) {
			if (regex.test(file.path)) {
				matches.push(file.path);
			}
		}

		// Sort alphabetically
		matches.sort((a, b) => a.localeCompare(b));

		return matches;
	}

	/**
	 * Convert a glob pattern to a regex
	 */
	private globToRegex(pattern: string): RegExp {
		// Escape special regex chars except * and ?
		let regexStr = pattern
			.replace(/[.+^${}()|[\]\\]/g, '\\$&')
			.replace(/\*\*/g, '{{GLOBSTAR}}')
			.replace(/\*/g, '[^/]*')
			.replace(/\?/g, '[^/]')
			.replace(/\{\{GLOBSTAR\}\}/g, '.*');

		return new RegExp(`^${regexStr}$`, 'i');
	}

	/**
	 * List files and folders in a directory
	 */
	private async vaultList(folder: string): Promise<FileInfo[]> {
		const items: FileInfo[] = [];

		// Get folder (root if empty string)
		let targetFolder: TFolder;
		if (folder === '' || folder === '/') {
			targetFolder = this.app.vault.getRoot();
		} else {
			const abstractFile =
				this.app.vault.getAbstractFileByPath(folder);
			if (!abstractFile) {
				throw new Error(`Folder not found: ${folder}`);
			}
			if (!(abstractFile instanceof TFolder)) {
				throw new Error(`Path is not a folder: ${folder}`);
			}
			targetFolder = abstractFile;
		}

		// List children
		for (const child of targetFolder.children) {
			items.push({
				name: child.name,
				path: child.path,
				type: child instanceof TFolder ? 'folder' : 'file',
			});
		}

		// Sort: folders first, then alphabetically
		items.sort((a, b) => {
			if (a.type !== b.type) {
				return a.type === 'folder' ? -1 : 1;
			}
			return a.name.localeCompare(b.name);
		});

		return items;
	}

	/**
	 * Rename or move a file
	 */
	private async vaultRename(
		oldPath: string,
		newPath: string,
		activityId?: string
	): Promise<{ success: boolean }> {
		const file = this.app.vault.getAbstractFileByPath(oldPath);

		if (!file) {
			throw new Error(`File not found: ${oldPath}`);
		}

		// Record snapshot before rename (stores old path for revert)
		if (activityId && file instanceof TFile) {
			try {
				const content = await this.app.vault.read(file);
				// Store with special marker to indicate this is a rename snapshot
				getEditHistory(this.app).recordBefore(oldPath, content, activityId);
			} catch (e) {
				console.warn('[VaultRpcHandler] Failed to record snapshot:', e);
			}
		}

		// Ensure parent folder of new path exists
		const newFolderPath = newPath.substring(0, newPath.lastIndexOf('/'));
		if (newFolderPath) {
			await this.ensureFolderExists(newFolderPath);
		}

		// Rename using Obsidian's fileManager (handles link updates)
		await this.app.fileManager.renameFile(file, newPath);

		new Notice(`Renamed: ${oldPath} → ${newPath}`);

		return { success: true };
	}

	/**
	 * Delete a file (move to trash)
	 */
	private async vaultDelete(
		path: string,
		activityId?: string
	): Promise<{ success: boolean }> {
		const file = this.app.vault.getAbstractFileByPath(path);

		if (!file) {
			throw new Error(`File not found: ${path}`);
		}

		// Record snapshot before delete (for potential restore)
		if (activityId && file instanceof TFile) {
			try {
				const content = await this.app.vault.read(file);
				getEditHistory(this.app).recordBefore(path, content, activityId);
			} catch (e) {
				console.warn('[VaultRpcHandler] Failed to record snapshot:', e);
			}
		}

		// Move to system trash
		await this.app.vault.trash(file, true);

		new Notice(`Deleted: ${path}`);

		return { success: true };
	}

	/**
	 * Ensure a folder path exists, creating parent folders as needed
	 */
	private async ensureFolderExists(path: string): Promise<void> {
		const parts = path.split('/').filter((p) => p.length > 0);
		let currentPath = '';

		for (const part of parts) {
			currentPath = currentPath ? `${currentPath}/${part}` : part;
			const existing =
				this.app.vault.getAbstractFileByPath(currentPath);

			if (!existing) {
				await this.app.vault.createFolder(currentPath);
			} else if (!(existing instanceof TFolder)) {
				throw new Error(
					`Path exists but is not a folder: ${currentPath}`
				);
			}
		}
	}
}
