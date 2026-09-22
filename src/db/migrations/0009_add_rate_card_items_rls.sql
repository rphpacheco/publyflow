alter table rate_card_items enable row level security;

create policy org_isolation_rate_card_items on rate_card_items
  using (organization_id = current_setting('app.current_org_id', true)::uuid);
