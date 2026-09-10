#!/usr/bin/env bash
# Cloud Agent 每次启动执行：拉起基础设施服务并保证数据库/桶存在（幂等）。
# 应用进程（后端 API、PC/H5 前端）由 environment.json 的 terminals 负责。
set -euo pipefail

log() { echo "[start] $*"; }

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
