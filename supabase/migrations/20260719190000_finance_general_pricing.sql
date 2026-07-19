-- 通用条目与占位条目的核算状态扩展。
alter table public.po_item
  drop constraint if exists po_item_price_status_check;

alter table public.po_item
  add constraint po_item_price_status_check
  check (price_status in ('ok', 'pending_price', 'ignored'));
