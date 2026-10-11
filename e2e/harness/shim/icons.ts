// Shim: setIcon/getIcon. Inserts a data-icon attribute and a small inline glyph so icon buttons have a visible shape.

const PATHS: Record<string, string> = {
  bot: 'M12 8V4H8 M4 8h16v12H4z M9 14h.01 M15 14h.01',
  send: 'M22 2 11 13 M22 2 15 22l-4-9-9-4z',
  'send-horizontal': 'M3 3l18 9-18 9 4-9z',
  x: 'M18 6 6 18 M6 6l12 12',
  'chevron-left': 'M15 18l-6-6 6-6',
  'chevron-right': 'M9 18l6-6-6-6',
  'chevron-down': 'M6 9l6 6 6-6',
  'chevron-up': 'M18 15l-6-6-6 6',
  'arrow-left': 'M19 12H5 M12 19l-7-7 7-7',
  'arrow-down': 'M12 5v14 M19 12l-7 7-7-7',
  plus: 'M12 5v14 M5 12h14',
  'more-horizontal': 'M5 12h.01 M12 12h.01 M19 12h.01',
  'more-vertical': 'M12 5h.01 M12 12h.01 M12 19h.01',
  'refresh-cw': 'M21 12a9 9 0 1 1-3-6.7L21 8 M21 3v5h-5',
  check: 'M20 6 9 17l-5-5',
  square: 'M4 4h16v16H4z',
  paperclip: 'M21 11.5l-9 9a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5',
  image: 'M3 5h18v14H3z M8 11a1 1 0 1 0 0-2 1 1 0 0 0 0 2 M21 15l-5-5L5 21',
  copy: 'M9 9h11v11H9z M5 15H4V4h11v1',
  pencil: 'M17 3l4 4L7 21H3v-4z',
  'file-plus': 'M14 2H6v20h12V8z M14 2v6h6 M12 12v6 M9 15h6',
  'file-text': 'M14 2H6v20h12V8z M14 2v6h6 M8 13h8 M8 17h8',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6 M19 12l2 1-1 3-2-.3-1.4 1.4.3 2-3 1-1-2h-2l-1 2-3-1 .3-2L5.8 15.7 3.8 16l-1-3 2-1v-2l-2-1 1-3 2 .3L7 4.9 6.7 2.9 9.7 1.9l1 2h2l1-2 3 1-.3 2 1.4 1.4 2-.3 1 3-2 1z',
  terminal: 'M4 17l6-6-6-6 M12 19h8',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16 M21 21l-4.3-4.3',
  'message-square': 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  brain: 'M9 3a3 3 0 0 0-3 3v12a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3 M15 3a3 3 0 0 1 3 3v12a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3',
  wrench: 'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-7 7a2 2 0 0 1-3-3l7-7a6 6 0 0 1 7.9-7.9z',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18 M3 12h18 M12 3a14 14 0 0 1 0 18 M12 3a14 14 0 0 0 0 18',
  'alert-triangle': 'M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z M12 9v4 M12 17h.01',
  'alert-circle': 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18 M12 8v4 M12 16h.01',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18 M12 16v-4 M12 8h.01',
  'wifi-off': 'M2 2l20 20 M5 12.5a11 11 0 0 1 4-2.5 M12 20h.01',
  loader: 'M12 2v4 M12 18v4 M4.9 4.9l2.8 2.8 M16.2 16.2l2.8 2.8 M2 12h4 M18 12h4 M4.9 19.1l2.8-2.8 M16.2 7.8l2.8-2.8',
  'chef-hat': 'M6 13.9A4 4 0 0 1 7 6a5 5 0 0 1 10 0 4 4 0 0 1 1 7.9V21H6z M6 17h12',
  'external-link': 'M18 13v6H5V6h6 M15 3h6v6 M10 14 21 3',
  trash: 'M3 6h18 M8 6V4h8v2 M6 6l1 14h10l1-14',
  archive: 'M3 4h18v4H3z M5 8v12h14V8 M10 12h4',
  'corner-down-left': 'M20 4v7a4 4 0 0 1-4 4H4 M9 10l-5 5 5 5',
  'zap': 'M13 2 3 14h9l-1 8 10-12h-9z',
  'eye': 'M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6',
  'eye-off': 'M2 2l20 20 M9.9 4.2A10 10 0 0 1 22 12s-1 2-3 4 M6.6 6.6C3 9 2 12 2 12s3 7 10 7a9.7 9.7 0 0 0 4-.8',
  menu: 'M4 6h16 M4 12h16 M4 18h16',
  'list': 'M8 6h13 M8 12h13 M8 18h13 M3 6h.01 M3 12h.01 M3 18h.01',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18 M12 7v5l3 2',
  'circle': 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18',
  'check-circle': 'M22 11.1V12a10 10 0 1 1-5.9-9.1 M22 4 12 14l-3-3',
  'x-circle': 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18 M15 9l-6 6 M9 9l6 6',
  'help-circle': 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18 M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2-3 4 M12 17h.01',
  'shield': 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  'shield-check': 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z M9 12l2 2 4-4',
  'sliders-horizontal': 'M21 4h-7 M10 4H3 M21 12h-9 M8 12H3 M21 20h-5 M12 20H3 M14 2v4 M8 10v4 M16 18v4',
  'log-in': 'M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4 M10 17l5-5-5-5 M15 12H3',
  'log-out': 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4 M16 17l5-5-5-5 M21 12H9',
  'folder': 'M3 7h6l2 2h10v11H3z',
  'cloud': 'M17.5 19a4.5 4.5 0 0 0 .5-9 7 7 0 0 0-13.5 2A4 4 0 0 0 6 19z',
  'laptop': 'M4 5h16v11H4z M2 19h20',
  'play': 'M6 4l14 8-14 8z',
  'pause': 'M8 5h3v14H8z M13 5h3v14h-3z',
  'octagon-x': 'M7.9 2h8.2L22 7.9v8.2L16.1 22H7.9L2 16.1V7.9z M15 9l-6 6 M9 9l6 6',
};

const registered = new Map<string, string>();

export function addIcon(iconId: string, svgContent: string): void {
  registered.set(iconId, svgContent);
}

export function removeIcon(iconId: string): void {
  registered.delete(iconId);
}

export function getIconIds(): string[] {
  return [...Object.keys(PATHS), ...registered.keys()];
}

export function getIcon(iconId: string): SVGSVGElement | null {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '24');
  svg.setAttribute('height', '24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.classList.add('svg-icon', `lucide-${iconId}`);
  const custom = registered.get(iconId);
  if (custom) {
    svg.innerHTML = custom;
    return svg;
  }
  const d = PATHS[iconId] ?? PATHS['circle']!;
  for (const segment of d.split(' M').map((s, i) => (i === 0 ? s : `M${s}`))) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', segment);
    svg.appendChild(path);
  }
  return svg;
}

export function setIcon(parent: HTMLElement, iconId: string): void {
  parent.setAttribute('data-icon', iconId);
  parent.querySelectorAll(':scope > svg.svg-icon').forEach((n) => n.remove());
  const svg = getIcon(iconId);
  if (svg) parent.appendChild(svg);
}
