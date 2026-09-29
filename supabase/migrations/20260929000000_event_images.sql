-- Organiser-supplied event photos.
--
-- Stored in Postgres (bytea) rather than Supabase Storage: no extra bucket,
-- secret or vendor for a solo-founder MVP. The app downsizes uploads to
-- ~1600px JPEG client-side and the API caps them at 2 MB, so a row is small.
-- Served by GET /api/events/[eventId]/image with long-lived cache headers
-- (the URL carries a ?v= version). Move to Storage/a CDN if volume grows.
create table public.event_images (
  event_id uuid primary key references public.events (id) on delete cascade,
  content_type text not null check (content_type in ('image/jpeg', 'image/png', 'image/webp')),
  data bytea not null check (octet_length(data) between 1 and 2097152),
  updated_at timestamptz not null default now()
);

-- Same model as every other table: no direct client access, only the API.
alter table public.event_images enable row level security;
