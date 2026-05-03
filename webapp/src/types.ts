// ─── Data shapes from R2 CSVs ──────────────────────────────────────────────────

export interface LeaderboardRow extends Record<string, unknown> {
  last_lap_time: number;
  pace_grade?: string;
  vehicle_manufacturer: string; // 'Chv' | 'Frd' | 'Tyt'
  vehicle_number: string;
  driver_id: number;
  full_name: string; // may contain * (i) # decorators
  starting_position: number;
  running_position: number;
  delta: number; // seconds behind leader (positive) | laps down (negative integer)
  is_on_track: boolean;
  is_on_dvp: boolean; // damage / vehicle program penalty
  // Computed on each refresh
  positionDelta: number; // positive = gained positions, negative = lost
}

export interface RaceMetadata extends Record<string, unknown> {
  lap_number: number;
  flag_state: number;
  laps_in_race: number;
  run_name: string;
  race_id: number;
  run_id: number;
  series_id: number; // 1=Cup, 2=Xfinity, 3=Trucks
  time_of_day_os: string; // ISO timestamp
  track_id: number;
  track_name: string;
}

// Passed to every AG Grid cell renderer via the `context` prop
export interface GridContext {
  badgeImages: Map<string, string>; // vehicleNumber → object URL
  seriesId: number;
}
