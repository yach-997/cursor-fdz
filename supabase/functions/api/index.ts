/**
 * Nest 兼容 API 网关（Supabase Edge Function）
 * 前端 VITE_API_BASE = https://<project>.supabase.co/functions/v1/api
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import * as bcrypt from 'https://esm.sh/bcryptjs@2.4.3';
import { create, verify, getNumericDate } from 'https://deno.land/x/djwt@v3.0.2/mod.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
};

type JwtPayload = {
  sub: string;
  username: string;
  role: string;
  client: string;
  exp?: number;
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

function ok(data: unknown) {
  return json({ code: 200, message: 'success', data });
}

function fail(message: string, status = 400, code = status) {
  return json({ code, message, data: null }, status);
}

function sb() {
  const url = Deno.env.get('SUPABASE_URL')!;
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  return createClient(url, key, { auth: { persistSession: false } });
}

async function hmacKey(secret: string) {
  return await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

async function signTokens(user: { id: string; username: string }, role: string, client: string) {
  const accessSecret = Deno.env.get('JWT_ACCESS_SECRET') || 'inspection_access_secret_change_me_in_prod';
  const refreshSecret = Deno.env.get('JWT_REFRESH_SECRET') || 'inspection_refresh_secret_change_me_in_prod';
  const accessKey = await hmacKey(accessSecret);
  const refreshKey = await hmacKey(refreshSecret);
  const base = { sub: user.id, username: user.username, role, client };
  const accessToken = await create({ alg: 'HS256', typ: 'JWT' }, { ...base, exp: getNumericDate(60 * 60 * 2) }, accessKey);
  const refreshToken = await create({ alg: 'HS256', typ: 'JWT' }, { ...base, exp: getNumericDate(60 * 60 * 24 * 7) }, refreshKey);
  return { accessToken, refreshToken };
}

async function authUser(req: Request): Promise<JwtPayload | null> {
  const h = req.headers.get('Authorization') || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!token) return null;
  try {
    const key = await hmacKey(Deno.env.get('JWT_ACCESS_SECRET') || 'inspection_access_secret_change_me_in_prod');
    return (await verify(token, key)) as JwtPayload;
  } catch {
    return null;
  }
}

function snakeUser(u: Record<string, unknown>) {
  return {
    id: u.id,
    username: u.username,
    realName: u.real_name,
    phone: u.phone,
    email: u.email,
    avatar: u.avatar,
    role: u.role,
    roles: u.roles,
    status: u.status,
    region: u.region,
  };
}

async function buildUserInfo(db: ReturnType<typeof sb>, userId: string, activeRole: string) {
  const { data: user } = await db.from('users').select('*').eq('id', userId).single();
  if (!user) return null;
  const { data: memberships } = await db
    .from('site_members')
    .select('id, site_id, status, site:sites(id, name, code, province, city)')
    .eq('user_id', userId)
    .eq('status', 'active');
  const info = snakeUser(user);
  info.role = activeRole;
  info.siteMemberships = (memberships || []).map((m: Record<string, unknown>) => ({
    id: m.id,
    siteId: m.site_id,
    status: m.status,
    site: m.site
      ? {
          id: (m.site as Record<string, unknown>).id,
          name: (m.site as Record<string, unknown>).name,
          code: (m.site as Record<string, unknown>).code,
          province: (m.site as Record<string, unknown>).province,
          city: (m.site as Record<string, unknown>).city,
        }
      : null,
  }));
  return info;
}

async function resolveRole(db: ReturnType<typeof sb>, user: Record<string, unknown>, client: string) {
  const roles = Array.isArray(user.roles) ? (user.roles as string[]) : user.role ? [user.role as string] : [];
  if (client === 'pc') {
    if (roles.includes('super_admin')) return 'super_admin';
    if (roles.includes('site_manager')) return 'site_manager';
    const { data: managed } = await db.from('sites').select('id').eq('manager_id', user.id).limit(1);
    if (managed?.length) return 'site_manager';
    throw new Response(JSON.stringify({ code: 403, message: '该账号无管理端权限。请使用 H5 巡检端登录', data: null }), {
      status: 403,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
  if (roles.includes('inspector')) return 'inspector';
  const { data: mem } = await db.from('site_members').select('id').eq('user_id', user.id).eq('status', 'active').limit(1);
  if (mem?.length) return 'inspector';
  throw new Response(JSON.stringify({ code: 403, message: '该账号无巡检端权限。请使用 PC 管理端登录', data: null }), {
    status: 403,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

async function handleLogin(req: Request) {
  const body = await req.json();
  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  const client = body.client === 'h5' ? 'h5' : 'pc';
  if (!username || !password) return fail('请输入用户名和密码', 400);

  const db = sb();
  const { data: user, error } = await db.from('users').select('*').eq('username', username).maybeSingle();
  if (error || !user) return fail('用户名或密码错误', 401, 401);
  if (user.status !== 'active') return fail('账号已停用，请联系管理员', 401, 401);
  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return fail('用户名或密码错误', 401, 401);

  let role: string;
  try {
    role = await resolveRole(db, user, client);
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
  const tokens = await signTokens({ id: user.id, username: user.username }, role, client);
  const userInfo = await buildUserInfo(db, user.id, role);
  return ok({ ...tokens, user: userInfo });
}

async function handleMe(req: Request) {
  const payload = await authUser(req);
  if (!payload) return fail('未登录', 401, 401);
  const info = await buildUserInfo(sb(), payload.sub, payload.role);
  if (!info) return fail('用户不存在', 401, 401);
  return ok(info);
}

async function handleQiniuToken(req: Request) {
  const payload = await authUser(req);
  if (!payload) return fail('未登录', 401, 401);
  const accessKey = Deno.env.get('QINIU_ACCESS_KEY') || '';
  const secretKey = Deno.env.get('QINIU_SECRET_KEY') || '';
  const bucket = Deno.env.get('QINIU_BUCKET') || '';
  const domain = Deno.env.get('QINIU_DOMAIN') || '';
  if (!accessKey || !secretKey || !bucket) return fail('七牛未配置', 500, 500);

  const deadline = Math.floor(Date.now() / 1000) + 3600;
  const putPolicy = JSON.stringify({ scope: bucket, deadline });
  const encoded = btoa(putPolicy).replace(/\+/g, '-').replace(/\//g, '_');
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secretKey),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(encoded));
  const sign = btoa(String.fromCharCode(...new Uint8Array(sigBuf)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  const token = `${accessKey}:${sign}:${encoded}`;
  return ok({ token, domain, uploadUrl: Deno.env.get('QINIU_UPLOAD_URL') || 'https://upload-z2.qiniup.com' });
}

/** HTTPS 页面使用的七牛图片代理。仅放行配置的 bucket 域名。 */
async function handleImageProxy(req: Request) {
  const source = new URL(req.url).searchParams.get('url') || '';
  const configuredDomain = Deno.env.get('QINIU_DOMAIN') || '';
  let sourceUrl: URL;
  let allowedHost = '';
  try {
    sourceUrl = new URL(source);
    allowedHost = new URL(configuredDomain).host.toLowerCase();
  } catch {
    return fail('图片地址无效', 400, 400);
  }
  if (!['http:', 'https:'].includes(sourceUrl.protocol)) {
    return fail('仅支持 HTTP(S) 图片', 400, 400);
  }
  if (!allowedHost || sourceUrl.host.toLowerCase() !== allowedHost) {
    return fail('该图片域名不允许代理', 403, 403);
  }

  const candidates = [sourceUrl.toString()];
  if (sourceUrl.protocol === 'https:' && sourceUrl.hostname.endsWith('.clouddn.com')) {
    const fallback = new URL(sourceUrl);
    fallback.protocol = 'http:';
    candidates.push(fallback.toString());
  }

  for (const url of candidates) {
    try {
      const resp = await fetch(url, { redirect: 'follow' });
      const type = (resp.headers.get('content-type') || '').split(';')[0];
      if (!resp.ok || !type.startsWith('image/')) continue;
      const bytes = await resp.arrayBuffer();
      if (!bytes.byteLength || bytes.byteLength > 15 * 1024 * 1024) {
        return fail('图片为空或超过 15MB', 400, 400);
      }
      return new Response(bytes, {
        status: 200,
        headers: {
          ...cors,
          'Content-Type': type,
          'Cache-Control': 'public, max-age=86400',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    } catch {
      // 继续尝试七牛 HTTP 回退地址。
    }
  }
  return fail('图片读取失败', 502, 502);
}

async function handleDeepSeek(req: Request) {
  const payload = await authUser(req);
  if (!payload) return fail('未登录', 401, 401);
  const { text } = await req.json();
  const apiKey = Deno.env.get('DEEPSEEK_API_KEY') || '';
  const base = Deno.env.get('DEEPSEEK_BASE_URL') || 'https://api.deepseek.com';
  if (!apiKey) return ok({ text: text || '', polished: false });
  const resp = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: '你是巡检系统文案助手，请用简洁中文润色用户给出的检查说明，不要编造事实。' },
        { role: 'user', content: String(text || '') },
      ],
      temperature: 0.3,
    }),
  });
  if (!resp.ok) return ok({ text: text || '', polished: false });
  const data = await resp.json();
  const out = data?.choices?.[0]?.message?.content || text;
  return ok({ text: out, polished: true });
}

function mapTask(row: Record<string, unknown>) {
  return {
    id: row.id,
    siteId: row.site_id,
    deviceId: row.device_id,
    taskName: row.task_name,
    inspectorId: row.inspector_id,
    createdBy: row.created_by,
    status: row.status,
    plannedDate: row.planned_date,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    aiEnabled: row.ai_enabled,
    templateSnapshot: row.template_snapshot,
    createdAt: row.created_at,
    site: row.site || undefined,
    device: row.device || undefined,
    inspector: row.inspector
      ? { id: (row.inspector as Record<string, unknown>).id, realName: (row.inspector as Record<string, unknown>).real_name }
      : undefined,
  };
}

async function handleTasksGet(req: Request) {
  const payload = await authUser(req);
  if (!payload) return fail('未登录', 401, 401);
  const url = new URL(req.url);
  const page = Number(url.searchParams.get('page') || 1);
  const limit = Math.min(Number(url.searchParams.get('limit') || 20), 100);
  const from = (page - 1) * limit;
  const to = from + limit - 1;
  const db = sb();
  let q = db
    .from('inspection_tasks')
    .select(
      '*, site:sites(id,name,code,province,city), device:devices(id,serial_number,device_type,model), inspector:users!inspector_id(id,real_name)',
      { count: 'exact' },
    )
    .order('created_at', { ascending: false })
    .range(from, to);

  if (payload.role === 'inspector') {
    q = q.eq('inspector_id', payload.sub);
  }
  const siteId = url.searchParams.get('siteId');
  if (siteId) q = q.eq('site_id', siteId);
  const status = url.searchParams.get('status');
  if (status) q = q.eq('status', status);

  const { data, error, count } = await q;
  if (error) return fail(error.message, 500, 500);
  return ok({ list: (data || []).map((r) => mapTask(r as Record<string, unknown>)), total: count || 0, page, limit });
}

async function handleTasksPost(req: Request) {
  const payload = await authUser(req);
  if (!payload) return fail('未登录', 401, 401);
  const body = await req.json();
  const db = sb();
  const deviceId = body.deviceId as string;
  const siteId = body.siteId as string;
  const taskName = String(body.taskName || '巡检任务');
  const inspectorId = (body.inspectorId as string) || payload.sub;

  const { data: device } = await db.from('devices').select('*').eq('id', deviceId).maybeSingle();
  if (!device) return fail('设备不存在', 404, 404);

  const { data: tpl } = await db
    .from('inspection_templates')
    .select('*')
    .eq('device_type', device.device_type)
    .eq('is_global', true)
    .is('site_id', null)
    .maybeSingle();

  const { data: task, error } = await db
    .from('inspection_tasks')
    .insert({
      site_id: siteId || device.site_id,
      device_id: deviceId,
      task_name: taskName,
      inspector_id: inspectorId,
      created_by: payload.sub,
      status: 'pending',
      ai_enabled: body.aiEnabled !== false,
      template_snapshot: tpl?.entries || [],
    })
    .select('*')
    .single();
  if (error) return fail(error.message, 500, 500);
  return ok(mapTask(task as Record<string, unknown>));
}

async function handleTaskGet(id: string, req: Request) {
  const payload = await authUser(req);
  if (!payload) return fail('未登录', 401, 401);
  const db = sb();
  const { data, error } = await db
    .from('inspection_tasks')
    .select(
      '*, site:sites(id,name,code,province,city), device:devices(id,serial_number,device_type,model), inspector:users!inspector_id(id,real_name)',
    )
    .eq('id', id)
    .maybeSingle();
  if (error || !data) return fail('任务不存在', 404, 404);
  const { data: record } = await db.from('inspection_records').select('*').eq('task_id', id).maybeSingle();
  const mapped = mapTask(data as Record<string, unknown>) as Record<string, unknown>;
  mapped.record = record
    ? {
        id: record.id,
        status: record.status,
        entries: record.entries,
        rejectReason: record.reject_reason,
      }
    : null;
  return ok(mapped);
}

async function handleSitesGet(req: Request) {
  const payload = await authUser(req);
  if (!payload) return fail('未登录', 401, 401);
  const db = sb();
  if (payload.role === 'super_admin' || payload.role === 'site_manager') {
    const { data, error } = await db.from('sites').select('*').is('deleted_at', null).order('created_at', { ascending: false });
    if (error) return fail(error.message, 500, 500);
    return ok({
      list: (data || []).map((s) => ({
        id: s.id,
        name: s.name,
        code: s.code,
        province: s.province,
        city: s.city,
        district: s.district,
        address: s.address,
        latitude: s.latitude,
        longitude: s.longitude,
        status: s.status,
      })),
      total: data?.length || 0,
    });
  }
  const { data: mem } = await db
    .from('site_members')
    .select('site:sites(*)')
    .eq('user_id', payload.sub)
    .eq('status', 'active');
  const list = (mem || []).map((m: Record<string, unknown>) => m.site).filter(Boolean);
  return ok({
    list: list.map((s: Record<string, unknown>) => ({
      id: s.id,
      name: s.name,
      code: s.code,
      province: s.province,
      city: s.city,
      district: s.district,
      address: s.address,
      status: s.status,
    })),
    total: list.length,
  });
}

async function handleDevicesGet(req: Request) {
  const payload = await authUser(req);
  if (!payload) return fail('未登录', 401, 401);
  const url = new URL(req.url);
  const siteId = url.searchParams.get('siteId');
  const db = sb();
  let q = db.from('devices').select('*').order('created_at', { ascending: false }).limit(200);
  if (siteId) q = q.eq('site_id', siteId);
  const { data, error } = await q;
  if (error) return fail(error.message, 500, 500);
  return ok({
    list: (data || []).map((d) => ({
      id: d.id,
      siteId: d.site_id,
      serialNumber: d.serial_number,
      deviceType: d.device_type,
      model: d.model,
      status: d.status,
    })),
    total: data?.length || 0,
  });
}

async function handleHealth() {
  return ok({ ok: true, service: 'supabase-edge-api', storage: 'qiniu', llm: 'deepseek' });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const url = new URL(req.url);
    // /functions/v1/api/auth/login → path after /api
    const parts = url.pathname.split('/').filter(Boolean);
    const apiIdx = parts.indexOf('api');
    const segs = apiIdx >= 0 ? parts.slice(apiIdx + 1) : parts;
    const path = '/' + segs.join('/');
    const method = req.method.toUpperCase();

    if (method === 'GET' && (path === '/health' || path === '/')) return handleHealth();
    if (method === 'GET' && path === '/upload/image') return await handleImageProxy(req);
    if (method === 'POST' && path === '/auth/login') return await handleLogin(req);
    if (method === 'GET' && path === '/auth/me') return await handleMe(req);
    if (method === 'GET' && path === '/upload/qiniu-token') return await handleQiniuToken(req);
    if (method === 'POST' && path === '/ai/polish') return await handleDeepSeek(req);
    if (method === 'GET' && path === '/tasks') return await handleTasksGet(req);
    if (method === 'POST' && path === '/tasks') return await handleTasksPost(req);
    if (method === 'GET' && path.startsWith('/tasks/')) return await handleTaskGet(segs[1], req);
    if (method === 'GET' && path === '/sites') return await handleSitesGet(req);
    if (method === 'GET' && path === '/devices') return await handleDevicesGet(req);

    return fail(`未实现的路由 ${method} ${path}`, 404, 404);
  } catch (e) {
    console.error(e);
    return fail((e as Error).message || '服务器错误', 500, 500);
  }
});
