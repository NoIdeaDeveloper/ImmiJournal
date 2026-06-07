# ImmiJournal

**A journaling app for your Immich photo library.**

Write diary entries tied to your memories. Browse your Immich photos, select one or a group, and capture your thoughts alongside them.

[![CI](https://github.com/NoIdeaDeveloper/ImmiJournal/actions/workflows/docker.yml/badge.svg)](https://github.com/NoIdeaDeveloper/ImmiJournal/actions/workflows/docker.yml)
[![Docker Image](https://img.shields.io/badge/ghcr.io-immijournal-blue?logo=docker)](https://github.com/NoIdeaDeveloper/ImmiJournal/pkgs/container/immijournal)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## Features

- Write journal entries about individual photos or groups of photos
- Browse your Immich photo library in a grid layout
- Multi-select photos to write a single group journal entry
- Chronological journal feed (diary-style)
- Group entries display a horizontal scrollable row of photos
- Full-text search, tags, and statistics
- Edit and delete entries at any time
- Immich API key stays server-side (never exposed to browser)
- Optional app password to restrict access on your local network
- Dark, light, or system (auto) theme
- Export and import your journal as JSON

---

## Requirements

- Running [Immich](https://immich.app) server (local network, self-hosted)
- Immich API key (Immich → Account Settings → API Keys)
- Docker (or Unraid)

---

## Installation

### Option A — Unraid Community Apps (easiest)

1. Open your Unraid web UI → **Apps** tab
2. Search for **ImmiJournal**
3. Click **Install**, fill in your Immich URL and API key, click **Apply**

> **Not listed yet?** You can add the template manually:
> 1. In the Apps tab, click the **CA User Templates** button
> 2. Paste the raw template URL:
>    `https://raw.githubusercontent.com/NoIdeaDeveloper/ImmiJournal/main/unraid-template/ImmiJournal.xml`

---

### Option B — Docker Compose

```bash
# 1. Download the compose file
curl -O https://raw.githubusercontent.com/NoIdeaDeveloper/ImmiJournal/main/docker-compose.yml
curl -O https://raw.githubusercontent.com/NoIdeaDeveloper/ImmiJournal/main/.env.example

# 2. Configure
cp .env.example .env
# Edit .env with your Immich URL, API key, and optional password

# 3. Start
docker compose up -d

# Access at http://YOUR_SERVER_IP:8421
```

---

## 🔒 Security

### App Password (Recommended)

By default, anyone on your local network who can reach the app's port can use it. To restrict access, set `APP_PASSWORD` in your `.env`:

```env
APP_PASSWORD=your_password_here
```

When set:
- Visiting the app redirects to a login page
- A session cookie (HttpOnly, SameSite=Strict) is issued on successful login and lasts 30 days
- All API routes return `401 Unauthorized` without a valid session
- Removing `APP_PASSWORD` disables auth entirely (backwards compatible)

### What's Protected

| Concern | Status |
|---|---|
| Immich API key exposed to browser | ✅ Never — server-side only |
| API key committed to Git | ✅ `.env` is gitignored |
| Unauthorized access from local network | ⚠️ Set `APP_PASSWORD` to restrict |

---

## 🌉 Network Setup

```
Your Browser  ──→  http://YOUR_SERVER_IP:8421  ──→  ImmiJournal
                                                          │
                                                          ↓
                                              http://YOUR_SERVER_IP:8080
                                                        Immich
```

Both services run on your server's main bridge network. ImmiJournal communicates with Immich via your server's LAN IP — no special Docker networking required.

---

## 🎯 Unraid Deployment Guide

### Pre-Configured Defaults

| Setting | Value |
|---|---|
| Immich URL | `http://YOUR_SERVER_IP:8080/api` |
| ImmiJournal Port | `8421` |
| Data Directory | `/mnt/user/appdata/immijournal` |
| Network Mode | `bridge` |

### Manual Quick Start

#### 1. Configure your environment

```bash
cp .env.example .env
nano .env
```

Fill in your values:

```env
# Required: your Immich API key (Immich → Account Settings → API Keys)
IMMICH_API_KEY=your_actual_api_key_here

# Required: your Immich server API URL
IMMICH_BASE_URL=http://YOUR_SERVER_IP:8080/api

# Recommended: restrict access with a password
APP_PASSWORD=your_password_here

# Optional: set file ownership to match your Unraid user
# Run `id` in the Unraid terminal to find your PUID/PGID
# Defaults to 99/100 (nobody/users), which works for most setups
# PUID=99
# PGID=100
```

Save: `Ctrl+X` → `Y` → `Enter`

#### 2. Deploy

```bash
docker compose up -d
```

#### 3. Access ImmiJournal

```
http://YOUR_SERVER_IP:8421
```

### PUID / PGID (File Permissions)

Unraid uses user/group IDs to control file ownership. By default this app runs as `99/100` (`nobody/users`), which works for most Unraid setups.

If your appdata folder is owned by a different user, match the IDs:

```bash
# Find your user's IDs in the Unraid terminal
id
```

Then set them in `.env`:

```env
PUID=1000
PGID=1000
```

### Volume / Data Persistence

Data is stored at `/mnt/user/appdata/immijournal` on the host, mapped to `/data` inside the container.

- **Database file:** `immijournal.db`
- **Backups:** copy the entire appdata directory
- **Migration:** move the directory and update the volume path

### Updating

```bash
# Pull the latest image and recreate the container
docker compose pull
docker compose up -d
```

> **Upgrading from an earlier version?** If you previously used this app under the "Thoughtful Frame" name, your database may be named `thoughtful_frame.db`. Either rename the file:
> ```bash
> mv /mnt/user/appdata/immijournal/thoughtful_frame.db /mnt/user/appdata/immijournal/immijournal.db
> ```
> or add `DATABASE_PATH=/data/thoughtful_frame.db` to your `.env` to keep the old name.

---

## 🔧 Troubleshooting

**Cannot reach Immich server**

```bash
# Verify config
cat .env | grep IMMICH_BASE_URL

# Test from host (replace with your server IP)
curl http://YOUR_SERVER_IP:8080/api/server-info

# Test from inside the container
docker exec -it immijournal curl http://YOUR_SERVER_IP:8080/api/server-info
```

**Database permission errors**

```bash
# Fix permissions (replace 99:100 with your PUID:PGID)
chown -R 99:100 /mnt/user/appdata/immijournal
docker compose restart
```

**Port 8421 already in use**

```bash
# Find what's using it
netstat -tulnp | grep 8421

# Change the host port in docker-compose.yml (e.g. 8422:8000), then recreate
docker compose up -d --force-recreate
```

**Check container health**

```bash
# Overall status
docker ps

# Logs
docker logs immijournal
docker logs -f immijournal

# Health check status
docker inspect --format='{{.State.Health.Status}}' immijournal

# Manual health check
curl http://localhost:8421/api/health
```

---

## 📊 Health Check

The container checks `GET /api/health` every 30 seconds.

Example healthy response:

```json
{
  "healthy": true,
  "status": {
    "database": "ok",
    "immich": "ok",
    "application": "ok"
  }
}
```

---

## 💻 Local Development

#### 1. Install Python 3.12+

#### 2. Set up virtual environment

```bash
python -m venv .venv
source .venv/bin/activate        # Mac/Linux
# .venv\Scripts\activate         # Windows
```

#### 3. Install dependencies

```bash
pip install -r requirements.txt -r requirements-dev.txt
```

#### 4. Configure environment

```bash
cp .env.example .env
# Fill in your Immich server details
```

#### 5. Run tests

```bash
python -m pytest -q
```

#### 6. Start the dev server

```bash
uvicorn backend.main:app --reload
```

Open: [http://localhost:8000](http://localhost:8000)

---

## 🤝 Contributing

Bug reports and pull requests are welcome. Please open an issue first for significant changes so we can discuss the approach.

---

## License

MIT — see [LICENSE](LICENSE).
