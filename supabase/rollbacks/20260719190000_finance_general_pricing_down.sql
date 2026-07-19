update public.po_item
set price_status = 'pending_price'
where price_status = 'ignored';

alter table public.po_item
  drop constraint if exists po_item_price_status_check;

alter table public.po_item
  add constraint po_item_price_status_check
  check (price_status in ('ok', 'pending_price'));
