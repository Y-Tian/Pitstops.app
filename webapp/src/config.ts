// ─── R2 Data Sources ──────────────────────────────────────────────────────────
export const R2_URLS = {
  leaderboard: (import.meta.env.VITE_LEADERBOARD_URL as string) || '',
  metadata: (import.meta.env.VITE_METADATA_URL as string) || '',
  analytics: (import.meta.env.VITE_ANALYTICS_URL as string) || '',
};

export const REFRESH_INTERVAL_MS =
  Number(import.meta.env.VITE_REFRESH_INTERVAL_MS) || 15000;

// ─── NASCAR CDN ────────────────────────────────────────────────────────────────
export const carBadgeUrl = (seriesId: number, vehicleNumber: string): string =>
  `https://cf.nascar.com/data/images/carbadges/${seriesId}/${vehicleNumber}.png`;

// ─── Series Names ──────────────────────────────────────────────────────────────
export const SERIES_NAMES: Record<number, string> = {
  1: 'NASCAR Cup Series',
  2: 'NASCAR O\'Reilly Auto Parts Series',
  3: 'NASCAR Craftsman Truck Series',
};

// ─── Flag State Config ─────────────────────────────────────────────────────────
export const FLAG_CONFIG: Record<
  number,
  { label: string; color: string; glow: string }
> = {
  1: { label: 'GREEN FLAG',   color: '#22c55e', glow: '#22c55e44' },
  2: { label: 'CAUTION',      color: '#eab308', glow: '#eab30844' },
  3: { label: 'RED FLAG',     color: '#ef4444', glow: '#ef444444' },
  4: { label: 'WHITE FLAG',   color: '#f1f5f9', glow: '#f1f5f922' },
  5: { label: 'CHECKERED',    color: '#f1f5f9', glow: '#f1f5f922' },
  8: { label: 'PACE LAP',     color: '#f97316', glow: '#f9731644' },
  9: { label: 'CAUTION',      color: '#eab308', glow: '#eab30844' },
};

// ─── Manufacturer Images ────────────────────────────────────────────────────────
import chevroletLogo from './resources/chevrolet.png';
import fordLogo from './resources/ford.png';
import toyotaLogo from './resources/toyota.png';

// ─── Manufacturer Config ───────────────────────────────────────────────────────
export const MFR_CONFIG: Record<
  string,
  { full: string; abbr: string; logo: string; color: string; bg: string; border: string }
> = {
  Chv: {
    full: 'Chevrolet',
    abbr: 'CHV',
    logo: chevroletLogo,
    color: '#fbbf24',
    bg: '#271d00',
    border: '#fbbf2440',
  },
  Frd: {
    full: 'Ford',
    abbr: 'FRD',
    logo: fordLogo,
    color: '#60a5fa',
    bg: '#061629',
    border: '#60a5fa40',
  },
  Tyt: {
    full: 'Toyota',
    abbr: 'TYT',
    logo: toyotaLogo,
    color: '#f87171',
    bg: '#210808',
    border: '#f8717140',
  },
};
