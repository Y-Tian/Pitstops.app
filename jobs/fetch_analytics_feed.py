import csv
import io
import json
import math
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


class AnalyticsFeedToR2:
    def __init__(self, r2_config):
        if urllib3 is None:
            raise RuntimeError("urllib3 is required to run this job")

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
        self.analytics_key = r2_config.get("analytics_key", "analytics.csv")
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

    def fetch_r2_object(self, filename):
        """Fetch an existing R2 object if it exists."""
        try:
            if filename != self.timeseries_key:
                raise ValueError(f"Unsupported object key for public fetch: {filename}")

            response = self.http.request("GET", self.timeseries_public_url, timeout=30)

            if response.status == 200:
                content = response.data.decode("utf-8")
                print(
                    f"Fetched {filename} from public URL: "
                    f"bytes={len(content.encode('utf-8'))}"
                )
                return content

            if response.status == 404:
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
            return output.getvalue()
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

    def numeric_value(self, value):
        """Convert a CSV field into a float when possible."""
        if value in (None, ""):
            return None

        if isinstance(value, bool):
            return None

        if isinstance(value, (int, float)):
            return float(value)

        try:
            return float(str(value))
        except (TypeError, ValueError):
            return None

    def latest_driver_rows(self, rows):
        """Keep the latest rolling window rows per driver."""
        grouped = defaultdict(list)
        for row in rows:
            driver_id = str(row.get("driver_id", "")).strip()
            if not driver_id:
                continue

            try:
                lap_number = int(row.get("lap_number", -1))
            except (TypeError, ValueError):
                lap_number = -1

            recorded_at = str(row.get("recorded_at", ""))
            grouped[driver_id].append((lap_number, recorded_at, row))

        driver_windows = {}
        for driver_id, items in grouped.items():
            items.sort(key=lambda item: (item[0], item[1]), reverse=True)
            driver_windows[driver_id] = [item[2] for item in items[: self.max_laps_per_driver]]

        return driver_windows

    def grade_for_score(self, score_percent):
        """Map a percentile-style score to the requested pace grades."""
        if score_percent >= 95.0:
            return "S+"
        if score_percent >= 90.0:
            return "S"
        if score_percent >= 80.0:
            return "A"
        if score_percent >= 60.0:
            return "B"
        if score_percent >= 30.0:
            return "C"
        return "D"

    def build_analytics_rows(self, timeseries_rows):
        """Aggregate rolling timeseries rows into per-driver analytics rows."""
        driver_windows = self.latest_driver_rows(timeseries_rows)
        if not driver_windows:
            return []

        aggregated = []
        for driver_id, window_rows in driver_windows.items():
            latest_row = window_rows[0]
            lap_times = []
            lap_numbers = []

            for row in window_rows:
                lap_number = row.get("lap_number", "")
                if lap_number != "":
                    lap_numbers.append(str(lap_number))

                lap_time = self.numeric_value(row.get("last_lap_time"))
                if lap_time is not None and lap_time > 0:
                    lap_times.append(lap_time)

            avg_lap_time = sum(lap_times) / len(lap_times) if lap_times else None
            best_lap_time = min(lap_times) if lap_times else None

            aggregated.append(
                {
                    "driver_id": driver_id,
                    "full_name": latest_row.get("full_name", ""),
                    "vehicle_number": latest_row.get("vehicle_number", ""),
                    "vehicle_manufacturer": latest_row.get("vehicle_manufacturer", ""),
                    "latest_recorded_at": latest_row.get("recorded_at", ""),
                    "latest_lap_number": latest_row.get("lap_number", ""),
                    "laps_used": len(lap_times),
                    "window_lap_numbers": "|".join(lap_numbers),
                    "window_last_lap_times": "|".join(
                        str(row.get("last_lap_time", "")) for row in window_rows
                    ),
                    "avg_last_lap_time": avg_lap_time,
                    "best_lap_time": best_lap_time,
                    "starting_position": latest_row.get("starting_position", ""),
                    "running_position": latest_row.get("running_position", ""),
                    "delta": latest_row.get("delta", ""),
                    "last_lap_time": latest_row.get("last_lap_time", ""),
                    "last_lap_speed": latest_row.get("last_lap_speed", ""),
                    "is_on_track": latest_row.get("is_on_track", ""),
                    "is_on_dvp": latest_row.get("is_on_dvp", ""),
                    "race_id": latest_row.get("race_id", ""),
                    "run_id": latest_row.get("run_id", ""),
                    "run_name": latest_row.get("run_name", ""),
                    "series_id": latest_row.get("series_id", ""),
                    "track_id": latest_row.get("track_id", ""),
                    "track_name": latest_row.get("track_name", ""),
                    "time_of_day_os": latest_row.get("time_of_day_os", ""),
                }
            )

        sorted_rows = sorted(
            aggregated,
            key=lambda row: (
                row["avg_last_lap_time"] if row["avg_last_lap_time"] is not None else math.inf,
                -int(row["latest_lap_number"]) if str(row["latest_lap_number"]).isdigit() else 0,
                row["driver_id"],
            ),
        )

        total = len(sorted_rows)
        for index, row in enumerate(sorted_rows, start=1):
            if row["avg_last_lap_time"] is None:
                score_percent = 0.0
            elif total == 1:
                score_percent = 100.0
            else:
                score_percent = ((total - index) / (total - 1)) * 100.0

            pace_seconds_off_best = (
                row["avg_last_lap_time"] - sorted_rows[0]["avg_last_lap_time"]
                if row["avg_last_lap_time"] is not None and sorted_rows[0]["avg_last_lap_time"] is not None
                else ""
            )

            row["pace_rank"] = index
            row["pace_score_percent"] = round(score_percent, 2)
            row["pace_grade"] = self.grade_for_score(score_percent)
            row["pace_seconds_off_best"] = round(pace_seconds_off_best, 3) if pace_seconds_off_best != "" else ""

        return sorted_rows

    def create_analytics_csv(self, timeseries_rows):
        """Create analytics CSV content from the rolling time series."""
        try:
            headers = [
                "driver_id",
                "full_name",
                "vehicle_number",
                "vehicle_manufacturer",
                "latest_recorded_at",
                "latest_lap_number",
                "laps_used",
                "window_lap_numbers",
                "window_last_lap_times",
                "avg_last_lap_time",
                "best_lap_time",
                "pace_seconds_off_best",
                "pace_score_percent",
                "pace_rank",
                "pace_grade",
                "starting_position",
                "running_position",
                "delta",
                "last_lap_time",
                "last_lap_speed",
                "is_on_track",
                "is_on_dvp",
                "race_id",
                "run_id",
                "run_name",
                "series_id",
                "track_id",
                "track_name",
                "time_of_day_os",
            ]

            rows = self.build_analytics_rows(timeseries_rows)
            output_rows = []
            for row in rows:
                output_rows.append(
                    [
                        row.get("driver_id", ""),
                        row.get("full_name", ""),
                        row.get("vehicle_number", ""),
                        row.get("vehicle_manufacturer", ""),
                        row.get("latest_recorded_at", ""),
                        row.get("latest_lap_number", ""),
                        row.get("laps_used", ""),
                        row.get("window_lap_numbers", ""),
                        row.get("window_last_lap_times", ""),
                        row.get("avg_last_lap_time", ""),
                        row.get("best_lap_time", ""),
                        row.get("pace_seconds_off_best", ""),
                        row.get("pace_score_percent", ""),
                        row.get("pace_rank", ""),
                        row.get("pace_grade", ""),
                        row.get("starting_position", ""),
                        row.get("running_position", ""),
                        row.get("delta", ""),
                        row.get("last_lap_time", ""),
                        row.get("last_lap_speed", ""),
                        row.get("is_on_track", ""),
                        row.get("is_on_dvp", ""),
                        row.get("race_id", ""),
                        row.get("run_id", ""),
                        row.get("run_name", ""),
                        row.get("series_id", ""),
                        row.get("track_id", ""),
                        row.get("track_name", ""),
                        row.get("time_of_day_os", ""),
                    ]
                )

            return self.create_csv_string(headers, output_rows)
        except Exception as exc:
            print(f"Error creating analytics CSV: {exc}")
            return None

    def print_public_urls(self):
        """Print the public URL for the analytics CSV."""
        try:
            bucket_name = self.r2_config["bucket"]
            custom_domain = self.r2_config.get("custom_domain")

            if custom_domain:
                base_url = f"https://{custom_domain}"
            else:
                account_id = self.r2_config["account_id"]
                base_url = f"https://pub-{account_id}.r2.dev/{bucket_name}"

            print("\n" + "=" * 60)
            print("PUBLIC URL FOR ANALYTICS ACCESS:")
            print("=" * 60)
            print(f"Analytics CSV: {base_url}/{self.analytics_key}")
            print("=" * 60)
            print("Note: Ensure the R2 bucket has public access configured")
            print("=" * 60 + "\n")
        except Exception as exc:
            print(f"Error generating public URL: {exc}")

    def update_r2(self):
        """Read timeseries.csv, compute analytics, and write analytics.csv."""
        try:
            print("Fetching timeseries data...")
            timeseries_csv = self.fetch_r2_object(self.timeseries_key)
            if not timeseries_csv:
                print(f"No data received from {self.timeseries_key}")
                return False

            timeseries_rows = self.parse_csv(timeseries_csv)
            if not timeseries_rows:
                print("No parsable timeseries rows found")
                return False

            analytics_csv = self.create_analytics_csv(timeseries_rows)
            if not analytics_csv:
                print("Failed to create analytics CSV")
                return False

            success = self.upload_to_r2(self.analytics_key, analytics_csv)
            if success:
                self.print_public_urls()
                print(f"Successfully updated analytics CSV at {datetime.now(timezone.utc).isoformat()}")

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
    """Main function to run the analytics job."""
    if boto3 is None:
        raise RuntimeError("boto3 is required to run this Lambda handler")

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
        "analytics_key": os.getenv("R2_ANALYTICS_KEY", "analytics.csv"),
        "max_laps_per_driver": os.getenv("MAX_LAPS_PER_DRIVER", "3"),
        "timeseries_public_url": os.getenv(
            "R2_TIMESERIES_PUBLIC_URL",
            "https://pub-c40331d1ffaa483a8c55e70a0acd246f.r2.dev/timeseries.csv",
        ),
    }

    updater = AnalyticsFeedToR2(r2_config)
    updater.run_once()
