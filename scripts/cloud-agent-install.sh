#!/usr/bin/env bash
# Cloud Agent 环境安装脚本（幂等）。
# 在仓库检出完成后执行：准备系统依赖、根目录 .env 与三个包的 node 依赖。
# 系统级服务（PostgreSQL / Redis / MinIO）通常已固化在环境快照中；
# 此处做一次“缺失即补装”的自愈式检查，保证在全新基础镜像上也能运行。
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

log() { echo "[install] $*"; }

# 1. 系统依赖：仅在缺失时安装，避免每次启动都跑 apt。
need_apt=()
command -v psql          >/dev/null 2>&1 || need_apt+=(postgresql)
command -v redis-server  >/dev/null 2>&1 || need_apt+=(redis-server)
command -v curl          >/dev/null 2>&1 || need_apt+=(curl ca-certificates)
if [ "${#need_apt[@]}" -gt 0 ]; then
  log "安装系统依赖: ${need_apt[*]}"
  sudo apt-get update -y
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y "${need_apt[@]}"
fi

# MinIO（对象存储，用于巡检照片上传）——单文件二进制，缺失即下载。
if ! command -v minio >/dev/null 2>&1; then
  log "安装 MinIO server"
  curl -fsSL https://dl.min.io/server/minio/release/linux-amd64/minio -o /tmp/minio
  sudo install -m 0755 /tmp/minio /usr/local/bin/minio && rm -f /tmp/minio
fi
if ! command -v mc >/dev/null 2>&1; then
  log "安装 MinIO client (mc)"
  curl -fsSL https://dl.min.io/client/mc/release/linux-amd64/mc -o /tmp/mc
  sudo install -m 0755 /tmp/mc /usr/local/bin/mc && rm -f /tmp/mc
fi

# 2. 根目录 .env：不存在则写入本地开发默认值（均为非敏感的本地默认凭据）。
if [ ! -f "$REPO_ROOT/.env" ]; then
  log "生成本地开发 .env"
  cat > "$REPO_ROOT/.env" <<'ENV'
NODE_ENV=development
BACKEND_PORT=3000
PC_PORT=8080
H5_PORT=8081
POSTGRES_USER=inspection
POSTGRES_PASSWORD=inspection123
POSTGRES_DB=inspection_db
POSTGRES_PORT=5432
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=inspection
DB_PASSWORD=inspection123
DB_DATABASE=inspection_db
DATABASE_URL=
DB_SYNC=true
DB_SSL=false
REDIS_HOST=localhost
REDIS_PORT=6379
MINIO_ROOT_USER=minioadmin
MINIO_ROOT_PASSWORD=minioadmin123
MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_USE_SSL=false
MINIO_BUCKET=inspection
MINIO_API_PORT=9000
MINIO_CONSOLE_PORT=9001
JWT_ACCESS_SECRET=inspection_access_secret_change_me_in_prod
JWT_REFRESH_SECRET=inspection_refresh_secret_change_me_in_prod
JWT_ACCESS_EXPIRES=2h
JWT_REFRESH_EXPIRES=7d
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin123
ADMIN_REAL_NAME=超级管理员
ADMIN_PHONE=13800000000
INSPECTION_RADIUS_METERS=500
INSPECTION_MAX_GPS_ACCURACY=200
VITE_API_BASE=
VITE_SUPABASE_ANON_KEY=
VITE_H5_URL=http://localhost:5175/m/login
CORS_ORIGINS=http://localhost:5173,http://localhost:5175,http://localhost:8080,http://localhost:8081
ENV
fi

# 3. Node 依赖：使用锁文件的可复现安装。
for pkg in backend frontend-pc frontend-h5; do
  log "npm ci ($pkg)"
  (cd "$REPO_ROOT/$pkg" && npm ci)
done

log "安装完成"
