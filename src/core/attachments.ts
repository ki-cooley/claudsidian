/**
 * Image attachments: decode, downscale, re-encode on a canvas, and turn the result into the
 * base64 image blocks a user message carries. Browser APIs only; it runs in the iOS WebView.
 */
import type { ImageBlock } from '../api/types';
import type { OutgoingAttachment } from './types';

export interface PrepareImageOptions {
  /** longest side after scaling, in px (Claude's vision sweet spot) */
  maxEdge?: number;
  /** jpeg quality 0..1 */
  quality?: number;
}

const DEFAULT_MAX_EDGE = 1568;
const DEFAULT_QUALITY = 0.85;
/** a scaled png at or above this size is re-encoded as jpeg */
const PNG_KEEP_BYTES = 1024 * 1024;
const BASE64_CHUNK = 0x8000;

interface Decoded {
  source: CanvasImageSource;
  width: number;
  height: number;
  release(): void;
}

async function decode(file: Blob): Promise<Decoded> {
  const cib = (globalThis as { createImageBitmap?: typeof createImageBitmap }).createImageBitmap;
  if (typeof cib === 'function') {
    const bitmap = await cib(file);
    return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close?.() };
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Could not decode image'));
      el.src = url;
    });
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, release: () => {} };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function fit(width: number, height: number, maxEdge: number): { width: number; height: number } {
  const long = Math.max(width, height);
  if (long <= maxEdge || long === 0) return { width, height };
  const scale = maxEdge / long;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error(`Could not encode image as ${type}`));
      },
      type,
      quality,
    );
  });
}

/** Decode, scale so the long edge is at most maxEdge, and re-encode as jpeg (png kept when small). */
export async function prepareImage(
  file: Blob & { name?: string },
  opts: PrepareImageOptions = {},
): Promise<OutgoingAttachment> {
  const maxEdge = opts.maxEdge ?? DEFAULT_MAX_EDGE;
  const quality = opts.quality ?? DEFAULT_QUALITY;
  const decoded = await decode(file);
  try {
    const { width, height } = fit(decoded.width, decoded.height, maxEdge);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not encode image: canvas unavailable');
    ctx.drawImage(decoded.source, 0, 0, width, height);

    let blob: Blob | null = null;
    if (file.type === 'image/png') {
      const png = await canvasToBlob(canvas, 'image/png');
      if (png.size < PNG_KEEP_BYTES) blob = png;
    }
    if (!blob) blob = await canvasToBlob(canvas, 'image/jpeg', quality);
    const mediaType = blob.type || (file.type === 'image/png' && blob.size < PNG_KEEP_BYTES ? 'image/png' : 'image/jpeg');

    return {
      kind: 'image',
      name: file.name || 'image',
      mediaType,
      base64: await blobToBase64(blob),
      width,
      height,
      bytes: blob.size,
    };
  } finally {
    decoded.release();
  }
}

/** Image blocks for a user message, in attachment order. */
export function attachmentsToBlocks(atts: OutgoingAttachment[]): ImageBlock[] {
  return atts.map((a) => ({ type: 'image', source: { type: 'base64', media_type: a.mediaType, data: a.base64 } }));
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + BASE64_CHUNK));
  }
  return btoa(binary);
}

/** Base64 body of a blob, without any data-url prefix. */
export async function blobToBase64(blob: Blob): Promise<string> {
  if (typeof blob.arrayBuffer === 'function') {
    return bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Could not read image'));
    reader.onload = () => {
      const url = typeof reader.result === 'string' ? reader.result : '';
      const comma = url.indexOf(',');
      resolve(comma >= 0 ? url.slice(comma + 1) : '');
    };
    reader.readAsDataURL(blob);
  });
}
