alter table public.upload_fee_payments
  add column if not exists amount_major numeric(12,2),
  add column if not exists country_code text;

update public.upload_fee_payments
set amount_major = amount_ngn::numeric
where amount_major is null;

update public.upload_fee_payments
set country_code = 'NG'
where country_code is null and coalesce(currency, 'NGN') = 'NGN';

alter table public.upload_fee_payments
  add constraint upload_fee_payments_amount_major_positive
  check (amount_major is null or amount_major > 0);