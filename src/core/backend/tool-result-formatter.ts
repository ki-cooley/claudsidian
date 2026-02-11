/**
 * Formats tool results for the UI
 *
 * Design goals:
 * - Collapsed by default with summary counts
 * - Clickable file links via wikilinks
 * - Minimal clutter for search/read operations
 * - Clear display for write/edit operations
 */

// Track edits for batching (static to persist across calls)
const recentEdits: Map<string, { count: number; lastTime: number }> = new Map();
const EDIT_BATCH_WINDOW_MS = 5000; // Batch edits within 5 seconds

/**
 * Structured result from parsing tool output
 */
export interface ParsedToolResult {
	isError: boolean;
	filePath?: string;
	oldPath?: string;
	newPath?: string;
	resultCount?: number;
	results?: string[];
	diff?: {
		additions: number;
		deletions: number;
		oldContent?: string;
		newContent?: string;
	};
}

/**
 * Parse tool result into structured data for ActivityEvent
 */
export function parseToolResult(
	toolName: string,
	result: string,
	toolArguments: string
): ParsedToolResult {
	const parsed: ParsedToolResult = {
		isError: result.startsWith('Error:') || result.includes('failed'),
	};

	try {
		const args = JSON.parse(toolArguments);

		if (toolName === 'vault_read') {
			parsed.filePath = args.path;
		} else if (toolName === 'vault_write') {
			parsed.filePath = args.path;
			// Count lines in content for diff stats
			const content = args.content || '';
			const lines = content.split('\n').length;
			parsed.diff = {
				additions: lines,
				deletions: 0,
				newContent: content,
			};
		} else if (toolName === 'vault_edit') {
			parsed.filePath = args.path;
			// Calculate diff from old/new strings
			const oldStr = args.old_string || '';
			const newStr = args.new_string || '';
			const oldLines = oldStr ? oldStr.split('\n').length : 0;
			const newLines = newStr ? newStr.split('\n').length : 0;
			parsed.diff = {
				additions: newLines,
				deletions: oldLines,
				oldContent: oldStr,
				newContent: newStr,
			};
		} else if (toolName === 'vault_rename') {
			parsed.oldPath = args.old_path;
			parsed.newPath = args.new_path;
			parsed.filePath = args.new_path;
		} else if (toolName === 'vault_delete') {
			parsed.filePath = args.path;
		} else if (toolName === 'vault_search') {
			const lines = result.split('\n');
			const fileRefs: string[] = [];
			for (const line of lines) {
				const match = line.match(/^-\s*(.+\.\w+):\s/);
				if (match) {
					fileRefs.push(match[1].trim());
				}
			}
			parsed.resultCount = fileRefs.length;
			parsed.results = fileRefs;
		} else if (toolName === 'vault_grep') {
			const lines = result.split('\n');
			const fileRefs: string[] = [];
			const seenFiles = new Set<string>();
			for (const line of lines) {
				const match = line.match(/^(.+\.\w+):(\d+):/);
				if (match && !seenFiles.has(match[1])) {
					seenFiles.add(match[1]);
					fileRefs.push(match[1].trim());
				}
			}
			parsed.resultCount = fileRefs.length;
			parsed.results = fileRefs;
		} else if (toolName === 'vault_glob') {
			const lines = result.split('\n');
			const fileRefs: string[] = [];
			for (const line of lines) {
				const match = line.match(/^-\s*(.+\.\w+)$/);
				if (match) {
					fileRefs.push(match[1].trim());
				}
			}
			parsed.resultCount = fileRefs.length;
			parsed.results = fileRefs;
		} else if (toolName === 'vault_list') {
			const lines = result.split('\n');
			let count = 0;
			for (const line of lines) {
				if (line.trim().startsWith('- ')) {
					count++;
				}
			}
			parsed.resultCount = count;
		} else if (toolName === 'web_search') {
			// Extract URLs from web search results
			const urlMatches = result.match(/https?:\/\/[^\s)]+/g);
			if (urlMatches) {
				parsed.resultCount = urlMatches.length;
				parsed.results = urlMatches;
			}
		}
	} catch {
		// If argument parsing fails, just return basic result
	}

	return parsed;
}

/**
 * Format a collapsible file list with count summary
 */
function formatCollapsibleList(
	title: string,
	_icon: string, // Unused, kept for backwards compatibility
	fileRefs: string[],
	maxVisible: number = 3
): string {
	if (fileRefs.length === 0) return '';

	const count = fileRefs.length;

	// If few files, just show them inline
	if (count <= maxVisible) {
		return `\n**${title}:** ${fileRefs.join(', ')}`;
	}

	// For many files, show count with expandable list
	const visibleRefs = fileRefs.slice(0, maxVisible);
	const hiddenCount = count - maxVisible;

	return `\n**${title}:** ${visibleRefs.join(', ')} *+${hiddenCount} more*`;
}

export function formatToolResult(
	toolName: string,
	result: string,
	toolArguments: string
): string {
	let formattedResult = '';

	if (toolName === 'vault_search') {
		const lines = result.split('\n');
		const fileRefs: string[] = [];

		for (const line of lines) {
			const match = line.match(/^-\s*(.+\.\w+):\s/);
			if (match) {
				const filepath = match[1].trim();
				const displayName = filepath.split('/').pop() || filepath;
				fileRefs.push(`[[${filepath}|${displayName}]]`);
			}
		}

		formattedResult = formatCollapsibleList('Found', '', fileRefs);
	} else if (toolName === 'vault_list') {
		const lines = result.split('\n');
		const folders: string[] = [];
		const files: string[] = [];

		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed.startsWith('- ')) continue;

			// Handle both emoji and non-emoji formats
			if (trimmed.includes('[folder]') || trimmed.includes('folder:')) {
				const name = trimmed.replace(/^-\s*(\[folder\]|folder:)?\s*/, '').trim();
				folders.push(name);
			} else if (trimmed.includes('[file]') || trimmed.includes('file:')) {
				const name = trimmed.replace(/^-\s*(\[file\]|file:)?\s*/, '').trim();
				files.push(`[[${name}]]`);
			} else {
				// Fallback: treat as file if has extension, folder otherwise
				const name = trimmed.replace(/^-\s*/, '').trim();
				if (name.includes('.')) {
					files.push(`[[${name}]]`);
				} else {
					folders.push(name);
				}
			}
		}

		const total = folders.length + files.length;
		if (total > 0) {
			const parts: string[] = [];
			if (folders.length > 0) parts.push(`${folders.length} folders`);
			if (files.length > 0) parts.push(`${files.length} files`);
			formattedResult = `\n**Listed:** ${parts.join(', ')}`;
		}
	} else if (toolName === 'vault_read') {
		try {
			const args = JSON.parse(toolArguments);
			if (args.path) {
				const displayName = args.path.split('/').pop() || args.path;
				formattedResult = `\n**Read:** [[${args.path}|${displayName}]]`;
			}
		} catch (e) {
			// Silently ignore parse errors
		}
	} else if (toolName === 'vault_write') {
		try {
			const args = JSON.parse(toolArguments);
			if (args.path) {
				const displayName = args.path.split('/').pop() || args.path;
				formattedResult = `\n**Created:** [[${args.path}|${displayName}]]`;
			}
		} catch (e) {
			// Silently ignore parse errors
		}
	} else if (toolName === 'vault_edit') {
		try {
			const args = JSON.parse(toolArguments);
			if (args.path) {
				const displayName = args.path.split('/').pop() || args.path;
				const now = Date.now();

				// Check if we have a recent edit to this same file
				const existingEdit = recentEdits.get(args.path);
				if (existingEdit && (now - existingEdit.lastTime) < EDIT_BATCH_WINDOW_MS) {
					// Update the count but don't emit another message
					existingEdit.count++;
					existingEdit.lastTime = now;
					// Return empty to suppress duplicate messages
					return '';
				}

				// New edit or first in a batch
				recentEdits.set(args.path, { count: 1, lastTime: now });

				// Clean up old entries
				for (const [path, edit] of recentEdits) {
					if (now - edit.lastTime > EDIT_BATCH_WINDOW_MS * 2) {
						recentEdits.delete(path);
					}
				}

				formattedResult = `\n**Edited:** [[${args.path}|${displayName}]]`;
			}
		} catch (e) {
			// Silently ignore parse errors
		}
	} else if (toolName === 'vault_grep') {
		const lines = result.split('\n');
		const fileRefs: string[] = [];
		const seenFiles = new Set<string>();

		for (const line of lines) {
			const match = line.match(/^(.+\.\w+):(\d+):/);
			if (match) {
				const filepath = match[1].trim();
				if (!seenFiles.has(filepath)) {
					seenFiles.add(filepath);
					const displayName = filepath.split('/').pop() || filepath;
					fileRefs.push(`[[${filepath}|${displayName}]]`);
				}
			}
		}

		formattedResult = formatCollapsibleList('Grep matches', '', fileRefs);
	} else if (toolName === 'vault_glob') {
		const lines = result.split('\n');
		const fileRefs: string[] = [];

		for (const line of lines) {
			const match = line.match(/^-\s*(.+\.\w+)$/);
			if (match) {
				const filepath = match[1].trim();
				const displayName = filepath.split('/').pop() || filepath;
				fileRefs.push(`[[${filepath}|${displayName}]]`);
			}
		}

		formattedResult = formatCollapsibleList('Found files', '', fileRefs);
	} else if (toolName === 'vault_rename') {
		try {
			const args = JSON.parse(toolArguments);
			if (args.old_path && args.new_path) {
				const newDisplayName = args.new_path.split('/').pop() || args.new_path;
				formattedResult = `\n**Renamed:** -> [[${args.new_path}|${newDisplayName}]]`;
			}
		} catch (e) {
			// Silently ignore parse errors
		}
	}

	return formattedResult;
}
