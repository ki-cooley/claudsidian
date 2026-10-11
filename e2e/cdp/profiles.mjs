// Device profiles the harness runs at. `platform` feeds ?platform= (what the shim's Platform reports).
export const PROFILES = {
  'ipad-landscape': { width: 1194, height: 834, mobile: true, platform: 'mobile', scale: 2, touch: true },
  'ipad-portrait': { width: 834, height: 1194, mobile: true, platform: 'mobile', scale: 2, touch: true },
  phone: { width: 390, height: 844, mobile: true, platform: 'mobile', scale: 3, touch: true },
  'desktop-sidebar': { width: 1440, height: 900, mobile: false, platform: 'desktop', scale: 1, touch: false },
};

export const DEFAULT_PROFILE = 'ipad-landscape';

export function resolveProfiles(arg) {
  if (!arg || arg === 'default') return [DEFAULT_PROFILE];
  if (arg === 'all') return Object.keys(PROFILES);
  const names = arg.split(',').map((s) => s.trim()).filter(Boolean);
  for (const n of names) if (!PROFILES[n]) throw new Error(`unknown profile ${n}; known: ${Object.keys(PROFILES).join(', ')}`);
  return names;
}
