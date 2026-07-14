# Supabase 上线步骤（七牛 + DeepSeek + Edge API）

## 1. 建表 + 种子（SQL Editor）

1. 打开 https://supabase.com/dashboard/project/yzrcljcoiprjeystcabn/sql/new
2. 粘贴并执行仓库文件：`supabase/APPLY_IN_DASHBOARD.sql`
3. 成功后应有用户 `admin`、`xcy002` 与两个站点

## 2. Edge Function 密钥（Project Settings → Edge Functions → Secrets）

按 `supabase/secrets.example.env` 添加：

- `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET`
- `QINIU_*`
- `DEEPSEEK_API_KEY`

`SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` 一般已自动注入。

## 3. 部署 Edge Function `api`

在安装了 Supabase CLI 的机器上（或 Dashboard → Edge Functions → Deploy）：

```bash
npx supabase login
npx supabase link --project-ref yzrcljcoiprjeystcabn
npx supabase functions deploy api --no-verify-jwt
```

健康检查：

`https://yzrcljcoiprjeystcabn.supabase.co/functions/v1/api/health`

（请求头需带 `apikey: <ANON_KEY>`）

## 4. Vercel 前端环境变量

H5 / PC 均设置：

- `VITE_API_BASE=https://yzrcljcoiprjeystcabn.supabase.co/functions/v1/api`
- `VITE_SUPABASE_ANON_KEY=<你的 anon/publishable key>`

然后 Redeploy。

## 5. 账号

- H5：`xcy002` / `123456`
- PC：`admin` / `admin123`
