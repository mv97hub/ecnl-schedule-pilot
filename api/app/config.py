"""Database settings from the project-root .env.

The URL is built from POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_HOST,
POSTGRES_PORT, and POSTGRES_DB. The sample DATABASE_URL in .env.example
is not used.
"""

from pathlib import Path
from urllib.parse import quote_plus

PROJECT_ROOT = Path(__file__).resolve().parents[2]
ENV_PATH = PROJECT_ROOT / ".env"


def _parse_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.is_file():
        return values
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def build_database_url() -> str:
    env = _parse_env(ENV_PATH)
    missing = [key for key in ("POSTGRES_USER", "POSTGRES_PASSWORD", "POSTGRES_HOST", "POSTGRES_PORT", "POSTGRES_DB") if not env.get(key)]
    if missing:
        joined = ", ".join(missing)
        raise RuntimeError(f"Missing {joined} in {ENV_PATH}")

    user = quote_plus(env["POSTGRES_USER"])
    password = quote_plus(env["POSTGRES_PASSWORD"])
    host = env["POSTGRES_HOST"]
    port = env["POSTGRES_PORT"]
    database = quote_plus(env["POSTGRES_DB"])
    return f"postgresql+psycopg://{user}:{password}@{host}:{port}/{database}"
