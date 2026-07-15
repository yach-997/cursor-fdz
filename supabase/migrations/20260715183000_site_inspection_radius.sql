-- 每个站点独立配置现场巡检围栏半径；已有站点默认 500 米。
alter table public.sites
  add column if not exists inspection_radius_meters integer not null default 500;

alter table public.sites
  drop constraint if exists sites_inspection_radius_meters_check;

alter table public.sites
  add constraint sites_inspection_radius_meters_check
  check (inspection_radius_meters between 50 and 5000);
