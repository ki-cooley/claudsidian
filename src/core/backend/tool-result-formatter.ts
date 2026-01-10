/**
 * Formats tool results as clickable file references for the UI
 * Uses Obsidian wikilink format [[filename]] for inline clickable links
 */

export function formatToolResult(
	toolName: string,
	result: string,
	toolArguments: string
): string {
	let formattedResult = '';

	if (toolName === 'vault_search') {
		// vault_search format: "- path/to/file.md: ...snippet..."
		// Only extract actual file paths (must end with .md or other extension before the colon)
		const lines = result.split('\n');
		const fileRefs: string[] = [];

		for (const line of lines) {
			// Match lines like "- path/to/file.md: snippet text"
			// Path can contain spaces, must end with an extension before the colon
			// Format is: "- filepath.ext: content"
			const match = line.match(/^-\s*(.+\.\w+):\s/);
			if (match) {
				const filepath = match[1].trim();
				const displayName = filepath.split('/').pop() || filepath;
				fileRefs.push(`[[${filepath}|${displayName}]]`);
			}
		}

		if (fileRefs.length > 0) {
			formattedResult = '\n**Found files:**\n' + fileRefs.map(ref => `- ${ref}`).join('\n');
		}
	} else if (toolName === 'vault_list') {
		// vault_list format: "- 📁 folder-name" or "- 📄 file-name.md"
		const lines = result.split('\n');
		const fileRefs: string[] = [];

		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed.startsWith('- ')) continue;

			// Check for folder (📁)
			if (trimmed.includes('📁')) {
				const name = trimmed.replace(/^-\s*📁\s*/, '').trim();
				fileRefs.push(`📁 ${name}`);
			}
			// Check for file (📄)
			else if (trimmed.includes('📄')) {
				const name = trimmed.replace(/^-\s*📄\s*/, '').trim();
				fileRefs.push(`[[${name}]]`);
			}
		}

		if (fileRefs.length > 0) {
			formattedResult = '\n**Contents:**\n' + fileRefs.map(ref => `- ${ref}`).join('\n');
		}
	} else if (toolName === 'vault_read') {
		// For vault_read, show the filename as a link
		try {
			const args = JSON.parse(toolArguments);
			if (args.path) {
				const displayName = args.path.split('/').pop() || args.path;
				formattedResult = `\n📖 Read: [[${args.path}|${displayName}]]`;
			}
		} catch (e) {
			// Silently ignore parse errors
		}
	} else if (toolName === 'vault_write') {
		// For vault_write, show the written file
		try {
			const args = JSON.parse(toolArguments);
			if (args.path) {
				const displayName = args.path.split('/').pop() || args.path;
				formattedResult = `\n✍️ Wrote: [[${args.path}|${displayName}]]`;
			}
		} catch (e) {
			// Silently ignore parse errors
		}
	} else if (toolName === 'vault_edit') {
		// For vault_edit, show the edited file
		try {
			const args = JSON.parse(toolArguments);
			if (args.path) {
				const displayName = args.path.split('/').pop() || args.path;
				formattedResult = `\n✏️ Edited: [[${args.path}|${displayName}]]`;
			}
		} catch (e) {
			// Silently ignore parse errors
		}
	} else if (toolName === 'vault_grep') {
		// vault_grep format: "path/to/file.md:123: matching line content"
		const lines = result.split('\n');
		const fileRefs: string[] = [];
		const seenFiles = new Set<string>();

		for (const line of lines) {
			// Match lines like "path/to/file.md:42: content"
			const match = line.match(/^(.+\.\w+):(\d+):/);
			if (match) {
				const filepath = match[1].trim();
				const lineNum = match[2];
				// Only show each file once
				if (!seenFiles.has(filepath)) {
					seenFiles.add(filepath);
					const displayName = filepath.split('/').pop() || filepath;
					fileRefs.push(`[[${filepath}|${displayName}]] (line ${lineNum})`);
				}
			}
		}

		if (fileRefs.length > 0) {
			formattedResult = '\n**Matches in:**\n' + fileRefs.map(ref => `- ${ref}`).join('\n');
		}
	} else if (toolName === 'vault_glob') {
		// vault_glob format: "- path/to/file.md"
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

		if (fileRefs.length > 0) {
			formattedResult = '\n**Matched files:**\n' + fileRefs.map(ref => `- ${ref}`).join('\n');
		}
	} else if (toolName === 'vault_rename') {
		// For vault_rename, show both old and new paths
		try {
			const args = JSON.parse(toolArguments);
			if (args.old_path && args.new_path) {
				const newDisplayName = args.new_path.split('/').pop() || args.new_path;
				formattedResult = `\n📝 Renamed → [[${args.new_path}|${newDisplayName}]]`;
			}
		} catch (e) {
			// Silently ignore parse errors
		}
	}

	return formattedResult;
}
