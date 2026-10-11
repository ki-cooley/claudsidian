// Shim: vault files (TFile, TFolder), an in-memory Vault with three markdown notes, MetadataCache, FileManager.
import { Events } from './events';

export const VAULT_NAME = 'yes-chef';
export const VAULT_BASE_PATH = '/Users/kicooley-winters/workspace/projects/yes-chef';

export const SEED_NOTES: Record<string, string> = {
  'menus/latitude 10/menu.md': [
    '# Latitude 10',
    '',
    'Eight courses, October service.',
    '',
    '1. Amuse: chawanmushi, dashi, chive oil',
    '2. Crudo: fluke, yuzu kosho, shiso',
    '3. Bread: milk bread, cultured butter',
    '4. Fish: black bass, beurre blanc, kombu',
    '5. Meat: duck, cherry, black garlic',
    '6. Pre-dessert: pear sorbet',
    '7. Dessert: miso caramel, sesame',
    '8. Mignardises',
    '',
    'Open questions: pairing for the duck, timing on the chawanmushi.',
    '',
  ].join('\n'),
  'components/dashi.md': ['# Dashi', '', 'Kombu 60 C for one hour, then katsuobushi off heat for two minutes.', ''].join('\n'),
  'techniques/kombu-cure.md': ['# Kombu cure', '', 'Sandwich the fish between sheets of rehydrated kombu for four hours.', ''].join('\n'),
};

export class TAbstractFile {
  path = '';
  name = '';
  parent: TFolder | null = null;
  vault!: Vault;
}

export class TFile extends TAbstractFile {
  basename = '';
  extension = 'md';
  stat = { ctime: Date.now(), mtime: Date.now(), size: 0 };

  constructor(path = '') {
    super();
    this.setPath(path);
  }

  setPath(path: string): void {
    this.path = path;
    this.name = path.split('/').pop() ?? path;
    const dot = this.name.lastIndexOf('.');
    this.basename = dot > 0 ? this.name.slice(0, dot) : this.name;
    this.extension = dot > 0 ? this.name.slice(dot + 1) : '';
  }
}

export class TFolder extends TAbstractFile {
  children: TAbstractFile[] = [];
  constructor(path = '') {
    super();
    this.path = path;
    this.name = path.split('/').pop() ?? path;
  }
  isRoot(): boolean {
    return this.path === '' || this.path === '/';
  }
}

export class Vault extends Events {
  private files = new Map<string, { file: TFile; content: string }>();
  private root = new TFolder('');
  configDir = '.obsidian';
  adapter = {
    basePath: VAULT_BASE_PATH,
    getName: () => VAULT_NAME,
    getBasePath: () => VAULT_BASE_PATH,
    exists: async (p: string) => this.files.has(p),
    read: async (p: string) => this.files.get(p)?.content ?? '',
    write: async (p: string, data: string) => {
      await this.createOrModify(p, data);
    },
  };

  constructor(seed: Record<string, string> = SEED_NOTES) {
    super();
    for (const [path, content] of Object.entries(seed)) this.addFile(path, content);
  }

  private addFile(path: string, content: string): TFile {
    const file = new TFile(path);
    file.vault = this;
    file.parent = this.root;
    file.stat.size = content.length;
    this.files.set(path, { file, content });
    return file;
  }

  getName(): string {
    return VAULT_NAME;
  }

  getRoot(): TFolder {
    return this.root;
  }

  getFiles(): TFile[] {
    return [...this.files.values()].map((e) => e.file);
  }

  getAllLoadedFiles(): TAbstractFile[] {
    return [this.root, ...this.getFiles()];
  }

  getMarkdownFiles(): TFile[] {
    return this.getFiles().filter((f) => f.extension === 'md');
  }

  getAbstractFileByPath(path: string): TAbstractFile | null {
    return this.files.get(path)?.file ?? null;
  }

  getFileByPath(path: string): TFile | null {
    return this.files.get(path)?.file ?? null;
  }

  getFolderByPath(path: string): TFolder | null {
    return path === '' || path === '/' ? this.root : null;
  }

  async read(file: TFile): Promise<string> {
    return this.files.get(file.path)?.content ?? '';
  }

  async cachedRead(file: TFile): Promise<string> {
    return this.read(file);
  }

  async create(path: string, data: string): Promise<TFile> {
    if (this.files.has(path)) throw new Error(`File already exists: ${path}`);
    const file = this.addFile(path, data);
    this.trigger('create', file);
    return file;
  }

  async modify(file: TFile, data: string): Promise<void> {
    const entry = this.files.get(file.path);
    if (!entry) throw new Error(`No such file: ${file.path}`);
    entry.content = data;
    entry.file.stat.mtime = Date.now();
    entry.file.stat.size = data.length;
    this.trigger('modify', file);
  }

  async process(file: TFile, fn: (data: string) => string): Promise<string> {
    const next = fn(await this.read(file));
    await this.modify(file, next);
    return next;
  }

  async append(file: TFile, data: string): Promise<void> {
    await this.modify(file, (await this.read(file)) + data);
  }

  async delete(file: TAbstractFile): Promise<void> {
    this.files.delete(file.path);
    this.trigger('delete', file);
  }

  async trash(file: TAbstractFile): Promise<void> {
    await this.delete(file);
  }

  async rename(file: TAbstractFile, newPath: string): Promise<void> {
    const entry = this.files.get(file.path);
    if (!entry) return;
    const oldPath = file.path;
    this.files.delete(oldPath);
    entry.file.setPath(newPath);
    this.files.set(newPath, entry);
    this.trigger('rename', file, oldPath);
  }

  async createFolder(path: string): Promise<TFolder> {
    return new TFolder(path);
  }

  private async createOrModify(path: string, data: string): Promise<void> {
    const existing = this.files.get(path);
    if (existing) await this.modify(existing.file, data);
    else await this.create(path, data);
  }

  /** Harness helper: content of a path (sync). */
  contentOf(path: string): string | undefined {
    return this.files.get(path)?.content;
  }
}

export class MetadataCache extends Events {
  resolvedLinks: Record<string, Record<string, number>> = {};
  unresolvedLinks: Record<string, Record<string, number>> = {};
  constructor(private readonly vault: Vault) {
    super();
  }
  getFileCache(_file: TFile): Record<string, unknown> | null {
    return {};
  }
  getCache(_path: string): Record<string, unknown> | null {
    return {};
  }
  getFirstLinkpathDest(linkpath: string, _sourcePath: string): TFile | null {
    const direct = this.vault.getFileByPath(linkpath) ?? this.vault.getFileByPath(`${linkpath}.md`);
    if (direct) return direct;
    const base = linkpath.split('/').pop() ?? linkpath;
    return this.vault.getMarkdownFiles().find((f) => f.basename === base) ?? null;
  }
  fileToLinktext(file: TFile, _sourcePath: string, omitMdExtension = true): string {
    return omitMdExtension && file.extension === 'md' ? file.path.slice(0, -3) : file.path;
  }
}

export class FileManager {
  constructor(private readonly vault: Vault) {}
  getNewFileParent(_sourcePath: string): TFolder {
    return this.vault.getRoot();
  }
  async renameFile(file: TAbstractFile, newPath: string): Promise<void> {
    await this.vault.rename(file, newPath);
  }
  async trashFile(file: TAbstractFile): Promise<void> {
    await this.vault.trash(file);
  }
  generateMarkdownLink(file: TFile, _sourcePath: string, subpath = '', alias = ''): string {
    const target = file.extension === 'md' ? file.path.slice(0, -3) : file.path;
    return `[[${target}${subpath}${alias ? `|${alias}` : ''}]]`;
  }
  async processFrontMatter(_file: TFile, fn: (fm: Record<string, unknown>) => void): Promise<void> {
    fn({});
  }
}
