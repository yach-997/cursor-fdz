# 智能设备巡检系统

光伏/储能设备现场巡检系统。PC 端供管理员和站长使用，H5 移动端供巡检工程师户外作业。

## 技术栈

| 端 | 技术 |
|----|------|
| PC 管理端 | React 18 + TypeScript + Ant Design 5 + Zustand + React Query + React Router 6 |
| H5 移动端 | React 18 + TypeScript + react-vant + Zustand + PWA + React Router 6 |
| 后端 | NestJS 10 + TypeORM + PostgreSQL 15 + Redis 7 |
| 存储 | MinIO |
| 部署 | Docker Compose |

## 快速启动

### 1. 基础设施（PostgreSQL + Redis + MinIO）

```bash
docker compose up -d postgres redis minio minio-init
```

### 2. 后端

```bash
cd backend
npm install
npm run start:dev
```

本地开发默认超级管理员：`admin` / `admin123`。生产环境必须显式配置 `ADMIN_PASSWORD`。

### 3. PC 管理端

```bash
cd frontend-pc
npm install
npm run dev
```

访问 http://localhost:5173

### 4. H5 移动端

```bash
cd frontend-h5
npm install
npm run dev
```

访问 http://localhost:5174/m/login

### 全量 Docker 部署

```bash
docker compose up -d --build
```

- API: http://localhost:3000/api
- PC: http://localhost:8080
- H5: http://localhost:8081
- MinIO Console: http://localhost:9001

## Phase 1 已完成

- Docker Compose 编排（PG + Redis + MinIO + NestJS + React PC + React H5）
- NestJS 骨架：全部 TypeORM Entity、JWT 认证、RolesGuard、DataScopeGuard
- Auth 模块：登录 / 登出 / me / 刷新令牌
- Site 模块：CRUD、任命站长、成员聘用/解聘
- PC：Login + Layout + 动态权限菜单 + 路由守卫
- H5：Login + 站点选择 + 底部 Tab + PWA

## 代码规范

- 数据库字段 `snake_case`，TypeScript 变量 `camelCase`
- API 统一返回 `{ code, message, data }`
- 注释使用中文
