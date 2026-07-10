# TripAI — AI-Powered Travel Planner

Plan any trip anywhere in the world with AI. Generates complete day-by-day itineraries with interactive maps, booking links, transport routes, and cost estimates.

## Stack
- **AI**: Groq API (llama-3.3-70b-versatile)
- **Auth + Database**: Supabase (free tier)
- **Maps**: Leaflet.js + CartoDB Voyager tiles
- **Hosting**: Netlify (free tier)

---

## Setup Guide (15–20 minutes)

### Step 1 — Get a new Groq API key
> ⚠️ **Your previous key was exposed in a chat — regenerate it immediately.**
1. Go to [console.groq.com](https://console.groq.com) → API Keys
2. Delete the old key, create a new one
3. Copy the new key (starts with `gsk_`)

### Step 2 — Create a Supabase project
1. Go to [supabase.com](https://supabase.com) and sign up (free)
2. Click **New project** — choose a name and region
3. Once created, go to **Settings → API**
4. Copy:
   - **Project URL** (e.g. `https://abc123.supabase.co`)
   - **anon / public** key (long string starting with `eyJ`)

### Step 3 — Create the database table
In your Supabase project, go to **SQL Editor** and run:

```sql
-- Create trips table
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

-- Enable Row Level Security
alter table trips enable row level security;

-- Users can only see and edit their own trips
create policy "users_own_trips" on trips
  for all using (auth.uid() = user_id);
```

### Step 4 — Deploy to Netlify

**Option A: Deploy from GitHub (recommended)**
1. Push this project to a GitHub repository
2. Go to [app.netlify.com](https://app.netlify.com) → **Add new site → Import from Git**
3. Connect your GitHub repo
4. Build settings are auto-detected from `netlify.toml`
5. Click **Deploy**

**Option B: Drag and drop**
1. Run `npm install` in the project folder
2. Drag the entire project folder to [app.netlify.com](https://app.netlify.com)

### Step 5 — Add environment variables in Netlify
Go to **Site settings → Environment variables** and add:

| Variable | Value |
|----------|-------|
| `GROQ_API_KEY` | Your new Groq API key (`gsk_...`) |
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_ANON_KEY` | Your Supabase anon/public key |

### Step 6 — Update Supabase keys in HTML files
Open `public/index.html`, `public/dashboard.html`, `public/plan.html`, and `public/trip.html`.

In each file, replace these two lines near the bottom:
```js
const SUPABASE_URL = window.SUPABASE_URL || 'YOUR_SUPABASE_URL';
const SUPABASE_ANON = window.SUPABASE_ANON || 'YOUR_SUPABASE_ANON_KEY';
```
With your actual values:
```js
const SUPABASE_URL = 'https://yourproject.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...';
```

> The Supabase anon key is safe to put in client-side code — it's designed to be public. The Groq API key must NEVER go in client code (it stays in the Netlify function).

### Step 7 — Enable Supabase email auth
In your Supabase project:
1. Go to **Authentication → Settings**
2. Under **Email**, make sure **Enable email sign-ups** is ON
3. Optional: disable "Confirm email" for easier testing (Authentication → Settings → uncheck "Enable email confirmations")

### Step 8 — Redeploy
After updating the HTML files, push to GitHub (or re-drag to Netlify). Your app is live!

---

## Project Structure

```
trip-planner/
├── public/
│   ├── index.html          Landing page + auth (login/signup)
│   ├── dashboard.html      User's saved trips
│   ├── plan.html           Trip planning form (3 steps)
│   ├── trip.html           Interactive map + itinerary view
│   └── css/
│       └── style.css       All shared styles
├── netlify/
│   └── functions/
│       └── generate-trip.js  Groq API endpoint (server-side)
├── netlify.toml            Netlify build config
├── package.json            Dependencies for Netlify functions
└── README.md               This file
```

## How it works

1. User signs up / logs in with email (Supabase Auth)
2. On `/plan.html`, they fill in origin, destination, dates, and preferences
3. On submit, the app calls `/api/generate-trip` (a Netlify serverless function)
4. That function calls Groq API with a detailed prompt, requesting JSON itinerary
5. The itinerary is saved to Supabase, then user is redirected to `/trip.html`
6. `/trip.html` loads the itinerary from Supabase and renders:
   - A Leaflet interactive map with all places as colored markers
   - Day-by-day sidebar with place cards and transport info
   - Transport routes as colored polylines (dashed=flight, solid=train, dotted=car)
7. All trips appear on `/dashboard.html`

## Customisation tips

- **Change AI model**: In `netlify/functions/generate-trip.js`, change `llama-3.3-70b-versatile` to any Groq-supported model
- **Add more preferences**: Add new chips in `plan.html` and update the prompt in `generate-trip.js`
- **Map tiles**: In `trip.html`, swap the CartoDB URL for any free Leaflet tile provider
- **Branding**: Change "TripAI" and the ✈️ emoji throughout to your own brand name

## Troubleshooting

| Issue | Fix |
|-------|-----|
| "YOUR_SUPABASE_URL" shown in errors | Update the constants in all 4 HTML files |
| Trip generation fails | Check Groq API key in Netlify env variables |
| Login doesn't work | Check Supabase URL and anon key in HTML files |
| Trips not saving | Check that the SQL table was created and RLS policy applied |
| Map not loading | Check internet connection; Leaflet loads from unpkg.com CDN |

---

Made with ❤️ using Groq, Supabase, Leaflet, and Netlify.
