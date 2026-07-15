-- 修复 Supabase 中 pgcrypto 安装在 extensions schema 时，app_login 找不到 crypt()。
-- 可在 Supabase SQL Editor 中单独执行本文件，无需重新执行完整网关脚本。
alter function public.app_login(text, text, text)
  set search_path = public, extensions;

