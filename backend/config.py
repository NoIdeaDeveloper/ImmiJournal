import os
from dotenv import load_dotenv

load_dotenv()

# Validate required environment variables
required_vars = ["IMMICH_BASE_URL", "IMMICH_API_KEY"]
missing_vars = [var for var in required_vars if var not in os.environ]
if missing_vars:
    raise RuntimeError(f"Missing required environment variables: {', '.join(missing_vars)}")

IMMICH_BASE_URL = os.environ["IMMICH_BASE_URL"]
IMMICH_API_KEY = os.environ["IMMICH_API_KEY"]
DATABASE_PATH = os.environ.get("DATABASE_PATH", "/data/immijournal.db")
APP_PASSWORD = os.environ.get("APP_PASSWORD")  # Optional; if unset, auth is disabled
SECURE_COOKIES = os.environ.get("SECURE_COOKIES", "false").lower() == "true"
