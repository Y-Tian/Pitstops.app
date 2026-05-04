import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AgGridReact } from 'ag-grid-react';
import type {
  CellStyle,
  ColDef,
  GetRowIdParams,
  ICellRendererParams,
} from 'ag-grid-community';
import Papa from 'papaparse';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-balham.css';

import type { GridContext, LeaderboardRow, RaceMetadata } from './types';
import {
  carBadgeUrl,
  FLAG_CONFIG,
  MFR_CONFIG,
  R2_URLS,
  REFRESH_INTERVAL_MS,
  SERIES_NAMES,
} from './config';
import { FavoriteDriversSelect } from './FavoriteDriversSelect';
import { FavoriteTeamsSelect } from './FavoriteTeamsSelect';
import './index.css';

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

/** Strip *, (i), # decorators from driver name. Returns clean name + flags. */
function parseDriverName(raw: string): {
  clean: string;
  ineligible: boolean;
  rookie: boolean;
} {
  const s          = raw ?? '';
  const ineligible = s.includes('(i)') || s.includes('*');
  const rookie     = s.includes('#');
  const clean      = s
    .replace(/\*/g, '')
    .replace(/\(i\)/gi, '')
    .replace(/#/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return { clean, ineligible, rookie };
}

/** Format lap time in seconds → "SS.SSS" or "M:SS.SSS" */
function fmtLapTime(secs: number): string {
  if (!secs || secs <= 0) return '—';
  if (secs >= 60) {
    const m = Math.floor(secs / 60);
    const s = (secs % 60).toFixed(3).padStart(6, '0');
    return `${m}:${s}`;
  }
  return secs.toFixed(3);
}

/** Format the gap/delta field. Negative = laps down, positive = seconds. */
function fmtGap(delta: number | undefined, pos: number | undefined): string {
  if (delta == null || pos == null || isNaN(delta) || isNaN(pos)) return '—';
  if (pos === 1) return 'LEADER';
  if (delta < 0) {
    const n = Math.abs(Math.round(delta));
    return `–${n} ${n === 1 ? 'Lap' : 'Laps'}`;
  }
  return `+${delta.toFixed(3)}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CELL RENDERERS
// ═══════════════════════════════════════════════════════════════════════════════

// ── Position Delta (±) ────────────────────────────────────────────────────────
const PositionDeltaRenderer: React.FC<
  ICellRendererParams<LeaderboardRow>
> = ({ value }) => {
  if (value === 0 || value == null) {
    return (
      <span style={{ color: '#02bbf9', fontSize: 12, fontFamily: 'JetBrains Mono, monospace' }}>
        —
      </span>
    );
  }
  const up = value > 0;
  return (
    <span
      style={{
        color:      up ? '#22c55e' : '#ef4444',
        fontWeight: 700,
        fontSize:   11,
        fontFamily: 'Barlow Condensed, sans-serif',
        letterSpacing: '0.02em',
        display:    'flex',
        alignItems: 'center',
        gap:        2,
      }}
    >
      {up ? '▲' : '▼'}
      {Math.abs(value)}
    </span>
  );
};

// ── Driver (badge + manufacturer + image + name) ──────────────────────────────
const DriverCellRenderer: React.FC<
  ICellRendererParams<LeaderboardRow>
> = ({ data, context }) => {
  if (!data) return null;
  const ctx  = context as GridContext;
  const mfr  = MFR_CONFIG[data.vehicle_manufacturer] ?? {
    full: data.vehicle_manufacturer,
    abbr: data.vehicle_manufacturer,
    color: '#65a5ff',
    bg:    '#02bbf9',
    border:'#94a3b830',
  };
  const { clean, ineligible, rookie } = parseDriverName(data.full_name ?? '');

  // Build badge URL from prefetch map or fallback to CDN URL.
  const badgeKey = String(data.vehicle_number ?? '');
  const badgeFromMap = ctx?.badgeImages?.get(badgeKey);
  const cdnBadgeUrl = ctx?.seriesId ? carBadgeUrl(ctx.seriesId, data.vehicle_number) : undefined;
  const badgeUrl = badgeFromMap ?? cdnBadgeUrl;
  const driverImageUrl = ctx?.driverImages?.get(data.driver_id);

  // Local state to handle image load/error and show fallback when necessary.
  const [imgError, setImgError] = useState(false);
  const [driverImgError, setDriverImgError] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);

  return (
    <div
      style={{
        display:    'flex',
        alignItems: 'center',
        gap:        6,
        height:     '100%',
        overflow:   'hidden',
      }}
    >
      {/* ── Car Number Badge ── */}
      <div
        style={{
          width:           34,
          height:          22,
          flexShrink:      0,
          display:         'flex',
          alignItems:      'center',
          justifyContent:  'center',
        }}
      >
        {!imgError && badgeUrl ? (
          <img
            src={badgeUrl}
            alt={`#${data.vehicle_number}`}
            style={{ width: 34, height: 22, objectFit: 'contain' }}
            loading="lazy"
            onLoad={() => setImgLoaded(true)}
            onError={(e) => {
              // hide broken image and show fallback
              setImgError(true);
              // ensure the image is not visible
              try {
                (e.currentTarget as HTMLImageElement).style.display = 'none';
              } catch {}
            }}
          />
        ) : (
          <span
            style={{
              fontSize:      9,
              fontWeight:    700,
              color:         '#65a5ff',
              fontFamily:    'Barlow Condensed, sans-serif',
              background:    '#111827',
              border:        '1px solid #02bbf9',
              borderRadius:  3,
              padding:       '1px 4px',
              letterSpacing: '0.04em',
            }}
          >
            #{data.vehicle_number}
          </span>
        )}
      </div>

      {/* ── Manufacturer Pill ── */}
      <img
        src={mfr.logo}
        alt={mfr.full}
        title={mfr.full}
        style={{
          height:     10,
          width:      25,
          flexShrink: 0,
          objectFit:  'contain',
        }}
      />

      {/* ── Driver Image ── */}
      {driverImageUrl && !driverImgError && (
        <img
          src={driverImageUrl}
          alt={clean}
          title={clean}
          style={{
            width:         20,
            height:        20,
            flexShrink:    0,
          }}
          loading="eager"
          onError={(e) => {
            setDriverImgError(true);
            try {
              (e.currentTarget as HTMLImageElement).style.display = 'none';
            } catch {}
          }}
        />
      )}

      {/* ── Driver Name ── */}
      <a
        href={`https://en.wikipedia.org/wiki/${clean.replace(/\s+/g, '_')}`}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          fontFamily:   'Barlow Condensed, sans-serif',
          fontWeight:   500,
          fontSize:     13,
          color:        '#dde4ef',
          textDecoration: 'none',
          cursor:       'pointer',
          transition:   'color 0.2s ease',
          minWidth:     0,
          overflow:     'hidden',
          textOverflow: 'ellipsis',
          whiteSpace:   'nowrap',
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLAnchorElement).style.color = '#02bbf9';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLAnchorElement).style.color = '#dde4ef';
        }}
      >
        {clean}
      </a>

      {/* ── Ineligible indicator ── */}
      {ineligible && (
        <span
          title="Ineligible for championship points"
          style={{
            fontSize:      10,
            fontWeight:    700,
            color:         '#f97316',
            border:        '1px solid #f9731660',
            borderRadius:  2,
            padding:       '0 3px',
            flexShrink:    0,
            fontFamily:    'Barlow Condensed, sans-serif',
            letterSpacing: '0.06em',
          }}
        >
          Ineligible
        </span>
      )}

      {/* ── Rookie indicator ── */}
      {rookie && (
        <span
          title="NASCAR Next / Rookie"
          style={{
            fontSize:      10,
            fontWeight:    700,
            color:         '#a78bfa',
            border:        '1px solid #a78bfa60',
            borderRadius:  2,
            padding:       '0 3px',
            flexShrink:    0,
            fontFamily:    'Barlow Condensed, sans-serif',
            letterSpacing: '0.06em',
          }}
        >
          Rookie
        </span>
      )}
    </div>
  );
};

// ── Last Lap Time ─────────────────────────────────────────────────────────────
const LapTimeRenderer: React.FC<ICellRendererParams<LeaderboardRow>> = ({
  data,
}) => {
  if (!data) return null;
  return (
    <span
      style={{
        fontFamily: 'JetBrains Mono, monospace',
        fontSize:   11,
        fontWeight: 500,
        color:      '#dde4ef',
      }}
    >
      {fmtLapTime(data.last_lap_time)}
    </span>
  );
};

// ── Gap / Time-to-Leader ──────────────────────────────────────────────────────
const GapRenderer: React.FC<ICellRendererParams<LeaderboardRow>> = ({
  data,
}) => {
  if (!data) return null;
  const isLeader   = data.running_position === 1;
  const isLapsDown = (data.delta ?? 0) < 0;
  const text       = fmtGap(data.delta, data.running_position);

  return (
    <span
      style={{
        fontFamily: 'JetBrains Mono, monospace',
        fontSize:   11,
        fontWeight: 500,
        color:      isLeader
          ? '#2cf504'
          : isLapsDown
          ? '#ef4444'
          : '#ff9008',
      }}
    >
      {text}
    </span>
  );
};

// ── Race Pace Grade ───────────────────────────────────────────────────────────
const PaceGradeRenderer: React.FC<ICellRendererParams<LeaderboardRow>> = ({
  value,
}) => {
  const grade = typeof value === 'string' && value.trim() ? value.trim() : '—';
  const palette: Record<string, { color: string; border: string; bg: string }> = {
    'S+': { color: '#e2e8f0', border: 'rgba(226, 232, 240, 0.18)', bg: 'rgba(226, 232, 240, 0.08)' },
    S:    { color: '#86efac', border: 'rgba(34, 197, 94, 0.22)', bg: 'rgba(34, 197, 94, 0.08)' },
    A:    { color: '#7dd3fc', border: 'rgba(2, 187, 249, 0.22)', bg: 'rgba(2, 187, 249, 0.08)' },
    B:    { color: '#fcd34d', border: 'rgba(251, 191, 36, 0.22)', bg: 'rgba(251, 191, 36, 0.08)' },
    C:    { color: '#fdba74', border: 'rgba(251, 146, 60, 0.22)', bg: 'rgba(251, 146, 60, 0.08)' },
    D:    { color: '#fca5a5', border: 'rgba(239, 68, 68, 0.22)', bg: 'rgba(239, 68, 68, 0.08)' },
    F:    { color: '#fca5a5', border: 'rgba(239, 68, 68, 0.22)', bg: 'rgba(239, 68, 68, 0.08)' },
  };
  const style = palette[grade] ?? {
    color: '#cbd5e1',
    border: 'rgba(148, 163, 184, 0.18)',
    bg: 'rgba(148, 163, 184, 0.06)',
  };

  return (
    <span
      style={{
        display:        'inline-flex',
        alignItems:     'center',
        justifyContent: 'center',
        minWidth:       30,
        padding:        '1px 7px',
        borderRadius:   999,
        border:         `1px solid ${style.border}`,
        background:     style.bg,
        color:          style.color,
        fontFamily:     'JetBrains Mono, monospace',
        fontSize:       10,
        fontWeight:     600,
        letterSpacing:  '0.05em',
        lineHeight:     1.2,
      }}
    >
      {grade}
    </span>
  );
};

// ── Car Status ────────────────────────────────────────────────────────────────
const StatusRenderer: React.FC<ICellRendererParams<LeaderboardRow>> = ({
  data,
}) => {
  if (!data) return null;

  if (data.is_on_dvp) {
    return (
      <span
        title="Damage/Vehicle Penalty"
        style={{
          fontSize:      10,
          fontWeight:    700,
          letterSpacing: '0.08em',
          color:         '#ef4444',
          fontFamily:    'Barlow Condensed, sans-serif',
        }}
      >
        ◆ DVP
      </span>
    );
  }
  if (data.is_on_track) {
    return (
      <span
        style={{
          fontSize:      10,
          fontWeight:    700,
          letterSpacing: '0.06em',
          color:         '#22c55e',
          fontFamily:    'Barlow Condensed, sans-serif',
        }}
      >
        ● RACING
      </span>
    );
  }
  return (
    <span
      style={{
        fontSize:      10,
        fontWeight:    700,
        letterSpacing: '0.06em',
        color:         '#f59e0b',
        fontFamily:    'Barlow Condensed, sans-serif',
      }}
    >
      ○ PIT/OUT
    </span>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// RACE HEADER
// ═══════════════════════════════════════════════════════════════════════════════

interface HeaderProps {
  metadata:    RaceMetadata | null;
  lastRefresh: Date | null;
  loading:     boolean;
  error:       string | null;
}

const RaceHeader: React.FC<HeaderProps> = ({
  metadata,
  lastRefresh,
  loading,
  error,
}) => {
  const flag       = metadata ? FLAG_CONFIG[metadata.flag_state] : null;
  const seriesName = metadata
    ? (SERIES_NAMES[metadata.series_id] ?? `Series ${metadata.series_id}`)
    : '';
  const lapsLeft = (metadata && !isNaN(metadata.laps_in_race) && !isNaN(metadata.lap_number))
    ? metadata.laps_in_race - metadata.lap_number
    : null;

  return (
    <header
      style={{
        display:         'flex',
        alignItems:      'center',
        justifyContent:  'space-between',
        gap:             20,
        flexWrap:        'wrap',
        padding:         '10px 20px',
        background:      'linear-gradient(180deg, #0d0d1c 0%, #09091a 100%)',
        borderBottom:    '1px solid #1a1a2e',
        boxShadow:       '0 4px 24px rgba(0,0,0,0.6)',
        animation:       'slide-in 0.3s ease',
      }}
    >
      {/* ── Left: Series + Race + Track ── */}
      <div style={{ minWidth: 200 }}>
        <div
          style={{
            fontFamily:    'Barlow Condensed, sans-serif',
            fontSize:      10,
            fontWeight:    700,
            letterSpacing: '0.18em',
            color:         '#cc0001',
            textTransform: 'uppercase',
            marginBottom:  2,
          }}
        >
          {seriesName || '\u00A0'}
        </div>
        <div
          style={{
            fontFamily:    'Rajdhani, sans-serif',
            fontSize:      24,
            fontWeight:    700,
            color:         '#f1f5f9',
            lineHeight:    1.1,
            letterSpacing: '0.01em',
          }}
        >
          {metadata?.run_name ?? 'Waiting for data…'}
        </div>
        {metadata && (
          <div
            style={{
              fontFamily:    'Barlow Condensed, sans-serif',
              fontSize:      11,
              color:         '#02bbf9',
              marginTop:     2,
              letterSpacing: '0.04em',
            }}
          >
            {metadata.track_name}
          </div>
        )}
      </div>

      {/* ── Center: Lap counter + Flag state ── */}
      {metadata && (
        <div
          style={{
            display:        'flex',
            alignItems:     'center',
            gap:            18,
          }}
        >
          {/* Lap counter */}
          <div style={{ textAlign: 'center' }}>
            <div
              style={{
                fontFamily: 'JetBrains Mono, monospace',
                fontSize:   32,
                fontWeight: 600,
                color:      '#f1f5f9',
                lineHeight: 1,
              }}
            >
              {metadata.lap_number}
              <span
                style={{ fontSize: 16, color: '#02bbf9', fontWeight: 400 }}
              >
                /{metadata.laps_in_race}
              </span>
            </div>
            <div
              style={{
                fontFamily:    'Barlow Condensed, sans-serif',
                fontSize:      9,
                letterSpacing: '0.16em',
                color:         '#02bbf9',
                textTransform: 'uppercase',
                marginTop:     1,
              }}
            >
              LAPS
            </div>
          </div>

          {/* Divider */}
          <div style={{ width: 1, height: 40, background: '#1a1a2e' }} />

          {/* Progress bar */}
          <div
            style={{
              display:       'flex',
              alignItems:    'center',
              justifyContent: 'center',
              width:         80,
              height:        40,
            }}
          >
            <div
              style={{
                width:            '100%',
                height:           6,
                background:       '#1a1a2e',
                borderRadius:     3,
                overflow:         'hidden',
                position:         'relative',
              }}
            >
              <div
                style={{
                  width:       `${(metadata.lap_number / metadata.laps_in_race) * 100}%`,
                  height:      '100%',
                  background:  '#02bbf9',
                  borderRadius: 3,
                  transition:  'width 0.3s ease',
                }}
              />
            </div>
          </div>

          {/* Laps remaining */}
          <div style={{ textAlign: 'center' }}>
            <div
              style={{
                fontFamily: 'JetBrains Mono, monospace',
                fontSize:   32,
                fontWeight: 600,
                color:      '#475569',
                lineHeight: 1,
              }}
            >
              {lapsLeft}
            </div>
            <div
              style={{
                fontFamily:    'Barlow Condensed, sans-serif',
                fontSize:      9,
                letterSpacing: '0.16em',
                color:         '#02bbf9',
                textTransform: 'uppercase',
                marginTop:     1,
              }}
            >
              TO GO
            </div>
          </div>

          {/* Divider */}
          <div style={{ width: 1, height: 40, background: '#1a1a2e' }} />

          {/* Flag indicator */}
          {flag && (
            <div
              style={{
                display:        'flex',
                alignItems:     'center',
                gap:            8,
                background:     flag.glow,
                border:         `1px solid ${flag.color}55`,
                borderRadius:   5,
                padding:        '6px 14px',
              }}
            >
              <span
                style={{
                  width:        8,
                  height:       8,
                  borderRadius: '50%',
                  background:   flag.color,
                  boxShadow:    `0 0 8px ${flag.color}`,
                  display:      'inline-block',
                  animation:    'pulse-dot 2s ease-in-out infinite',
                }}
              />
              <span
                style={{
                  fontFamily:    'Barlow Condensed, sans-serif',
                  fontWeight:    700,
                  fontSize:      13,
                  letterSpacing: '0.12em',
                  color:         flag.color,
                  textTransform: 'uppercase',
                }}
              >
                {flag.label}
              </span>
            </div>
          )}
        </div>
      )}

      {/* ── Right: Live indicator + last refresh ── */}
      <div style={{ textAlign: 'right' }}>
        {error && (
          <div
            style={{
              fontFamily: 'Barlow Condensed, sans-serif',
              fontSize:   11,
              color:      '#ef4444',
              marginBottom: 4,
              maxWidth:   240,
              wordBreak:  'break-all',
            }}
          >
            ⚠ {error}
          </div>
        )}
        <div
          style={{
            display:        'flex',
            alignItems:     'center',
            gap:            6,
            justifyContent: 'flex-end',
          }}
        >
          <span
            style={{
              width:        7,
              height:       7,
              borderRadius: '50%',
              background:   '#22c55e',
              boxShadow:    '0 0 6px #22c55e',
              display:      'inline-block',
              animation:    'none',
            }}
          />
          <span
            style={{
              fontFamily:    'Barlow Condensed, sans-serif',
              fontWeight:    700,
              fontSize:      11,
              letterSpacing: '0.14em',
              color:         '#22c55e',
            }}
          >
            LIVE
          </span>
        </div>

        {lastRefresh && (
          <div
            style={{
              fontFamily: 'JetBrains Mono, monospace',
              fontSize:   10,
              color:      '#02bbf9',
              marginTop:  4,
            }}
          >
            {lastRefresh.toLocaleTimeString()}
          </div>
        )}

        <div
          style={{
            fontFamily:    'Barlow Condensed, sans-serif',
            fontSize:      9,
            letterSpacing: '0.10em',
            color:         '#02bbf9',
            marginTop:     2,
          }}
        >
          Automatically refreshes every {REFRESH_INTERVAL_MS / 1000}s
        </div>
      </div>
    </header>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// CSV UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

function parseCSV<T extends Record<string, unknown>>(text: string): T[] {
  // Detect delimiter (tabs vs commas) based on header line
  const firstLine = (text || '').split(/\r?\n/)[0] ?? '';
  const delimiter = firstLine.includes('\t') ? '\t' : firstLine.includes(',') ? ',' : ',';

  const result = Papa.parse<Record<string, string>>(text, {
    header:         true,
    skipEmptyLines: true,
    delimiter,
    transformHeader: (h) => h.trim(),
  });

  return result.data.map((row) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) {
      const trimmed = v?.trim?.() ?? v;
      if      (trimmed === 'True' || trimmed === 'TRUE' || trimmed === 'true')  out[k] = true;
      else if (trimmed === 'False' || trimmed === 'FALSE' || trimmed === 'false') out[k] = false;
      else if (trimmed !== '' && !isNaN(Number(trimmed))) out[k] = Number(trimmed);
      else    out[k] = trimmed;
    }
    return out as T;
  });
}

async function fetchCSV<T extends Record<string, unknown>>(
  url: string
): Promise<T[]> {
  const resp = await fetch(url, { cache: 'no-store' });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} — ${url}`);
  const text = await resp.text();
  return parseCSV<T>(text);
}

async function prefetchBadges(
  rows:     LeaderboardRow[],
  seriesId: number
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  await Promise.allSettled(
    rows.map(async (row) => {
      try {
        const url  = carBadgeUrl(seriesId, row.vehicle_number);
        const resp = await fetch(url);
        if (resp.ok) {
          const blob = await resp.blob();
          map.set(row.vehicle_number, URL.createObjectURL(blob));
        }
      } catch {
        // silently skip missing badges
      }
    })
  );
  return map;
}

async function prefetchDriverImages(
  rows: LeaderboardRow[],
  imageUrlByNascarDriverId: Map<number, string>
): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  await Promise.allSettled(
    rows.map(async (row) => {
      const imageUrl = imageUrlByNascarDriverId.get(row.driver_id);
      if (!imageUrl) return;
      try {
        await new Promise<void>((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve();
          img.onerror = () => reject(new Error(`Failed to preload ${imageUrl}`));
          img.src = imageUrl;
        });
        map.set(row.driver_id, imageUrl);
      } catch {
        // silently skip missing driver images
      }
    })
  );
  return map;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════════════════════════

export default function App() {
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>([]);
  const [metadata,    setMetadata]    = useState<RaceMetadata | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState<string | null>(null);
  const [badgeImages, setBadgeImages] = useState<Map<string, string>>(new Map());
  const [driverImages, setDriverImages] = useState<Map<number, string>>(new Map());
  const [favoriteDriverIds, setFavoriteDriverIds] = useState<number[]>([]);
  const [favoriteTeamNames, setFavoriteTeamNames] = useState<string[]>([]);

  // Stable refs — avoid re-creating the interval callback
  const prevPositions  = useRef<Map<number, number>>(new Map());
  const firstLoad      = useRef(true);
  const badgesFetched  = useRef(false);
  const driverImagesFetched = useRef(false);
  const teamByNascarDriverId = useRef<Map<number, string>>(new Map());
  const intervalRef    = useRef<ReturnType<typeof setInterval> | null>(null);

  // Grid context — memoized to avoid unnecessary re-renders
  const gridContext = useMemo<GridContext>(
    () => ({ badgeImages, driverImages, seriesId: metadata?.series_id ?? 1 }),
    [badgeImages, driverImages, metadata?.series_id]
  );

  const availableTeams = useMemo(() => {
    return Array.from(
      new Set(
        leaderboard
          .map((row) => row.team?.trim())
          .filter((team): team is string => Boolean(team))
      )
    ).sort((a, b) => a.localeCompare(b));
  }, [leaderboard]);

  // ── Data loader (stable ref, no deps) ────────────────────────────────────────
  const loadData = useCallback(async () => {
    if (!R2_URLS.leaderboard || !R2_URLS.metadata || !R2_URLS.analytics || !R2_URLS.drivers) {
      setError('R2 URLs not configured — see .env.example');
      return;
    }

    setLoading(true);

    try {
      // Debuggable fetch: get raw responses so we can log statuses and sizes
      const [leaderboardResp, metadataResp, analyticsResp, driversResp] = await Promise.all([
        fetch(R2_URLS.leaderboard, { cache: 'no-store' }),
        fetch(R2_URLS.metadata, { cache: 'no-store' }),
        fetch(R2_URLS.analytics, { cache: 'no-store' }),
        firstLoad.current && !driverImagesFetched.current
          ? fetch(R2_URLS.drivers, { cache: 'no-store' })
          : Promise.resolve(null as Response | null),
      ]);
      console.debug(
        'R2 leaderboard status:',
        leaderboardResp.status,
        'metadata status:',
        metadataResp.status,
        'analytics status:',
        analyticsResp.status
      );
      if (!leaderboardResp.ok) throw new Error(`HTTP ${leaderboardResp.status} — ${R2_URLS.leaderboard}`);
      if (!metadataResp.ok) throw new Error(`HTTP ${metadataResp.status} — ${R2_URLS.metadata}`);
      if (!analyticsResp.ok) throw new Error(`HTTP ${analyticsResp.status} — ${R2_URLS.analytics}`);
      if (driversResp && !driversResp.ok) throw new Error(`HTTP ${driversResp.status} — ${R2_URLS.drivers}`);
      const [rawRowsText, rawMetaText, rawAnalyticsText] = await Promise.all([
        leaderboardResp.text(),
        metadataResp.text(),
        analyticsResp.text(),
      ]);
      const rawDriversText = driversResp ? await driversResp.text() : '';
      console.debug(
        'R2 leaderboard bytes:',
        rawRowsText.length,
        'metadata bytes:',
        rawMetaText.length,
        'analytics bytes:',
        rawAnalyticsText.length
      );
      let parsedA = parseCSV<LeaderboardRow>(rawRowsText);
      let parsedB = parseCSV<RaceMetadata>(rawMetaText);
      const parsedAnalytics = parseCSV<{ driver_id: number; pace_grade: string; pace_rank: number }>(rawAnalyticsText);
      const parsedDrivers = rawDriversText
        ? parseCSV<{ nascar_driver_id: number; image_small: string; team: string }>(rawDriversText)
        : [];

      // Heuristic detection: CSVs may be swapped. Detect by presence of known keys.
      const aLooksLikeMeta = parsedA[0] && Object.prototype.hasOwnProperty.call(parsedA[0], 'lap_number');
      const bLooksLikeLeaderboard = parsedB[0] && Object.prototype.hasOwnProperty.call(parsedB[0], 'last_lap_time');

      if (aLooksLikeMeta && bLooksLikeLeaderboard) {
        console.debug('Detected swapped CSVs — swapping parsed results');
        const tmp = parsedA;
        parsedA = parsedB as unknown as typeof parsedA;
        parsedB = tmp as unknown as typeof parsedB;
      }

      const rawRowsFinal = parsedA as LeaderboardRow[];
      const rawMetaFinal = parsedB as RaceMetadata[];
      const paceGradeByDriverId = new Map<number, string>();
      const paceRankByDriverId = new Map<number, number>();
      const imageUrlByNascarDriverId = new Map<number, string>();
      parsedAnalytics.forEach((row) => {
        if (row.driver_id != null) {
          paceGradeByDriverId.set(row.driver_id, row.pace_grade ?? '');
          paceRankByDriverId.set(row.driver_id, row.pace_rank ?? Number.POSITIVE_INFINITY);
        }
      });
      parsedDrivers.forEach((row) => {
        if (row.nascar_driver_id != null && typeof row.image_small === 'string' && row.image_small.trim()) {
          imageUrlByNascarDriverId.set(row.nascar_driver_id, row.image_small.trim());
        }
        if (row.nascar_driver_id != null && typeof row.team === 'string' && row.team.trim()) {
          teamByNascarDriverId.current.set(row.nascar_driver_id, row.team.trim());
        }
      });

      console.debug('Parsed leaderboard rows:', rawRowsFinal.length, rawRowsFinal[0]);
      console.debug('Parsed metadata rows:', rawMetaFinal.length, rawMetaFinal[0]);
      console.debug('Parsed analytics rows:', parsedAnalytics.length, parsedAnalytics[0]);
      console.debug('Parsed drivers rows:', parsedDrivers.length, parsedDrivers[0]);

      const prev = prevPositions.current;

      // Compute position-change deltas (previous pos − current pos)
      const rows: LeaderboardRow[] = rawRowsFinal.map((row) => ({
        ...row,
        team: teamByNascarDriverId.current.get(row.driver_id) ?? '',
        pace_grade: paceGradeByDriverId.get(row.driver_id) ?? '',
        pace_rank: paceRankByDriverId.get(row.driver_id),
        positionDelta: firstLoad.current
          ? 0
          : (prev.get(row.driver_id) ?? row.running_position) -
            row.running_position,
      }));

      // Save current positions for next diff
      rows.forEach((r) => prev.set(r.driver_id, r.running_position));

      const meta = rawMetaFinal[0] ?? null;

      // One-time badge prefetch after we know the series ID
      if (firstLoad.current && meta && !badgesFetched.current) {
        badgesFetched.current = true;
        firstLoad.current     = false;
        prefetchBadges(rows, meta.series_id).then((badges) => {
          setBadgeImages(badges);
        });
      } else {
        firstLoad.current = false;
      }

      if (meta && !driverImagesFetched.current && imageUrlByNascarDriverId.size > 0) {
        driverImagesFetched.current = true;
        prefetchDriverImages(rows, imageUrlByNascarDriverId).then((images) => {
          setDriverImages(images);
        });
      }

      setLeaderboard(rows);
      if (meta) setMetadata(meta);
      setLastRefresh(new Date());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown fetch error');
    } finally {
      setLoading(false);
    }
  }, []); // intentionally empty — uses refs only

  // ── Start polling ─────────────────────────────────────────────────────────────
  useEffect(() => {
    loadData();
    intervalRef.current = setInterval(loadData, REFRESH_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [loadData]);

  // ── AG Grid setup ─────────────────────────────────────────────────────────────
  const getRowId = useCallback(
    (params: GetRowIdParams<LeaderboardRow>) =>
      String(params.data.driver_id),
    []
  );

  const rightAlignedCellStyle: CellStyle = {
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'flex-end',
    paddingRight:   10,
  };

  const centeredCellStyle: CellStyle = {
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'center',
  };

  const driverCellStyle: CellStyle = {
    padding: '0 4px',
  };

  const columnDefs = useMemo<ColDef<LeaderboardRow>[]>(
    () => [
      {
        headerName:  'POS',
        field:       'running_position',
        width:       70,
        pinned:      'left',
        suppressMovable: true,
        sort:        'asc',
        headerClass: 'ag-col-center',
        cellStyle: {
          display:        'flex',
          alignItems:     'center',
          justifyContent: 'center',
          fontFamily:     'JetBrains Mono, monospace',
          fontWeight:     700,
          fontSize:       13,
          color:          '#f1f5f9',
        },
      },
      {
        headerName:  'START',
        field:       'starting_position',
        width:       78,
        pinned:      'left',
        suppressMovable: true,
        headerClass: 'ag-col-center',
        cellStyle: {
          display:        'flex',
          alignItems:     'center',
          justifyContent: 'center',
          fontFamily:     'JetBrains Mono, monospace',
          fontWeight:     700,
          fontSize:       10,
          color:          '#71767a',
        },
      },
      {
        headerName:  '±',
        field:       'positionDelta',
        width:       50,
        sortable:     false,
        headerClass: 'ag-col-center',
        cellRenderer: PositionDeltaRenderer,
        cellStyle:    centeredCellStyle,
      },
      {
        headerName:   'DRIVER',
        field:        'full_name',
        flex:         1,
        minWidth:     215,
        sortable:     false,
        cellRenderer: DriverCellRenderer,
        cellStyle:    driverCellStyle,
      },
      {
        headerName:  'TEAM',
        field:       'team',
        width:       120,
        sortable:    true,
        cellClassRules: {
          'team-favorite': (params: any) =>
            favoriteTeamNames.includes(String(params.value ?? '').trim()),
        },
      },
      {
        headerName:   'RACE PACE',
        field:        'pace_grade',
        width:        96,
        headerClass:  'ag-col-center',
        comparator:   (valueA, valueB, nodeA, nodeB) =>
          (nodeA.data?.pace_rank ?? Number.POSITIVE_INFINITY) -
          (nodeB.data?.pace_rank ?? Number.POSITIVE_INFINITY),
        cellRenderer: PaceGradeRenderer,
        cellStyle:    centeredCellStyle,
      },
      {
        headerName:   'LAST LAP',
        field:        'last_lap_time',
        width:        90,
        headerClass:  'ag-col-right',
        cellRenderer: LapTimeRenderer,
        cellStyle:    rightAlignedCellStyle,
      },
      {
        headerName:   'GAP',
        field:        'delta',
        width:        104,
        headerClass:  'ag-col-center',
        sortable:     false,
        cellRenderer: GapRenderer,
        cellStyle:    centeredCellStyle,
      },
      {
        headerName:   'STATUS',
        field:        'is_on_track',
        width:        96,
        headerClass:  'ag-col-center',
        cellRenderer: StatusRenderer,
        cellStyle:    centeredCellStyle,
      },
    ],
    [favoriteTeamNames]
  );

  const rowClassRules = useMemo(
    () => ({
      'driver-pos-1':       (params: any) => params.data?.running_position === 1,
      'driver-pos-2-5':     (params: any) => params.data?.running_position >= 2 && params.data?.running_position <= 5,
      'driver-pos-6-10':    (params: any) => params.data?.running_position >= 6 && params.data?.running_position <= 10,
      'driver-pos-11-20':   (params: any) => params.data?.running_position >= 11 && params.data?.running_position <= 20,
      'driver-pos-21-plus': (params: any) => params.data?.running_position > 20,
      'driver-favorite':    (params: any) => favoriteDriverIds.includes(params.data?.driver_id ?? -1),
    }),
    [favoriteDriverIds]
  );

  const defaultColDef = useMemo<ColDef>(
    () => ({
      sortable:        true,
      resizable:       false,
      suppressMovable: false,
    }),
    []
  );

  // ── Render ─────────────────────────────────────────────────────────────────────
  const notConfigured = !R2_URLS.leaderboard || !R2_URLS.metadata || !R2_URLS.analytics || !R2_URLS.drivers;

  return (
    <div
      style={{
        display:       'flex',
        flexDirection: 'column',
        height:        '100vh',
        background:    '#07070f',
        overflow:      'hidden',
      }}
    >
      {/* ── Race Header ── */}
      <RaceHeader
        metadata={metadata}
        lastRefresh={lastRefresh}
        loading={loading}
        error={error}
      />

      {/* ── Config Warning Banner ── */}
      {notConfigured && (
        <div
          style={{
            margin:     '12px 16px 0',
            background: '#130a00',
            border:     '1px solid #f9731650',
            borderRadius: 6,
            padding:    '12px 16px',
          }}
        >
          <p
            style={{
              fontFamily:    'Barlow Condensed, sans-serif',
              fontWeight:    700,
              fontSize:      13,
              letterSpacing: '0.06em',
              color:         '#f97316',
              marginBottom:  6,
            }}
          >
            ⚠ R2 DATA SOURCES NOT CONFIGURED
          </p>
          <p
            style={{
              fontFamily: 'JetBrains Mono, monospace',
              fontSize:   11,
              color:      '#78350f',
              lineHeight: 1.8,
            }}
          >
            Copy <code style={{ color: '#fdba74' }}>.env.example</code> to{' '}
            <code style={{ color: '#fdba74' }}>.env</code> and set your Cloudflare R2 URLs:
            <br />
            <code style={{ color: '#d97706' }}>
              VITE_LEADERBOARD_URL=https://…/leaderboard.csv
            </code>
            <br />
            <code style={{ color: '#d97706' }}>
              VITE_METADATA_URL=https://…/race_metadata.csv
            </code>
            <br />
            <code style={{ color: '#d97706' }}>
              VITE_ANALYTICS_URL=https://…/analytics.csv
            </code>
            <br />
            <code style={{ color: '#d97706' }}>
              VITE_DRIVERS_URL=https://…/drivers.csv
            </code>
            <br />
            <code style={{ color: '#d97706' }}>
              VITE_REFRESH_INTERVAL_MS=5000
            </code>
          </p>
        </div>
      )}

      {/* ── Favorite Selects ── */}
      {leaderboard.length > 0 && (
        <div
          style={{
            padding:        '12px 16px',
            borderBottom:   '1px solid #1a1a2e',
            background:     '#0a0a14',
            display:        'flex',
            gap:            12,
            alignItems:     'flex-start',
            flexWrap:       'wrap',
          }}
        >
          <div style={{ flex: '1 1 320px', minWidth: 0 }}>
            <FavoriteDriversSelect
              drivers={leaderboard}
              selectedDriverIds={favoriteDriverIds}
              onSelectionChange={setFavoriteDriverIds}
            />
          </div>
          <div style={{ flex: '1 1 320px', minWidth: 0 }}>
            <FavoriteTeamsSelect
              teams={availableTeams}
              selectedTeamNames={favoriteTeamNames}
              onSelectionChange={setFavoriteTeamNames}
            />
          </div>
        </div>
      )}

      {/* ── AG Grid ── */}
      <div
        className="ag-theme-balham-dark"
        style={{
          flex:     1,
          overflow: 'hidden',
          marginTop: notConfigured ? 12 : 0,
        }}
      >
        <AgGridReact<LeaderboardRow>
          rowData={leaderboard}
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          rowClassRules={rowClassRules}
          getRowId={getRowId}
          animateRows
          rowHeight={30}
          headerHeight={50}
          context={gridContext}
          suppressScrollOnNewData
          suppressRowHoverHighlight={true}
          noRowsOverlayComponent={() => (
            <span
              style={{
                fontFamily:    'Barlow Condensed, sans-serif',
                fontSize:      14,
                letterSpacing: '0.1em',
                color:         '#276cdb',
              }}
            >
              {notConfigured
                ? 'Configure R2 URLs to load race data'
                : 'Awaiting race data…'}
            </span>
          )}
        />
      </div>
    </div>
  );
}
