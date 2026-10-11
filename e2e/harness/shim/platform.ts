// Shim: Platform (from the page's ?platform= and ?profile=), requestUrl over fetch, moment-like helper, misc utils.

export const params = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
export const profileName = params.get('profile') ?? 'ipad-landscape';
const platformParam = params.get('platform') ?? (profileName === 'desktop-sidebar' ? 'desktop' : 'mobile');
const isMobile = platformParam === 'mobile';
const isTablet = isMobile && profileName.startsWith('ipad');

export const Platform = {
  isDesktop: !isMobile,
  isMobile,
  isDesktopApp: !isMobile,
  isMobileApp: isMobile,
  isIosApp: isMobile,
  isAndroidApp: false,
  isPhone: isMobile && !isTablet,
  isTablet,
  isMacOS: !isMobile,
  isWin: false,
  isLinux: false,
  isSafari: isMobile,
  resourcePathPrefix: 'app://local/',
};

export const apiVersion = '1.14.0';

export function requireApiVersion(version: string): boolean {
  const a = apiVersion.split('.').map(Number);
  const b = version.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return true;
}

export interface RequestUrlParam {
  url: string;
  method?: string;
  contentType?: string;
  body?: string | ArrayBuffer;
  headers?: Record<string, string>;
  throw?: boolean;
}

export interface RequestUrlResponse {
  status: number;
  headers: Record<string, string>;
  arrayBuffer: ArrayBuffer;
  json: unknown;
  text: string;
}

/** Obsidian's requestUrl over fetch. Never throws on status when `throw` is false; network failures throw. */
export async function requestUrl(req: RequestUrlParam | string): Promise<RequestUrlResponse> {
  const p: RequestUrlParam = typeof req === 'string' ? { url: req } : req;
  const headers: Record<string, string> = { ...(p.headers ?? {}) };
  if (p.contentType && !Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')) headers['content-type'] = p.contentType;
  const res = await fetch(p.url, { method: p.method ?? 'GET', headers, body: p.body as BodyInit | undefined });
  const buf = await res.arrayBuffer();
  const text = new TextDecoder().decode(buf);
  const h: Record<string, string> = {};
  res.headers.forEach((v, k) => (h[k] = v));
  let json: unknown;
  const out: RequestUrlResponse = {
    status: res.status,
    headers: h,
    arrayBuffer: buf,
    text,
    get json() {
      if (json === undefined && text) {
        try {
          json = JSON.parse(text);
        } catch {
          json = undefined;
        }
      }
      return json;
    },
  };
  if (p.throw !== false && res.status >= 400) {
    const err = new Error(`Request failed, status ${res.status}`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  return out;
}

export async function request(req: RequestUrlParam | string): Promise<string> {
  return (await requestUrl(req)).text;
}

export interface Debouncer<T extends unknown[], V> {
  (...args: T): Debouncer<T, V>;
  cancel(): Debouncer<T, V>;
  run(): V | undefined;
}

export function debounce<T extends unknown[], V>(cb: (...args: T) => V, timeout = 0, resetTimer = false): Debouncer<T, V> {
  let handle: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: T | null = null;
  const fn = ((...args: T) => {
    lastArgs = args;
    if (handle && resetTimer) {
      clearTimeout(handle);
      handle = null;
    }
    if (!handle) {
      handle = setTimeout(() => {
        handle = null;
        if (lastArgs) cb(...lastArgs);
      }, timeout);
    }
    return fn;
  }) as Debouncer<T, V>;
  fn.cancel = () => {
    if (handle) clearTimeout(handle);
    handle = null;
    return fn;
  };
  fn.run = () => {
    fn.cancel();
    return lastArgs ? cb(...lastArgs) : undefined;
  };
  return fn;
}

export function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/|\/$/g, '');
}

export function getLinkpath(linktext: string): string {
  return linktext.split('#')[0]?.split('|')[0] ?? linktext;
}

export function parseLinktext(linktext: string): { path: string; subpath: string } {
  const hash = linktext.indexOf('#');
  return hash < 0 ? { path: linktext, subpath: '' } : { path: linktext.slice(0, hash), subpath: linktext.slice(hash) };
}

export function stripHeading(heading: string): string {
  return heading.replace(/[#[\]|^]/g, '').trim();
}

export function stripHeadingForLink(heading: string): string {
  return stripHeading(heading);
}

export function getAllTags(_cache: unknown): string[] | null {
  return null;
}
export function getFrontMatterInfo(_content: string): { exists: boolean; frontmatter: string; from: number; to: number; contentStart: number } {
  return { exists: false, frontmatter: '', from: 0, to: 0, contentStart: 0 };
}
export function parseFrontMatterAliases(_fm: unknown): string[] | null {
  return null;
}
export function parseFrontMatterEntry(fm: Record<string, unknown> | null, key: string): unknown {
  return fm ? fm[key] : null;
}
export function parseFrontMatterStringArray(_fm: unknown, _key: string): string[] | null {
  return null;
}
export function parseFrontMatterTags(_fm: unknown): string[] | null {
  return null;
}
export function parseYaml(yaml: string): unknown {
  try {
    return JSON.parse(yaml);
  } catch {
    return {};
  }
}
export function stringifyYaml(obj: unknown): string {
  return JSON.stringify(obj, null, 2);
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let s = '';
  for (const b of new Uint8Array(buffer)) s += String.fromCharCode(b);
  return btoa(s);
}
export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}
export function arrayBufferToHex(data: ArrayBuffer): string {
  return Array.from(new Uint8Array(data), (b) => b.toString(16).padStart(2, '0')).join('');
}
export function hexToArrayBuffer(hex: string): ArrayBuffer {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out.buffer;
}
export async function getBlobArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  return blob.arrayBuffer();
}

export const loadMathJax = async (): Promise<void> => {};
export const loadMermaid = async (): Promise<unknown> => ({});
export const loadPdfJs = async (): Promise<unknown> => ({});
export const loadPrism = async (): Promise<unknown> => ({});
export const finishRenderMath = async (): Promise<void> => {};
export function renderMath(source: string, _display: boolean): HTMLElement {
  const el = document.createElement('span');
  el.textContent = source;
  return el;
}
export function getLanguage(): string {
  return 'en';
}

export interface SearchResult {
  score: number;
  matches: [number, number][];
}
function simpleSearch(query: string): (text: string) => SearchResult | null {
  const q = query.toLowerCase();
  return (text: string) => {
    const i = text.toLowerCase().indexOf(q);
    return i < 0 ? null : { score: -i, matches: [[i, i + q.length]] };
  };
}
export const prepareSimpleSearch = simpleSearch;
export const prepareFuzzySearch = simpleSearch;
export function fuzzySearch(q: { query: string }, text: string): SearchResult | null {
  return simpleSearch(q.query)(text);
}
export function prepareQuery(query: string): { query: string } {
  return { query };
}
export function renderResults(el: HTMLElement, text: string, _result: SearchResult, _offset?: number): void {
  el.textContent = text;
}
export function renderMatches(el: HTMLElement | DocumentFragment, text: string, _matches: unknown, _offset?: number): void {
  el.appendChild(document.createTextNode(text));
}
export function sortSearchResults(results: { match: SearchResult }[]): void {
  results.sort((a, b) => b.match.score - a.match.score);
}

export function setTooltip(el: HTMLElement, tooltip: string): void {
  el.setAttribute('aria-label', tooltip);
}
export function displayTooltip(_el: HTMLElement, _content: string | DocumentFragment): void {}

export class Keymap {
  static isModifier(ev: KeyboardEvent | MouseEvent, modifier: string): boolean {
    if (modifier === 'Mod') return ev.metaKey || ev.ctrlKey;
    if (modifier === 'Shift') return ev.shiftKey;
    if (modifier === 'Alt') return ev.altKey;
    if (modifier === 'Ctrl') return ev.ctrlKey;
    if (modifier === 'Meta') return ev.metaKey;
    return false;
  }
  static isModEvent(ev?: Event | null): boolean | string {
    const e = ev as MouseEvent | KeyboardEvent | undefined;
    if (!e) return false;
    if (e.metaKey || e.ctrlKey) return e.altKey ? 'split' : 'tab';
    return false;
  }
}

export class Scope {
  private keys: { modifiers: string[]; key: string; fn: (ev: KeyboardEvent) => unknown }[] = [];
  constructor(_parent?: Scope) {}
  register(modifiers: string[] | null, key: string | null, fn: (ev: KeyboardEvent) => unknown): unknown {
    const h = { modifiers: modifiers ?? [], key: key ?? '', fn };
    this.keys.push(h);
    return h;
  }
  unregister(handler: unknown): void {
    this.keys = this.keys.filter((k) => k !== handler);
  }
  /** Harness helper: dispatch a key event to matching handlers. Returns true when one handled it. */
  handle(ev: KeyboardEvent): boolean {
    for (const k of this.keys) {
      if (k.key && k.key.toLowerCase() !== ev.key.toLowerCase()) continue;
      const wantMod = k.modifiers.includes('Mod');
      if (wantMod !== (ev.metaKey || ev.ctrlKey)) continue;
      if (k.modifiers.includes('Shift') !== ev.shiftKey) continue;
      if (k.fn(ev) !== true) return true;
    }
    return false;
  }
}

const MS = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };

/** A small subset of moment: fromNow, format (a few tokens), valueOf, toDate, isValid, isBefore/isAfter. */
export function moment(input?: number | string | Date): MomentLike {
  const d = input === undefined ? new Date() : input instanceof Date ? input : new Date(input);
  return new MomentLike(d);
}

export class MomentLike {
  constructor(private readonly d: Date) {}
  valueOf(): number {
    return this.d.getTime();
  }
  toDate(): Date {
    return new Date(this.d);
  }
  isValid(): boolean {
    return Number.isFinite(this.d.getTime());
  }
  isBefore(o: MomentLike | Date | number): boolean {
    return this.valueOf() < Number(o.valueOf());
  }
  isAfter(o: MomentLike | Date | number): boolean {
    return this.valueOf() > Number(o.valueOf());
  }
  fromNow(): string {
    const diff = Date.now() - this.d.getTime();
    const abs = Math.abs(diff);
    const suffix = diff >= 0 ? 'ago' : 'from now';
    if (abs < 45 * MS.s) return 'a few seconds ' + suffix;
    if (abs < 90 * MS.s) return 'a minute ' + suffix;
    if (abs < 45 * MS.m) return `${Math.round(abs / MS.m)} minutes ${suffix}`;
    if (abs < 90 * MS.m) return 'an hour ' + suffix;
    if (abs < 22 * MS.h) return `${Math.round(abs / MS.h)} hours ${suffix}`;
    if (abs < 36 * MS.h) return 'a day ' + suffix;
    return `${Math.round(abs / MS.d)} days ${suffix}`;
  }
  format(fmt = 'YYYY-MM-DD'): string {
    const d = this.d;
    const pad = (n: number) => String(n).padStart(2, '0');
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return fmt
      .replace(/YYYY/g, String(d.getFullYear()))
      .replace(/MMM/g, months[d.getMonth()] ?? '')
      .replace(/MM/g, pad(d.getMonth() + 1))
      .replace(/DD/g, pad(d.getDate()))
      .replace(/HH/g, pad(d.getHours()))
      .replace(/mm/g, pad(d.getMinutes()))
      .replace(/ss/g, pad(d.getSeconds()));
  }
}
moment.duration = (ms: number) => ({ asMinutes: () => ms / MS.m, asSeconds: () => ms / MS.s, humanize: () => moment(Date.now() - ms).fromNow().replace(' ago', '') });

// CodeMirror state fields the real module exports; present so imports resolve, never read by the plugin.
export const editorEditorField = {};
export const editorInfoField = {};
export const editorLivePreviewField = {};
export const editorViewField = {};
export const livePreviewState = {};
