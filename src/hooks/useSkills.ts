import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../contexts/app-context';

export interface Skill {
	name: string;
	description: string;
	path: string;
}

export interface SlashCommand {
	name: string;
	description: string;
	path: string;
	argumentHint?: string;
}

/**
 * Parse frontmatter from markdown content
 */
function parseFrontmatter(content: string): { frontmatter: Record<string, string>; body: string } {
	const frontmatter: Record<string, string> = {};
	let body = content;

	if (content.startsWith('---')) {
		const endIndex = content.indexOf('---', 4);
		if (endIndex > 0) {
			const frontmatterStr = content.substring(4, endIndex);
			body = content.substring(endIndex + 3).trim();

			// Simple YAML parsing for common fields
			const lines = frontmatterStr.split('\n');
			for (const line of lines) {
				const match = line.match(/^(\w[\w-]*):\s*(.+)$/);
				if (match) {
					frontmatter[match[1]] = match[2].trim();
				}
			}
		}
	}

	return { frontmatter, body };
}

/**
 * Hook to load and manage skills from .claude/skills/ directory
 * Note: Uses adapter.list() since Obsidian doesn't index dot-folders
 */
export function useSkills() {
	const app = useApp();
	const [skills, setSkills] = useState<Skill[]>([]);
	const [commands, setCommands] = useState<SlashCommand[]>([]);
	const [loading, setLoading] = useState(true);

	const loadSkillsAndCommands = useCallback(async () => {
		setLoading(true);
		const loadedSkills: Skill[] = [];
		const loadedCommands: SlashCommand[] = [];

		// Load skills from .claude/skills/
		try {
			const skillsPath = '.claude/skills';
			const exists = await app.vault.adapter.exists(skillsPath);

			if (exists) {
				const listing = await app.vault.adapter.list(skillsPath);
				const mdFiles = listing.files.filter((f) => f.endsWith('.md'));

				for (const filePath of mdFiles) {
					try {
						const content = await app.vault.adapter.read(filePath);
						const filename = filePath.split('/').pop() || filePath;
						const name = filename.replace(/\.md$/, '');

						const { frontmatter, body } = parseFrontmatter(content);
						let description = frontmatter.description || `Skill: ${name}`;

						// If no description in frontmatter, try first heading
						if (!frontmatter.description) {
							const firstLine = body.split('\n')[0];
							if (firstLine?.startsWith('# ')) {
								description = firstLine.replace('# ', '').trim();
							}
						}

						loadedSkills.push({ name, description, path: filePath });
					} catch (e) {
						console.warn(`Failed to load skill from ${filePath}:`, e);
					}
				}
			}
		} catch (e) {
			console.warn('Failed to load skills:', e);
		}

		// Load slash commands from .claude/commands/
		try {
			const commandsPath = '.claude/commands';
			const exists = await app.vault.adapter.exists(commandsPath);

			if (exists) {
				const listing = await app.vault.adapter.list(commandsPath);
				const mdFiles = listing.files.filter((f) => f.endsWith('.md'));

				for (const filePath of mdFiles) {
					try {
						const content = await app.vault.adapter.read(filePath);
						const filename = filePath.split('/').pop() || filePath;
						const name = filename.replace(/\.md$/, '');

						const { frontmatter, body } = parseFrontmatter(content);
						let description = frontmatter.description || `Command: ${name}`;
						const argumentHint = frontmatter['argument-hint'];

						// If no description in frontmatter, use first line of body
						if (!frontmatter.description) {
							const firstLine = body.split('\n')[0]?.trim();
							if (firstLine && !firstLine.startsWith('#')) {
								description = firstLine.substring(0, 60) + (firstLine.length > 60 ? '...' : '');
							}
						}

						loadedCommands.push({ name, description, path: filePath, argumentHint });
					} catch (e) {
						console.warn(`Failed to load command from ${filePath}:`, e);
					}
				}
			}
		} catch (e) {
			console.warn('Failed to load commands:', e);
		}

		setSkills(loadedSkills);
		setCommands(loadedCommands);
		setLoading(false);
	}, [app]);

	// Load skills and commands on mount
	// Note: File watchers won't work for dot-folders, so we just load on mount
	// Users can refresh by restarting the plugin or calling refresh()
	useEffect(() => {
		loadSkillsAndCommands();
	}, [loadSkillsAndCommands]);

	const searchSkills = useCallback(
		(query: string): Skill[] => {
			const lowerQuery = query.toLowerCase();
			return skills.filter(
				(skill) =>
					skill.name.toLowerCase().includes(lowerQuery) ||
					skill.description.toLowerCase().includes(lowerQuery)
			);
		},
		[skills]
	);

	const searchCommands = useCallback(
		(query: string): SlashCommand[] => {
			const lowerQuery = query.toLowerCase();
			return commands.filter(
				(cmd) =>
					cmd.name.toLowerCase().includes(lowerQuery) ||
					cmd.description.toLowerCase().includes(lowerQuery)
			);
		},
		[commands]
	);

	return {
		skills,
		commands,
		loading,
		searchSkills,
		searchCommands,
		refresh: loadSkillsAndCommands,
	};
}
