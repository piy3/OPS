# way-maze

Multiplayer maze game — React frontend + Node.js/Socket.IO backend, served behind nginx.

## Local Development (without Docker)

```bash
# Backend
cd Backend && npm install && npm run dev   # starts on :3000

# Frontend (separate terminal)
cd Frontend && npm install && npm run dev  # starts on :8080
```

Set `VITE_DEV_URL=http://localhost:3000` in `Frontend/.env` (or export it) so the Socket.IO client connects to the backend.

## Docker

```bash
./docker-run.sh start          # production build, base path /
./docker-run.sh start-prod     # production build, base path /play-api/way-maze/
./docker-run.sh start-dev      # dev mode with hot-reload (foreground)
./docker-run.sh stop
./docker-run.sh status
./docker-run.sh logs-f         # follow logs
./docker-run.sh rebuild-prod   # full rebuild (no cache) with prod base path
./docker-run.sh help           # all commands
```

**Ports:**

| Service | Host | Container |
|---------|------|-----------|
| Backend (Node.js) | 8092 | 3000 |
| Frontend (nginx) | 8093 | 80 |

## Production Deployment

Hosted on the same EC2 instance as way-arena at `/mnt/ebs_volume/mini-games/way-maze`.

**Auto-deploy:** Pushing to `main` triggers the GitHub Actions workflow (`.github/workflows/deploy.yml`), which pulls the latest code on the self-hosted runner and runs `./docker-run.sh start-prod`.

**Manual deploy:**

```bash
ssh into the instance
cd /mnt/ebs_volume/mini-games/way-maze
git pull origin main
./docker-run.sh start-prod
```

**Base path:** In production the app is served at `/play-api/way-maze/`. This is configured via:
- Vite `base` path (build arg `ENV=prod`)
- nginx rewrite rules
- `BrowserRouter basename` in React
- Socket.IO client `path` option

## Logs

- **nginx:** `./logs/client/access.log` (JSON), `./logs/client/error.log`
- **server:** `./logs/server/server-YYYY-MM-DD.log` (JSON, production only)
- **Docker:** `docker logs waymaze-server`, `docker logs waymaze-client` (rotated: 50MB x 5 files)

## Port Map (all mini-games on same host)

| Game | Server | Client |
|------|--------|--------|
| way-arena | 8090 | 8091 |
| way-maze | 8092 | 8093 |
