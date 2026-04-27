# NASCAR Live Leaderboard

A real-time NASCAR leaderboard POC built with React + TypeScript + AG Grid.  
Polls Cloudflare R2 object storage every N seconds and displays live race data.

## Setup

### 1 — Install dependencies
```bash
npm install
```

### 2 — Configure your R2 data sources
```bash
cp .env.example .env
```

Edit `.env` and fill in your Cloudflare R2 public URLs:
```env
VITE_LEADERBOARD_URL=https://your-bucket.your-account.r2.cloudflarestorage.com/leaderboard.csv
VITE_METADATA_URL=https://your-bucket.your-account.r2.cloudflarestorage.com/race_metadata.csv
VITE_REFRESH_INTERVAL_MS=5000
```

> **R2 CORS:** Make sure your R2 bucket allows `GET` requests from your dev/production origin.  
> In the R2 dashboard → Bucket Settings → CORS Policy, add your origin.

### 3 — Start dev server
```bash
npm run dev
```

### 4 — Build for production
```bash
npm run build
npm run preview
```

---

## CSV Schemas

### `leaderboard.csv`
| Column | Type | Notes |
|---|---|---|
| `last_lap_time` | float | Lap time in seconds |
| `vehicle_manufacturer` | string | `Chv` \| `Frd` \| `Tyt` |
| `vehicle_number` | string | Car number |
| `driver_id` | int | Stable unique ID |
| `full_name` | string | May include `*`, `(i)`, `#` decorators |
| `starting_position` | int | Grid start position |
| `running_position` | int | Current race position |
| `delta` | float | Positive = seconds behind leader; negative integer = laps down |
| `is_on_track` | bool | `True` / `False` |
| `is_on_dvp` | bool | Damage/Vehicle Penalty flag |

### `race_metadata.csv`
| Column | Type | Notes |
|---|---|---|
| `lap_number` | int | Current lap |
| `flag_state` | int | 1=Green 2=Caution 3=Red 4=White 5=Checkered 8=Pace 9=Caution |
| `laps_in_race` | int | Total scheduled laps |
| `run_name` | string | Race name |
| `race_id` | int | |
| `run_id` | int | |
| `series_id` | int | 1=Cup 2=Xfinity 3=Trucks |
| `time_of_day_os` | ISO string | Timestamp from scoring system |
| `track_id` | int | |
| `track_name` | string | |

---

## Features
- **Live polling** — fetches both CSVs every `VITE_REFRESH_INTERVAL_MS` ms with `cache: no-store`
- **Position delta** — tracks each driver's position change between refreshes (▲ green / ▼ red)
- **Animated row reordering** — AG Grid's `animateRows` smoothly moves rows as positions change
- **Car badge images** — prefetched once on load from `cf.nascar.com/data/images/carbadges/`
- **Manufacturer pills** — color-coded CHV (gold) / FRD (blue) / TYT (red)
- **Driver decorators** — `i` badge for ineligible drivers, `R` for rookies
- **Gap formatting** — seconds for on-lead-lap cars, `–N Laps` for lapped cars
- **Flag indicator** — animated dot + colour-coded label for all flag states
- **Dark racing theme** — Barlow Condensed + JetBrains Mono + AG Grid Balham Dark
