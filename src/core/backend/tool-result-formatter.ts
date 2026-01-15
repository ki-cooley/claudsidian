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
 * Format a collapsible file list with count summary
 */
function formatCollapsibleList(
	title: string,
	icon: string,
	fileRefs: string[],
	maxVisible: number = 3
): string {
	if (fileRefs.length === 0) return '';

	const count = fileRefs.length;

	// If few files, just show them inline
	if (count <= maxVisible) {
		return `\n${icon} **${title}:** ${fileRefs.join(', ')}`;
	}

	// For many files, show count with expandable list
	const visibleRefs = fileRefs.slice(0, maxVisible);
	const hiddenCount = count - maxVisible;

	return `\n${icon} **${title}:** ${visibleRefs.join(', ')} *+${hiddenCount} more*`;
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

		formattedResult = formatCollapsibleList('Found', '🔍', fileRefs);
	} else if (toolName === 'vault_list') {
		const lines = result.split('\n');
		const folders: string[] = [];
		const files: string[] = [];

		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed.startsWith('- ')) continue;

			if (trimmed.includes('📁')) {
				const name = trimmed.replace(/^-\s*📁\s*/, '').trim();
				folders.push(name);
			} else if (trimmed.includes('📄')) {
				const name = trimmed.replace(/^-\s*📄\s*/, '').trim();
				files.push(`[[${name}]]`);
			}
		}

		const total = folders.length + files.length;
		if (total > 0) {
			const parts: string[] = [];
			if (folders.length > 0) parts.push(`${folders.length} folders`);
			if (files.length > 0) parts.push(`${files.length} files`);
			formattedResult = `\n📂 **Listed:** ${parts.join(', ')}`;
		}
	} else if (toolName === 'vault_read') {
		try {
			const args = JSON.parse(toolArguments);
			if (args.path) {
				const displayName = args.path.split('/').pop() || args.path;
				formattedResult = `\n📖 **Read:** [[${args.path}|${displayName}]]`;
			}
		} catch (e) {
			// Silently ignore parse errors
		}
	} else if (toolName === 'vault_write') {
		try {
			const args = JSON.parse(toolArguments);
			if (args.path) {
				const displayName = args.path.split('/').pop() || args.path;
				formattedResult = `\n✍️ **Created:** [[${args.path}|${displayName}]]`;
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

				formattedResult = `\n✏️ **Edited:** [[${args.path}|${displayName}]]`;
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

		formattedResult = formatCollapsibleList('Grep matches', '🔎', fileRefs);
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

		formattedResult = formatCollapsibleList('Found files', '📁', fileRefs);
	} else if (toolName === 'vault_rename') {
		try {
			const args = JSON.parse(toolArguments);
			if (args.old_path && args.new_path) {
				const newDisplayName = args.new_path.split('/').pop() || args.new_path;
				formattedResult = `\n📝 **Renamed:** → [[${args.new_path}|${newDisplayName}]]`;
			}
		} catch (e) {
			// Silently ignore parse errors
		}
	}

	return formattedResult;
}
