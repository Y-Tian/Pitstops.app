import csv
import io
import json
import os
from datetime import datetime, timezone

try:
    import boto3
except ImportError:  # pragma: no cover - available in Lambda, not always locally
    boto3 = None

try:
    import urllib3
except ImportError:  # pragma: no cover - available in Lambda, not always locally
    urllib3 = None


DRIVER_FIELD_ORDER = [
    "nascar_driver_id",
    "driver_id",
    "driver_series",
    "first_name",
    "last_name",
    "full_name",
    "series_logo",
    "short_name",
    "description",
    "dob",
    "dod",
    "hometown_city",
    "crew_chief",
    "hometown_state",
    "hometown_country",
    "rookie_year_series_1",
    "rookie_year_series_2",
    "rookie_year_series_3",
    "hobbies",
    "children",
    "twitter_handle",
    "residing_city",
    "residing_state",
    "residing_country",
    "badge",
    "badge_image",
    "manufacturer",
    "manufacturer_small",
    "team",
    "image",
    "image_small",
    "image_transparent",
    "secondaryimage",
    "firesuit_image",
    "firesuit_image_small",
    "career_stats",
    "driver_page",
    "age",
    "rank",
    "points",
    "points_behind",
    "no_wins",
    "poles",
    "top5",
    "top10",
    "laps_led",
    "stage_wins",
    "playoff_points",
    "playoff_rank",
    "integrated_sponsor_name",
    "integrated_sponsor",
    "integrated_sponsor_url",
    "silly_season_change",
    "silly_season_change_description",
    "driver_post_status",
    "driver_part_time",
]


class DriversFeedToR2:
    def __init__(self, drivers_feed_url, r2_config):
        if urllib3 is None:
            raise RuntimeError("urllib3 is required to run this job")

        self.drivers_feed_url = drivers_feed_url
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
        self.drivers_key = r2_config.get("drivers_key", "drivers.csv")
        self.drivers_public_url = r2_config.get(
            "drivers_public_url",
            f"https://pub-{r2_config['account_id']}.r2.dev/{r2_config['bucket']}/drivers.csv",
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

    def fetch_drivers_feed(self):
        """Fetch the drivers feed from NASCAR."""
        try:
            response = self.http.request("GET", self.drivers_feed_url, timeout=30)
            if response.status == 200:
                return json.loads(response.data.decode("utf-8"))

            print(f"Error fetching drivers feed: HTTP {response.status}")
            return None
        except Exception as exc:
            print(f"Error fetching drivers feed: {exc}")
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
            writer = csv.DictWriter(output, fieldnames=headers, extrasaction="ignore")
            writer.writeheader()
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

    def normalize_driver_rows(self, data):
        """Flatten the feed response into CSV-ready dictionaries."""
        response_rows = data.get("response", []) if isinstance(data, dict) else []
        if not isinstance(response_rows, list):
            return [], DRIVER_FIELD_ORDER

        headers = list(DRIVER_FIELD_ORDER)
        rows = []

        for row in response_rows:
            if not isinstance(row, dict):
                continue

            lower_row = {str(key).lower(): value for key, value in row.items()}

            for key in lower_row.keys():
                if key not in headers:
                    headers.append(key)

            normalized_row = {header: lower_row.get(header, "") for header in headers}
            rows.append(normalized_row)

        return rows, headers

    def print_public_url(self):
        """Print the public URL for accessing the CSV file."""
        try:
            print("\n" + "=" * 60)
            print("PUBLIC URL FOR FRONTEND ACCESS:")
            print("=" * 60)
            print(f"Drivers CSV: {self.drivers_public_url}")
            print("=" * 60)
            print("Note: Ensure your R2 bucket has public access configured")
            print("=" * 60 + "\n")
        except Exception as exc:
            print(f"Error generating public URL: {exc}")

    def update_r2(self):
        """Main method to fetch data and update R2."""
        try:
            print("Fetching drivers feed data...")
            data = self.fetch_drivers_feed()

            if not data:
                print("No data received from drivers feed")
                return False

            rows, headers = self.normalize_driver_rows(data)
            if not rows:
                print("No driver rows found in drivers feed")
                return False

            timestamp = datetime.now(timezone.utc)
            print(f"Prepared {len(rows)} driver rows at {timestamp.isoformat()}")

            drivers_csv = self.create_csv_string(headers, rows)
            if not drivers_csv:
                print("Failed to create drivers CSV")
                return False

            success = self.upload_to_r2(self.drivers_key, drivers_csv)
            if success:
                self.print_public_url()
                print(f"Successfully updated R2 at {timestamp.isoformat()}")
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
    """Main function to run the drivers feed to R2 updater."""
    drivers_feed_url = os.getenv(
        "DRIVERS_FEED_URL",
        "https://cf.nascar.com/cacher/drivers.json",
    )

    if boto3 is None:
        raise RuntimeError("boto3 is required to run this job in Lambda")

    ssm = boto3.client("ssm")
    parameter_store_key_name = os.getenv("PARAMETER_STORE_KEY_NAME")
    if not parameter_store_key_name:
        raise RuntimeError("PARAMETER_STORE_KEY_NAME is required")

    response = ssm.get_parameter(Name=parameter_store_key_name, WithDecryption=False)
    api_key = response["Parameter"]["Value"]

    r2_config = {
        "account_id": os.getenv("CLOUDFLARE_ACCOUNT_ID"),
        "api_token": api_key,
        "bucket": os.getenv("R2_BUCKET_NAME", "nascar-live-feed"),
        "custom_domain": os.getenv("R2_CUSTOM_DOMAIN"),
        "drivers_key": os.getenv("DRIVERS_R2_KEY", "drivers.csv"),
        "drivers_public_url": os.getenv("DRIVERS_PUBLIC_URL"),
    }

    if not r2_config["account_id"]:
        raise RuntimeError("CLOUDFLARE_ACCOUNT_ID is required")

    if not r2_config["drivers_public_url"]:
        r2_config["drivers_public_url"] = (
            f"https://pub-{r2_config['account_id']}.r2.dev/"
            f"{r2_config['bucket']}/{r2_config['drivers_key']}"
        )

    updater = DriversFeedToR2(drivers_feed_url, r2_config)
    updater.run_once()
