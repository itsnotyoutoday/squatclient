export type Platform = 'mac' | 'windows' | 'linux';

/** The operating system the window runs on (decides menu style: macOS has the native menu bar). */
export function detectPlatform(nav: Pick<Navigator, 'userAgent' | 'platform'> = navigator): Platform {
  // `?platform=windows|linux|mac` previews another platform's look (menus) on this machine
  try {
    const q = new URLSearchParams(window.location.search).get('platform');
    if (q === 'mac' || q === 'windows' || q === 'linux') return q;
  } catch {
    /* no window (tests): fall through */
  }
  const s = `${nav.platform ?? ''} ${nav.userAgent ?? ''}`;
  if (/mac|iphone|ipad/i.test(s)) return 'mac';
  if (/win/i.test(s)) return 'windows';
  return 'linux';
}
