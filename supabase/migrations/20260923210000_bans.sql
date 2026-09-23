-- Oyuncu engelleme.
-- Engellenen cihazın (pid) skorları liderlikten düşer, yeni skor yazamaz, telefon oyuna giremez.
-- Engellemeyi sadece yönetici kodunu bilen yapabilir. Kodun kendisi burada yok:
-- private.settings tablosuna bcrypt özeti olarak ayrıca yazılır (README › Yönetici kodu).

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table private.settings (
  key   text primary key,
  value text not null
);

create table public.banned (
  pid        text primary key check (pid ~ '^[a-z0-9]{3,12}$'),
  name       text,
  created_at timestamptz not null default now()
);
alter table public.banned enable row level security;
-- Politika yok: anon/authenticated doğrudan okuyamaz ve yazamaz, sadece aşağıdaki fonksiyonlar.
revoke all on public.banned from anon, authenticated;

create function private.admin_ok(p_secret text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from private.settings
    where key = 'admin_hash' and value = extensions.crypt(coalesce(p_secret, ''), value)
  );
$$;

create function public.is_banned(p_pid text)
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.banned where pid = p_pid); $$;

create function public.check_admin(p_secret text)
returns boolean language sql stable security definer set search_path = ''
as $$ select private.admin_ok(p_secret); $$;

create function public.ban_player(p_secret text, p_pid text, p_name text default null)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not private.admin_ok(p_secret) then raise exception 'yetkisiz' using errcode = '42501'; end if;
  insert into public.banned (pid, name) values (p_pid, left(p_name, 12))
  on conflict (pid) do update set name = excluded.name;
end $$;

create function public.unban_player(p_secret text, p_pid text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not private.admin_ok(p_secret) then raise exception 'yetkisiz' using errcode = '42501'; end if;
  delete from public.banned where pid = p_pid;
end $$;

create function public.list_bans(p_secret text)
returns table (pid text, name text, created_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.admin_ok(p_secret) then raise exception 'yetkisiz' using errcode = '42501'; end if;
  return query select b.pid, b.name, b.created_at from public.banned b order by b.created_at desc;
end $$;

revoke execute on function private.admin_ok(text) from public, anon, authenticated;
grant execute on function public.is_banned(text), public.check_admin(text),
  public.ban_player(text, text, text), public.unban_player(text, text), public.list_bans(text)
  to anon, authenticated;

-- Engelli cihaz skor yazamaz
drop policy "herkes ekleyebilir" on public.scores;
create policy "engelli olmayan ekleyebilir" on public.scores
  for insert to anon, authenticated with check (not public.is_banned(pid));

-- Liderlik engellileri göstermez
create or replace function public.leaderboard(p_limit integer default 50)
returns table (rank bigint, pid text, name text, net_ms integer, stars smallint, runs bigint, played_at timestamptz)
language sql stable security invoker set search_path = ''
as $$
  with ok as (
    select s.* from public.scores s where not public.is_banned(s.pid)
  ), best as (
    select distinct on (s.pid) s.pid, s.name, s.net_ms, s.stars, s.created_at
    from ok s order by s.pid, s.net_ms, s.created_at
  ), cnt as (
    select s.pid, count(*) as runs from ok s group by s.pid
  )
  select rank() over (order by b.net_ms), b.pid, b.name, b.net_ms, b.stars, c.runs, b.created_at
  from best b join cnt c using (pid)
  order by b.net_ms, b.created_at
  limit least(greatest(p_limit, 1), 500);
$$;

create or replace function public.player_standing(p_pid text)
returns table (best_ms integer, rank bigint, total bigint, runs bigint)
language sql stable security invoker set search_path = ''
as $$
  with best as (
    select s.pid, min(s.net_ms) as net_ms, count(*) as runs
    from public.scores s where not public.is_banned(s.pid) group by s.pid
  ), me as (select * from best where pid = p_pid)
  select me.net_ms,
         1 + (select count(*) from best b where b.net_ms < me.net_ms),
         (select count(*) from best),
         me.runs
  from me;
$$;
