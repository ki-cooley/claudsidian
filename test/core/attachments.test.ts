// Tests for image attachment preparation: base64 encoding, block shape, and canvas downscaling in jsdom.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { attachmentsToBlocks, blobToBase64, prepareImage } from '../../src/core/attachments';
import type { OutgoingAttachment } from '../../src/core/types';

describe('attachmentsToBlocks', () => {
  it('maps attachments to base64 image blocks', () => {
    const atts: OutgoingAttachment[] = [
      { kind: 'image', name: 'a.jpg', mediaType: 'image/jpeg', base64: 'AAAA' },
      { kind: 'image', name: 'b.png', mediaType: 'image/png', base64: 'BBBB', width: 1, height: 1, bytes: 3 },
    ];
    expect(attachmentsToBlocks(atts)).toEqual([
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' } },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'BBBB' } },
    ]);
    expect(attachmentsToBlocks([])).toEqual([]);
  });
});

describe('blobToBase64', () => {
  it('round trips bytes without a data-url prefix', async () => {
    const bytes = new Uint8Array([0, 1, 2, 253, 254, 255]);
    const b64 = await blobToBase64(new Blob([bytes], { type: 'application/octet-stream' }));
    expect(b64).toBe('AAEC/f7/');
    expect(b64).not.toContain('data:');
    const back = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    expect(Array.from(back)).toEqual(Array.from(bytes));
  });
  it('encodes an empty blob as an empty string', async () => {
    expect(await blobToBase64(new Blob([]))).toBe('');
  });
  it('handles blobs larger than one encoding chunk', async () => {
    const bytes = new Uint8Array(100_000);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
    const b64 = await blobToBase64(new Blob([bytes]));
    const back = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    expect(back.length).toBe(bytes.length);
    expect(back[99_999]).toBe(99_999 % 251);
  });
});

describe('prepareImage', () => {
  interface FakeCanvas {
    width: number;
    height: number;
  }
  const drawn: { w: number; h: number }[] = [];
  const exported: { type: string | undefined; quality: number | undefined; w: number; h: number }[] = [];
  let source = { width: 4000, height: 3000 };
  let pngBytes = 10;
  const closed = vi.fn();

  beforeEach(() => {
    drawn.length = 0;
    exported.length = 0;
    source = { width: 4000, height: 3000 };
    pngBytes = 10;
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ width: source.width, height: source.height, close: closed })),
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: FakeCanvas) {
      const { width, height } = this;
      return {
        drawImage: (_img: unknown, _x: number, _y: number, w: number, h: number) => {
          drawn.push({ w: w ?? width, h: h ?? height });
        },
      } as unknown as CanvasRenderingContext2D;
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
      this: FakeCanvas,
      cb: BlobCallback,
      type?: string,
      quality?: unknown,
    ) {
      exported.push({ type, quality: typeof quality === 'number' ? quality : undefined, w: this.width, h: this.height });
      const size = type === 'image/png' ? pngBytes : 7;
      cb(new Blob([new Uint8Array(size)], { type: type ?? 'image/png' }));
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('downscales a 4000x3000 jpeg to 1568x1176 and exports jpeg at the default quality', async () => {
    const file = Object.assign(new Blob([new Uint8Array(5)], { type: 'image/jpeg' }), { name: 'big.jpg' });
    const att = await prepareImage(file);
    expect(att.kind).toBe('image');
    expect(att.name).toBe('big.jpg');
    expect(att.width).toBe(1568);
    expect(att.height).toBe(1176);
    expect(att.mediaType).toBe('image/jpeg');
    expect(att.bytes).toBe(7);
    expect(att.base64).toBe(btoa(String.fromCharCode(...new Uint8Array(7))));
    expect(drawn).toEqual([{ w: 1568, h: 1176 }]);
    expect(exported).toEqual([{ type: 'image/jpeg', quality: 0.85, w: 1568, h: 1176 }]);
    expect(closed).toHaveBeenCalled();
  });

  it('scales on the long edge for portrait images and honours maxEdge and quality', async () => {
    source = { width: 1000, height: 2000 };
    const file = new Blob([new Uint8Array(5)], { type: 'image/webp' });
    const att = await prepareImage(file, { maxEdge: 500, quality: 0.5 });
    expect(att.width).toBe(250);
    expect(att.height).toBe(500);
    expect(att.name).toBe('image');
    expect(exported[0]?.quality).toBe(0.5);
    expect(exported[0]?.type).toBe('image/jpeg');
  });

  it('never upscales a small image', async () => {
    source = { width: 300, height: 200 };
    const att = await prepareImage(new Blob([], { type: 'image/jpeg' }));
    expect(att.width).toBe(300);
    expect(att.height).toBe(200);
  });

  it('keeps png when the source is png and the result is under 1 MB', async () => {
    source = { width: 800, height: 600 };
    const file = Object.assign(new Blob([new Uint8Array(5)], { type: 'image/png' }), { name: 'shot.png' });
    const att = await prepareImage(file);
    expect(att.mediaType).toBe('image/png');
    expect(att.bytes).toBe(10);
    expect(exported.map((e) => e.type)).toEqual(['image/png']);
  });

  it('falls back to jpeg when the scaled png is 1 MB or more', async () => {
    source = { width: 800, height: 600 };
    pngBytes = 1024 * 1024;
    const file = new Blob([new Uint8Array(5)], { type: 'image/png' });
    const att = await prepareImage(file);
    expect(att.mediaType).toBe('image/jpeg');
    expect(att.bytes).toBe(7);
    expect(exported.map((e) => e.type)).toEqual(['image/png', 'image/jpeg']);
  });

  it('decodes through an Image element when createImageBitmap is missing', async () => {
    vi.stubGlobal('createImageBitmap', undefined);
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:fake'),
      revokeObjectURL: vi.fn(),
    });
    const origImage = globalThis.Image;
    class FakeImage {
      naturalWidth = 640;
      naturalHeight = 480;
      onload: (() => void) | null = null;
      onerror: ((e: unknown) => void) | null = null;
      set src(_v: string) {
        queueMicrotask(() => this.onload?.());
      }
    }
    vi.stubGlobal('Image', FakeImage);
    try {
      const att = await prepareImage(new Blob([], { type: 'image/jpeg' }));
      expect(att.width).toBe(640);
      expect(att.height).toBe(480);
      expect((URL as unknown as { revokeObjectURL: ReturnType<typeof vi.fn> }).revokeObjectURL).toHaveBeenCalledWith('blob:fake');
    } finally {
      vi.stubGlobal('Image', origImage);
    }
  });

  it('rejects when the canvas cannot export', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (cb: BlobCallback) {
      cb(null);
    });
    await expect(prepareImage(new Blob([], { type: 'image/jpeg' }))).rejects.toThrow(/encode/i);
  });
});
