# ImmiJournal

A journaling app for your Immich photo library

## Features

- Write journal entries about individual photos or groups of photos
- Browse your Immich photo library in a grid layout
- Multi-select photos to write a single group journal entry
- Chronological journal feed (diary-style)
- Group entries display a horizontal scrollable row of photos
- Edit and delete entries at any time
- Immich API key stays server-side (never exposed to browser)
- Optional app password to restrict access on your local network

## Requirements

- Running Immich server (local network, self-hosted)
- Immich API key (Immich → Account Settings → API Keys)
- Docker

## How to Use

- **Journal tab** — chronological feed of all entries
- **Photos tab** — browse Immich library
  - Click a photo → write a single-photo entry
  - Click "Select Multiple" → check photos → "Write Entry" for a group
- **Writing** — optional title + your thoughts → Save
- **Entry detail** — click any feed card → full view with Edit/Delete
- **Multi-photo entries** — horizontal scrollable row; click any image for full-screen

---

## 🔒 Security

### App Password (Recommended)

By default, anyone on your local network who can reach the app's port can use it. To restrict access, set an `APP_PASSWORD` in your `.env`:

```env
APP_PASSWORD=your_password_here
```

When set:
- Visiting the app redirects to a login page
- A session cookie (HttpOnly, SameSite=Strict) is issued on successful login and lasts 30 days
- All API routes return `401 Unauthorized` without a valid session
- Removing `APP_PASSWORD` disables auth entirely (backwards compatible)

### What's Protected by Default

| Concern | Status |
|---|---|
| Immich API key exposed to browser | ✅ Never — server-side only |
| API key committed to Git | ✅ `.env` is gitignored |
| Unauthorized access from local network | ⚠️ Set `APP_PASSWORD` to restrict |

---

## 🌉 Network Setup

```
Your Browser  ──→  http://192.168.1.180:8421  ──→  ImmiJournal
                                                          │
                                                          ↓
                                               http://192.168.1.180:8080
                                                       Immich
```

Both services run on your Unraid server's main bridge network. ImmiJournal communicates with Immich via your server's LAN IP — no special Docker networking required.

---

## 🎯 Unraid Deployment Guide

### Pre-Configured Defaults

| Setting | Value |
|---|---|
| Unraid Server IP | `192.168.1.180` |
| Immich URL | `http://192.168.1.180:8080/api` |
| ImmiJournal Port | `8421` |
| Data Directory | `/mnt/user/appdata/immijournal` |
| Network Mode | `bridge` |

### Quick Start

#### 1. Copy the project to your Unraid server

```bash
# Connect via SSH or use the Unraid terminal
cd /mnt/user/appdata/

git clone https://github.com/your-repo/immijournal.git immijournal
cd immijournal
```

#### 2. Configure your environment

```bash
cp .env.example .env
nano .env
```

Fill in your values:

```env
# Required: your Immich API key (Immich → Account Settings → API Keys)
IMMICH_API_KEY=your_actual_api_key_here

# Recommended: restrict access with a password
APP_PASSWORD=your_password_here

# Optional: override Immich URL if different from default
# IMMICH_BASE_URL=http://192.168.1.180:8080/api

# Optional: set file ownership to match your Unraid user
# Run `id` in the Unraid terminal to find your PUID/PGID
# Defaults to 99/100 (nobody/users), which works for most setups
# PUID=99
# PGID=100
```

Save: `Ctrl+X` → `Y` → `Enter`

#### 3. Deploy

```bash
docker compose up -d --build
```

Wait ~30 seconds for the container to start.

#### 4. Access ImmiJournal

```
http://192.168.1.180:8421
```

### PUID / PGID (File Permissions)

Unraid uses user/group IDs to control file ownership. By default this app runs as `99/100` (`nobody/users`), which works for most Unraid setups.

If your Immich library or appdata folder is owned by a different user, match the IDs:

```bash
# Find your user's IDs in the Unraid terminal
id
```

Then set them in `.env`:

```env
PUID=1000
PGID=1000
```

The container will create `/mnt/user/appdata/immijournal/immijournal.db` owned by this user.

### Volume / Data Persistence

Data is stored at `/mnt/user/appdata/immijournal` on the host, mapped to `/data` inside the container.

```yaml
volumes:
  - /mnt/user/appdata/immijournal:/data
```

- **Database file:** `/mnt/user/appdata/immijournal/immijournal.db`
- **Backups:** copy that directory
- **Migration:** move the directory and update the volume path in `docker-compose.yml`

### Updating

```bash
cd /mnt/user/appdata/immijournal
git pull
docker compose up -d --build
```

---

## 🔧 Troubleshooting

**Cannot reach Immich server**

```bash
# Verify config
cat .env | grep IMMICH_BASE_URL

# Test from host
curl http://192.168.1.180:8080/api/server-info

# Test from inside the container
docker exec -it immijournal curl http://192.168.1.180:8080/api/server-info

# Check firewall allows port 8080
telnet 192.168.1.180 8080

# Verify Immich is running
docker ps | grep immich
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

# Change port in docker-compose.yml, then recreate
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
pip install -r requirements.txt
```

#### 4. Configure environment

```bash
cp .env.example .env
# Fill in your Immich server details
```

#### 5. Start the dev server

```bash
uvicorn backend.main:app --reload
```

Open: [http://localhost:8000](http://localhost:8000)

**Tips:**
- Hot reload is on by default — save a file and the server restarts
- API endpoints: `GET /api/health`, `GET /api/journal/entries`, `POST /api/journal/entries`
- Port 8000 in use? `uvicorn backend.main:app --port 8001 --reload`
