-- Run this in your Supabase SQL Editor
-- Project → SQL Editor → New query → paste → Run
-- Safe to re-run: uses IF NOT EXISTS / CREATE OR REPLACE / DROP+CREATE POLICY throughout.

-- ============================================================
-- 1. TRIPS (original table, now extended for collaboration)
-- ============================================================

create table if not exists trips (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users not null,
  title text not null,
  origin text not null,
  destination text not null,
  start_date date,
  end_date date,
  travelers integer default 1,
  preferences jsonb default '{}',
  itinerary jsonb not null,
  created_at timestamptz default now()
);

alter table trips add column if not exists updated_at timestamptz default now();
alter table trips add column if not exists updated_by uuid references auth.users(id);

alter table trips enable row level security;

-- ============================================================
-- 2. TRIP_COLLABORATORS — who has access to which trip, and how
-- ============================================================

create table if not exists trip_collaborators (
  id uuid default gen_random_uuid() primary key,
  trip_id uuid references trips(id) on delete cascade not null,
  invited_email text not null,
  user_id uuid references auth.users(id) on delete cascade,
  role text not null check (role in ('editor','viewer')),
  status text not null default 'pending' check (status in ('pending','accepted')),
  invite_token uuid default gen_random_uuid() not null,
  invited_by uuid references auth.users(id) not null,
  created_at timestamptz default now(),
  accepted_at timestamptz,
  unique (trip_id, invited_email)
);

create index if not exists idx_trip_collaborators_trip on trip_collaborators(trip_id);
create index if not exists idx_trip_collaborators_user on trip_collaborators(user_id);
create index if not exists idx_trip_collaborators_email on trip_collaborators(lower(invited_email));

alter table trip_collaborators enable row level security;

-- ============================================================
-- 3. NOTIFICATIONS — in-app feed, written only by trigger functions
-- ============================================================

create table if not exists notifications (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  trip_id uuid references trips(id) on delete cascade not null,
  actor_id uuid references auth.users(id),
  type text not null check (type in ('itinerary_edit','collaborator_added','collaborator_removed','role_changed')),
  message text not null,
  read boolean not null default false,
  created_at timestamptz default now()
);

create index if not exists idx_notifications_user on notifications(user_id, created_at desc);
create index if not exists idx_notifications_unread on notifications(user_id) where read = false;

alter table notifications enable row level security;

-- ============================================================
-- 4. HELPER FUNCTION — is this user an accepted collaborator?
-- ============================================================

create or replace function is_trip_collaborator(p_trip_id uuid, p_user_id uuid, p_roles text[] default array['editor','viewer'])
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from trip_collaborators
    where trip_id = p_trip_id
      and user_id = p_user_id
      and status = 'accepted'
      and role = any(p_roles)
  );
$$;

-- ============================================================
-- 5. RLS POLICIES — trips
-- ============================================================

drop policy if exists "users_own_trips" on trips;
drop policy if exists "trips_select" on trips;
drop policy if exists "trips_update" on trips;
drop policy if exists "trips_insert" on trips;
drop policy if exists "trips_delete" on trips;

create policy "trips_select" on trips
  for select using (
    auth.uid() = user_id
    or is_trip_collaborator(id, auth.uid())
  );

create policy "trips_update" on trips
  for update using (
    auth.uid() = user_id
    or is_trip_collaborator(id, auth.uid(), array['editor'])
  );

create policy "trips_insert" on trips
  for insert with check (auth.uid() = user_id);

create policy "trips_delete" on trips
  for delete using (auth.uid() = user_id);

-- ============================================================
-- 6. RLS POLICIES — trip_collaborators
-- ============================================================

drop policy if exists "collab_select" on trip_collaborators;
drop policy if exists "collab_insert" on trip_collaborators;
drop policy if exists "collab_update" on trip_collaborators;
drop policy if exists "collab_delete" on trip_collaborators;

create policy "collab_select" on trip_collaborators
  for select using (
    auth.uid() = user_id
    or exists (select 1 from trips t where t.id = trip_id and t.user_id = auth.uid())
  );

create policy "collab_insert" on trip_collaborators
  for insert with check (
    exists (select 1 from trips t where t.id = trip_id and t.user_id = auth.uid())
  );

create policy "collab_update" on trip_collaborators
  for update using (
    exists (select 1 from trips t where t.id = trip_id and t.user_id = auth.uid())
  );

create policy "collab_delete" on trip_collaborators
  for delete using (
    exists (select 1 from trips t where t.id = trip_id and t.user_id = auth.uid())
  );

-- ============================================================
-- 7. RLS POLICIES — notifications
-- Deliberately NO insert policy: rows are only ever written by the
-- SECURITY DEFINER trigger functions below, never directly by a client.
-- ============================================================

drop policy if exists "notif_select" on notifications;
drop policy if exists "notif_update" on notifications;

create policy "notif_select" on notifications
  for select using (auth.uid() = user_id);

create policy "notif_update" on notifications
  for update using (auth.uid() = user_id);

-- ============================================================
-- 8. TRIGGER — notify collaborators when the itinerary changes
-- ============================================================

create or replace function notify_trip_edit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  actor_name text;
  recipient record;
begin
  if new.itinerary is not distinct from old.itinerary then
    return new;
  end if;

  select coalesce(raw_user_meta_data->>'full_name', email) into actor_name
  from auth.users where id = actor;

  new.updated_at := now();
  new.updated_by := actor;

  for recipient in
    select user_id from (
      select user_id from trips where id = new.id
      union
      select user_id from trip_collaborators
        where trip_id = new.id and status = 'accepted'
    ) as recipients
    where user_id is not null and user_id <> actor
  loop
    insert into notifications (user_id, trip_id, actor_id, type, message)
    values (
      recipient.user_id, new.id, actor, 'itinerary_edit',
      coalesce(actor_name, 'Someone') || ' updated the itinerary for "' || coalesce(new.title, new.destination) || '"'
    );
  end loop;

  return new;
end;
$$;

drop trigger if exists trg_notify_trip_edit on trips;
create trigger trg_notify_trip_edit
  before update on trips
  for each row execute function notify_trip_edit();

-- ============================================================
-- 9. TRIGGERS — notify on collaborator add / role change / removal
-- ============================================================

create or replace function notify_collaborator_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  trip_title text;
  trip_owner uuid;
begin
  select coalesce(title, destination), user_id into trip_title, trip_owner
  from trips where id = new.trip_id;

  if tg_op = 'INSERT' then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if old.status = 'pending' and new.status = 'accepted' then
      insert into notifications (user_id, trip_id, actor_id, type, message)
      values (trip_owner, new.trip_id, new.user_id, 'collaborator_added',
        (select coalesce(raw_user_meta_data->>'full_name', email) from auth.users where id = new.user_id)
          || ' joined "' || trip_title || '" as ' || new.role);
    end if;

    if old.role <> new.role and new.status = 'accepted' then
      insert into notifications (user_id, trip_id, actor_id, type, message)
      values (new.user_id, new.trip_id, actor, 'role_changed',
        'Your role on "' || trip_title || '" changed to ' || new.role);
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_notify_collaborator_change on trip_collaborators;
create trigger trg_notify_collaborator_change
  after insert or update on trip_collaborators
  for each row execute function notify_collaborator_change();

create or replace function notify_collaborator_removed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  trip_title text;
begin
  if old.user_id is null then
    return old;
  end if;
  select coalesce(title, destination) into trip_title from trips where id = old.trip_id;
  insert into notifications (user_id, trip_id, actor_id, type, message)
  values (old.user_id, old.trip_id, auth.uid(), 'collaborator_removed',
    'You were removed from "' || trip_title || '"');
  return old;
end;
$$;

drop trigger if exists trg_notify_collaborator_removed on trip_collaborators;
create trigger trg_notify_collaborator_removed
  before delete on trip_collaborators
  for each row execute function notify_collaborator_removed();

-- ============================================================
-- 10. RPC — claim_invites()
-- Called by the client right after login/signup. Matches pending
-- invites to the caller's own VERIFIED email from their JWT (never a
-- client-supplied value), so a user can only ever claim their own invites.
-- ============================================================

create or replace function claim_invites()
returns setof trip_collaborators
language plpgsql
security definer
set search_path = public
as $$
declare
  my_email text := lower(auth.jwt() ->> 'email');
  my_id uuid := auth.uid();
begin
  return query
  update trip_collaborators
  set user_id = my_id, status = 'accepted', accepted_at = now()
  where lower(invited_email) = my_email
    and status = 'pending'
    and user_id is null
  returning *;
end;
$$;

grant execute on function claim_invites() to authenticated;

-- ============================================================
-- 11. REALTIME — enable live updates for notifications + trips
-- (Also doable via Supabase dashboard: Database → Replication)
-- ============================================================

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table notifications;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'trips'
  ) then
    alter publication supabase_realtime add table trips;
  end if;
end $$;
