create table public.transcription_allowance (
  id boolean primary key default true check (id),
  limit_micros bigint not null default 2000000 check (limit_micros >= 0),
  reserved_micros bigint not null default 0 check (reserved_micros >= 0)
);
insert into public.transcription_allowance (id) values (true);
create table public.transcription_requests (
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id text not null,
  reserved_micros integer not null check (reserved_micros > 0),
  status text not null check (status in ('pending', 'complete', 'failed')),
  transcript text,
  error text,
  created_at timestamptz not null default now(),
  primary key (user_id, request_id)
);
alter table public.transcription_allowance enable row level security;
alter table public.transcription_requests enable row level security;
revoke all on public.transcription_allowance, public.transcription_requests from public, anon, authenticated;
grant all on public.transcription_allowance, public.transcription_requests to service_role;

create function public.reserve_transcription(p_user uuid, p_id text, p_micros integer)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare allowance public.transcription_allowance%rowtype; prior public.transcription_requests%rowtype;
begin
  if p_micros < 1 or p_micros > 10000 or length(p_id) > 150 then raise exception 'Invalid reservation'; end if;
  select * into strict allowance from public.transcription_allowance where id = true for update;
  select * into prior from public.transcription_requests where user_id = p_user and request_id = p_id;
  if found then return jsonb_build_object('status', prior.status, 'text', prior.transcript, 'error', prior.error); end if;
  if allowance.reserved_micros + p_micros > allowance.limit_micros then return jsonb_build_object('status', 'exhausted'); end if;
  update public.transcription_allowance set reserved_micros = reserved_micros + p_micros where id = true;
  insert into public.transcription_requests(user_id, request_id, reserved_micros, status) values(p_user, p_id, p_micros, 'pending');
  return jsonb_build_object('status', 'reserved');
end $$;
create function public.finish_transcription(p_user uuid, p_id text, p_text text, p_error text)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  update public.transcription_requests set status = case when p_text is not null then 'complete' else 'failed' end,
    transcript = p_text, error = p_error where user_id = p_user and request_id = p_id and status = 'pending';
  if not found then raise exception 'Missing pending reservation'; end if;
end $$;
revoke execute on function public.reserve_transcription(uuid, text, integer), public.finish_transcription(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.reserve_transcription(uuid, text, integer), public.finish_transcription(uuid, text, text, text) to service_role;
