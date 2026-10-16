// Which desktop download fits this computer.

export type Os = 'windows' | 'mac' | 'linux' | 'android' | 'ios' | 'web';
export interface Detected {
  os: Os;
  /** ARM processor (Apple Silicon, Windows on ARM); undefined when unknown */
  arm?: boolean;
}
export interface ReleaseAsset {
  name: string;
  size: number;
  browser_download_url: string;
}

type UAData = { platform?: string; getHighEntropyValues?: (h: string[]) => Promise<{ architecture?: string }> };

export function osFromUserAgent(ua: string, platform = ''): Detected {
  if (/android/i.test(ua)) return { os: 'android' };
  // iPads say "Macintosh" but have touch
  if (/iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1)) return { os: 'ios' };
  if (/windows/i.test(ua) || /^win/i.test(platform)) return { os: 'windows', arm: /arm/i.test(ua) ? true : undefined };
  if (/mac os x|macintosh/i.test(ua) || /^mac/i.test(platform)) return { os: 'mac' };
  if (/linux|x11|cros/i.test(ua)) return { os: 'linux', arm: /aarch64|arm/i.test(ua) ? true : undefined };
  return { os: 'web' };
}

export async function detectOs(): Promise<Detected> {
  const d = osFromUserAgent(navigator.userAgent, navigator.platform);
  // Chromium can tell Apple Silicon from Intel; Safari can't (and most Macs sold now are ARM)
  const uad = (navigator as Navigator & { userAgentData?: UAData }).userAgentData;
  if (uad?.getHighEntropyValues && (d.os === 'mac' || d.os === 'windows')) {
    try {
      const { architecture } = await uad.getHighEntropyValues(['architecture']);
      if (architecture) d.arm = architecture === 'arm';
    } catch {
      /* keep the guess */
    }
  }
  return d;
}

/**
 * The installer to offer for this system from a release's files (the release is built as
 * moshpit_<version>_<arch>-setup.exe / .msi / _aarch64.dmg / _x64.dmg / .AppImage / .deb / .rpm).
 * With `all`, any file for the system matches (for listing them).
 */
export function pickAsset(assets: ReleaseAsset[], d: Detected, all = false): ReleaseAsset | null {
  const ext = (a: ReleaseAsset) => a.name.toLowerCase();
  const usable = assets.filter((a) => !/\.(sig|sha256|json|txt|tar\.gz)$/i.test(a.name));
  let order: ((a: ReleaseAsset) => boolean)[] = [];
  if (d.os === 'windows') order = [(a) => ext(a).endsWith('-setup.exe'), (a) => ext(a).endsWith('.msi'), (a) => ext(a).endsWith('.exe')];
  else if (d.os === 'mac') {
    const arm = (a: ReleaseAsset) => ext(a).endsWith('.dmg') && /aarch64|arm64/.test(ext(a));
    const intel = (a: ReleaseAsset) => ext(a).endsWith('.dmg') && /x64|x86_64|intel/.test(ext(a));
    // unknown: Apple Silicon first
    order = d.arm === false ? [intel, arm] : [arm, intel];
    order.push((a) => ext(a).endsWith('.dmg'));
  } else if (d.os === 'linux') order = [(a) => ext(a).endsWith('.appimage'), (a) => ext(a).endsWith('.deb'), (a) => ext(a).endsWith('.rpm')];
  if (all) return usable.find((a) => order.some((f) => f(a))) ?? null;
  for (const f of order) {
    const hit = usable.find(f);
    if (hit) return hit;
  }
  return null;
}
