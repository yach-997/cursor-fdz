#!/usr/bin/env bash
# Cloud Agent 每次启动执行（幂等）：
#   1) 拉起基础设施（PostgreSQL / Redis / MinIO）并保证数据库角色/桶存在；
#   2) 后台启动三个应用开发服务（后端 API + PC 前端 + H5 前端）。
# 幂等：已在运行的服务不会重复启动。
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# 载入根目录 .env（若存在），供本脚本内的默认值使用
if [ -f "$REPO_ROOT/.env" ]; then
  set -a; . "$REPO_ROOT/.env"; set +a
fi

log() { echo "[start] $*"; }

# 端口是否已有进程监听（curl 不带 -f：拿到任何 HTTP 响应即视为占用，
# 连接被拒绝时退出码非 0。localhost 会同时覆盖 IPv4/IPv6）。
port_in_use() {
  curl -s -o /dev/null --max-time 2 "http://localhost:$1/" 2>/dev/null
}

# 端口空闲则在后台启动一个开发服务
start_dev_server() {
  local name="$1" dir="$2" port="$3" cmd="$4"
  if port_in_use "$port"; then
    log "${name} 已在端口 ${port} 运行，跳过"
    return 0
  fi
  log "启动 ${name} (端口 ${port})"
  ( cd "$REPO_ROOT/$dir" && nohup bash -lc "$cmd" >"/tmp/${name}.log" 2>&1 & )
}

DB_USER="${POSTGRES_USER:-inspection}"
DB_PASS="${POSTGRES_PASSWORD:-inspection123}"
DB_NAME="${POSTGRES_DB:-inspection_db}"
MINIO_USER="${MINIO_ROOT_USER:-minioadmin}"
MINIO_PASS="${MINIO_ROOT_PASSWORD:-minioadmin123}"
MINIO_BUCKET="${MINIO_BUCKET:-inspection}"
MINIO_DATA="${MINIO_DATA_DIR:-/var/lib/minio/data}"

# 1. PostgreSQL
log "启动 PostgreSQL"
sudo service postgresql start || true
for i in $(seq 1 30); do
  sudo -u postgres pg_isready >/dev/null 2>&1 && break
  sleep 1
done
# 角色与数据库（幂等）
sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'" | grep -q 1 \
  || sudo -u postgres psql -c "CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASS}';"
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1 \
  || sudo -u postgres createdb -O "${DB_USER}" "${DB_NAME}"

# 2. Redis
log "启动 Redis"
sudo service redis-server start || true

# 3. MinIO（后台常驻，幂等：已在运行则跳过）
if ! pgrep -x minio >/dev/null 2>&1; then
  log "启动 MinIO"
  mkdir -p "${MINIO_DATA}"
  MINIO_ROOT_USER="${MINIO_USER}" MINIO_ROOT_PASSWORD="${MINIO_PASS}" \
    nohup minio server "${MINIO_DATA}" --console-address ":9001" \
    >/tmp/minio.log 2>&1 &
fi
# 等待 MinIO 就绪后创建桶（幂等）
for i in $(seq 1 30); do
  curl -fsS http://127.0.0.1:9000/minio/health/ready >/dev/null 2>&1 && break
  sleep 1
done
if command -v mc >/dev/null 2>&1; then
  mc alias set local http://127.0.0.1:9000 "${MINIO_USER}" "${MINIO_PASS}" >/dev/null 2>&1 || true
  mc mb --ignore-existing "local/${MINIO_BUCKET}" >/dev/null 2>&1 || true
  mc anonymous set download "local/${MINIO_BUCKET}" >/dev/null 2>&1 || true
fi

log "基础设施就绪 (PostgreSQL / Redis / MinIO)"

# 4. 应用开发服务（后台常驻，幂等）
start_dev_server "backend"     "backend"     3000 "npm run start:dev"
start_dev_server "frontend-pc" "frontend-pc" 5173 "npm run dev"
start_dev_server "frontend-h5" "frontend-h5" 5175 "npm run dev"

log "开发服务已启动：后端 http://localhost:3000/api ，PC http://localhost:5173 ，H5 http://localhost:5175/m/login"
