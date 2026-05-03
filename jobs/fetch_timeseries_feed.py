import csv
import io
import json
import os
from collections import defaultdict
from datetime import datetime, timezone

try:
    import boto3
except ImportError:  # pragma: no cover - available in Lambda, not always locally
    boto3 = None

try:
    import urllib3
except ImportError:  # pragma: no cover - available in Lambda, not always locally
    urllib3 = None


class TimeseriesFeedToR2:
    def __init__(self, live_feed_url, r2_config):
        if urllib3 is None:
            raise RuntimeError("urllib3 is required to run this job")

        self.live_feed_url = live_feed_url
        self.r2_config = r2_config
        self.base_url = (
            f"https://api.cloudflare.com/client/v4/accounts/"
            f"{r2_config['account_id']}/r2/buckets/{r2_config['bucket']}/objects"
        )
        self.headers = {
            "Authorization": f"Bearer {r2_config['api_token']}",
            "Content-Type": "application/octet-stream",
        }
        self.http = urllib3.PoolManager()
        self.timeseries_key = r2_config.get("timeseries_key", "timeseries.csv")
        self.max_laps_per_driver = int(r2_config.get("max_laps_per_driver", 3))
        self.timeseries_public_url = r2_config.get(
            "timeseries_public_url",
            "https://pub-c40331d1ffaa483a8c55e70a0acd246f.r2.dev/timeseries.csv",
        )
        self.verify_connection()

    def verify_connection(self):
        """Verify R2 connection and permissions."""
        try:
            test_url = (
                f"https://api.cloudflare.com/client/v4/accounts/"
                f"{self.r2_config['account_id']}/r2/buckets"
            )
            test_headers = {
                "Authorization": f"Bearer {self.r2_config['api_token']}",
                "Content-Type": "application/json",
            }

            response = self.http.request("GET", test_url, headers=test_headers, timeout=10)

            if response.status == 200:
                print("R2 API connection verified successfully")
            else:
                print(
                    f"R2 API connection warning: {response.status} - "
                    f"{response.data.decode('utf-8')}"
                )
                print("Proceeding anyway - this might be due to limited permissions")
        except Exception as exc:
            print(f"Warning: Could not verify R2 connection: {exc}")
            print("Proceeding anyway...")

    def fetch_live_feed(self):
        """Fetch data from the live feed endpoint."""
        try:
            response = self.http.request("GET", self.live_feed_url, timeout=30)
            if response.status == 200:
                return json.loads(response.data.decode("utf-8"))

            print(f"Error fetching live feed: HTTP {response.status}")
            return None
        except Exception as exc:
            print(f"Error fetching live feed: {exc}")
            return None

    def fetch_r2_object(self, filename):
        """Fetch an existing R2 object if it exists."""
        try:
            if filename != self.timeseries_key:
                raise ValueError(f"Unsupported object key for public fetch: {filename}")

            response = self.http.request("GET", self.timeseries_public_url, timeout=30)

            if response.status == 200:
                content = response.data.decode("utf-8")
                print(
                    f"Fetched {filename} from R2: "
                    f"status=200, bytes={len(content.encode('utf-8'))}"
                )
                return content

            if response.status == 404:
                print(f"R2 object not found: {filename} (status=404)")
                return None

            print(
                f"Warning: Could not fetch {filename} from R2: "
                f"{response.status} - {response.data.decode('utf-8')}"
            )
            return None
        except Exception as exc:
            print(f"Warning: Could not fetch {filename} from R2: {exc}")
            return None

    def upload_to_r2(self, filename, content, content_type="text/csv"):
        """Upload content to R2 using Cloudflare API."""
        try:
            url = f"{self.base_url}/{filename}"
            upload_headers = self.headers.copy()
            upload_headers.update(
                {
                    "Content-Type": content_type,
                    "Cache-Control": "public, max-age=30",
                }
            )

            if isinstance(content, str):
                content_bytes = content.encode("utf-8")
            else:
                content_bytes = content

            print(f"Uploading {filename} to R2: bytes={len(content_bytes)}")

            response = self.http.request(
                "PUT",
                url,
                body=content_bytes,
                headers=upload_headers,
                timeout=60,
            )

            if response.status in [200, 201]:
                print(f"Successfully uploaded {filename} to R2")
                return True

            print(
                f"Error uploading {filename} to R2: {response.status} - "
                f"{response.data.decode('utf-8')}"
            )
            return False
        except Exception as exc:
            print(f"Error uploading {filename} to R2: {exc}")
            return False

    def create_csv_string(self, headers, rows):
        """Create CSV string from headers and rows."""
        try:
            output = io.StringIO()
            writer = csv.writer(output)
            writer.writerow(headers)
            writer.writerows(rows)
            csv_text = output.getvalue()
            print(
                "Created CSV string: "
                f"rows={len(rows)}, bytes={len(csv_text.encode('utf-8'))}"
            )
            return csv_text
        except Exception as exc:
            print(f"Error creating CSV string: {exc}")
            return None

    def parse_csv(self, csv_text):
        """Parse a CSV into a list of dictionaries with basic type coercion."""
        if not csv_text:
            return []

        reader = csv.DictReader(io.StringIO(csv_text))
        rows = []
        for raw_row in reader:
            row = {}
            for key, value in raw_row.items():
                if value is None:
                    row[key] = None
                    continue

                stripped = value.strip()
                if stripped == "":
                    row[key] = ""
                elif stripped.lower() == "true":
                    row[key] = True
                elif stripped.lower() == "false":
                    row[key] = False
                else:
                    try:
                        if "." in stripped:
                            number = float(stripped)
                            row[key] = int(number) if number.is_integer() else number
                        else:
                            row[key] = int(stripped)
                    except ValueError:
                        row[key] = stripped
            rows.append(row)
        return rows

    def normalize_timestamp(self, raw_timestamp):
        """Return an ISO-8601 UTC timestamp string."""
        if isinstance(raw_timestamp, str) and raw_timestamp:
            return raw_timestamp
        return datetime.now(timezone.utc).isoformat()

    def extract_snapshot_rows(self, data, timestamp):
        """Flatten the current live feed into per-driver time series rows."""
        lap_number = data.get("lap_number", "")
        series_id = data.get("series_id", "")
        track_id = data.get("track_id", "")
        track_name = data.get("track_name", "")
        run_id = data.get("run_id", "")
        race_id = data.get("race_id", "")
        run_name = data.get("run_name", "")
        flag_state = data.get("flag_state", "")
        time_of_day_os = data.get("time_of_day_os", "")

        rows = []
        for vehicle in data.get("vehicles", []):
            driver = vehicle.get("driver", {}) or {}
            rows.append(
                {
                    "recorded_at": timestamp,
                    "lap_number": lap_number,
                    "series_id": series_id,
                    "track_id": track_id,
                    "track_name": track_name,
                    "run_id": run_id,
                    "run_name": run_name,
                    "race_id": race_id,
                    "flag_state": flag_state,
                    "time_of_day_os": time_of_day_os,
                    "driver_id": driver.get("driver_id", ""),
                    "full_name": driver.get("full_name", ""),
                    "vehicle_number": vehicle.get("vehicle_number", ""),
                    "vehicle_manufacturer": vehicle.get("vehicle_manufacturer", ""),
                    "starting_position": vehicle.get("starting_position", ""),
                    "running_position": vehicle.get("running_position", ""),
                    "delta": vehicle.get("delta", ""),
                    "last_lap_time": vehicle.get("last_lap_time", ""),
                    "last_lap_speed": vehicle.get("last_lap_speed", ""),
                    "laps_completed": vehicle.get("laps_completed", ""),
                    "fastest_laps_run": vehicle.get("fastest_laps_run", ""),
                    "position_differential_last_10_percent": vehicle.get(
                        "position_differential_last_10_percent", ""
                    ),
                    "is_on_track": vehicle.get("is_on_track", ""),
                    "is_on_dvp": vehicle.get("is_on_dvp", ""),
                }
            )
        return rows

    def merge_timeseries(self, existing_rows, new_rows):
        """Merge snapshot rows and keep the latest `max_laps_per_driver` laps per driver."""
        merged = {}

        for row in existing_rows + new_rows:
            driver_id = str(row.get("driver_id", ""))
            lap_number = row.get("lap_number", "")
            try:
                lap_key = int(lap_number)
            except (TypeError, ValueError):
                lap_key = -1

            # Keep one row per driver/lap. A later snapshot for the same lap
            # replaces the earlier one, but older laps remain available.
            key = (driver_id, lap_key)
            existing = merged.get(key)
            if existing is None:
                merged[key] = row
                continue

            existing_ts = existing.get("recorded_at", "")
            row_ts = row.get("recorded_at", "")
            if row_ts >= existing_ts:
                merged[key] = row

        per_driver = defaultdict(list)
        for row in merged.values():
            driver_id = str(row.get("driver_id", ""))
            try:
                lap_number = int(row.get("lap_number", -1))
            except (TypeError, ValueError):
                lap_number = -1
            per_driver[driver_id].append((lap_number, row.get("recorded_at", ""), row))

        filtered_rows = []
        def driver_sort_key(value):
            if str(value).isdigit():
                return (0, int(value))
            return (1, str(value))

        for driver_id in sorted(per_driver.keys(), key=driver_sort_key):
            rows = per_driver[driver_id]
            rows.sort(key=lambda item: (item[0], item[1]), reverse=True)
            filtered_rows.extend(item[2] for item in rows[: self.max_laps_per_driver])

        return filtered_rows

    def create_timeseries_csv(self, data, timestamp):
        """Create the rolling per-driver time series CSV content."""
        try:
            headers = [
                "recorded_at",
                "lap_number",
                "series_id",
                "track_id",
                "track_name",
                "run_id",
                "run_name",
                "race_id",
                "flag_state",
                "time_of_day_os",
                "driver_id",
                "full_name",
                "vehicle_number",
                "vehicle_manufacturer",
                "starting_position",
                "running_position",
                "delta",
                "last_lap_time",
                "last_lap_speed",
                "laps_completed",
                "fastest_laps_run",
                "position_differential_last_10_percent",
                "is_on_track",
                "is_on_dvp",
            ]

            existing_csv = self.fetch_r2_object(self.timeseries_key)
            existing_rows = self.parse_csv(existing_csv)
            snapshot_rows = self.extract_snapshot_rows(data, timestamp)
            merged_rows = self.merge_timeseries(existing_rows, snapshot_rows)

            print(
                "Timeseries merge counts: "
                f"existing_rows={len(existing_rows)}, "
                f"snapshot_rows={len(snapshot_rows)}, "
                f"merged_rows={len(merged_rows)}"
            )

            ordered_rows = []
            for row in merged_rows:
                ordered_rows.append(
                    [
                        row.get("recorded_at", ""),
                        row.get("lap_number", ""),
                        row.get("series_id", ""),
                        row.get("track_id", ""),
                        row.get("track_name", ""),
                        row.get("run_id", ""),
                        row.get("run_name", ""),
                        row.get("race_id", ""),
                        row.get("flag_state", ""),
                        row.get("time_of_day_os", ""),
                        row.get("driver_id", ""),
                        row.get("full_name", ""),
                        row.get("vehicle_number", ""),
                        row.get("vehicle_manufacturer", ""),
                        row.get("starting_position", ""),
                        row.get("running_position", ""),
                        row.get("delta", ""),
                        row.get("last_lap_time", ""),
                        row.get("last_lap_speed", ""),
                        row.get("laps_completed", ""),
                        row.get("fastest_laps_run", ""),
                        row.get("position_differential_last_10_percent", ""),
                        row.get("is_on_track", ""),
                        row.get("is_on_dvp", ""),
                    ]
                )

            return self.create_csv_string(headers, ordered_rows)
        except Exception as exc:
            print(f"Error creating timeseries CSV: {exc}")
            return None

    def print_public_urls(self):
        """Print the public URL for the timeseries CSV."""
        try:
            bucket_name = self.r2_config["bucket"]
            custom_domain = self.r2_config.get("custom_domain")

            if custom_domain:
                base_url = f"https://{custom_domain}"
            else:
                account_id = self.r2_config["account_id"]
                base_url = f"https://pub-{account_id}.r2.dev/{bucket_name}"

            print("\n" + "=" * 60)
            print("PUBLIC URL FOR TIMESERIES ACCESS:")
            print("=" * 60)
            print(f"Timeseries CSV: {base_url}/{self.timeseries_key}")
            print("=" * 60)
            print("Note: Ensure the R2 bucket has public access configured")
            print("=" * 60 + "\n")
        except Exception as exc:
            print(f"Error generating public URL: {exc}")

    def update_r2(self):
        """Fetch live feed data and update the rolling timeseries CSV."""
        try:
            print("Fetching live feed data...")
            data = self.fetch_live_feed()

            if not data:
                print("No data received from live feed")
                return False

            timestamp = self.normalize_timestamp(data.get("time_of_day_os"))
            timeseries_csv = self.create_timeseries_csv(data, timestamp)
            if not timeseries_csv:
                print("Failed to create timeseries CSV")
                return False

            print(f"Uploading rebuilt timeseries CSV to R2 key: {self.timeseries_key}")
            success = self.upload_to_r2(self.timeseries_key, timeseries_csv)
            if success:
                verify_csv = self.fetch_r2_object(self.timeseries_key)
                verify_rows = self.parse_csv(verify_csv)
                print(
                    "Post-upload verification: "
                    f"bytes={len((verify_csv or '').encode('utf-8'))}, "
                    f"rows={len(verify_rows)}"
                )
                self.print_public_urls()
                print(f"Successfully updated timeseries CSV at {timestamp}")

            return success
        except Exception as exc:
            print(f"Error in update_r2: {exc}")
            return False

    def run_once(self):
        """Run a single update - idempotent for cron execution."""
        try:
            success = self.update_r2()
            if success:
                print("Update completed successfully")
                return 0

            print("Update failed")
            return 1
        except Exception as exc:
            print(f"Error in run_once: {exc}")
            return 1


def lambda_handler(event, context):
    """Main function to run the timeseries feed to R2 updater."""
    if boto3 is None:
        raise RuntimeError("boto3 is required to run this Lambda handler")

    live_feed_url = os.getenv("LIVE_FEED_URL", "https://cf.nascar.com/live/feeds/live-feed.json")
    ssm = boto3.client("ssm")
    parameter_store_key_name = os.getenv("PARAMETER_STORE_KEY_NAME")

    response = ssm.get_parameter(
        Name=parameter_store_key_name,
        WithDecryption=False,
    )

    api_key = response["Parameter"]["Value"]

    r2_config = {
        "account_id": os.getenv("CLOUDFLARE_ACCOUNT_ID"),
        "api_token": api_key,
        "bucket": os.getenv("R2_BUCKET_NAME", "nascar-live-feed"),
        "custom_domain": os.getenv("R2_CUSTOM_DOMAIN"),
        "timeseries_key": os.getenv("R2_TIMESERIES_KEY", "timeseries.csv"),
        "max_laps_per_driver": os.getenv("MAX_LAPS_PER_DRIVER", "3"),
        "timeseries_public_url": os.getenv(
            "R2_TIMESERIES_PUBLIC_URL",
            "https://pub-c40331d1ffaa483a8c55e70a0acd246f.r2.dev/timeseries.csv",
        ),
    }

    updater = TimeseriesFeedToR2(live_feed_url, r2_config)
    updater.run_once()
