-- Run this in your Supabase SQL Editor
-- Project → SQL Editor → New query → paste → Run

create table trips (
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

alter table trips enable row level security;

create policy "users_own_trips" on trips
  for all using (auth.uid() = user_id);
