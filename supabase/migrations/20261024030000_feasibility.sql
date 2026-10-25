-- Feasibility: every tasking request must now be submitted against a
-- specific chosen satellite pass ("opportunity"), computed server-side by
-- the check-feasibility Edge Function. These columns record which pass was
-- chosen and the feasibility numbers shown to the requester at submit time,
-- plus the sensor's actual "impacted" ground footprint for that pass (which
-- can be larger than the requested AOI — see submit-tasking-request).

alter table public.tasking_requests
  add column satellite_id text not null,
  add column pass_at timestamptz not null,
  add column delivery_eta_at timestamptz not null,
  add column nadir_deg double precision not null,
  add column sun_elevation_deg double precision not null,
  add column cloud_cover_pct double precision not null,
  add column resolution_m double precision not null,
  add column confidence text not null check (confidence in ('high', 'medium', 'low')),
  add column coverage_fraction double precision not null,
  add column priority_tier text not null check (priority_tier in ('high', 'medium', 'low')),

  -- Impacted footprint: the sensor's actual ground coverage for the chosen
  -- pass, which can exceed the requester's drawn AOI (tasking area).
  add column impacted_geojson jsonb not null,
  add column impacted_centroid_lat double precision not null,
  add column impacted_centroid_lng double precision not null,
  add column impacted_bounding_radius_km double precision not null,

  -- Active dedup nudge: true only if the requester was shown a conflict
  -- banner (another active request overlaps this ground) and explicitly
  -- acknowledged it before submitting. Enforced in submit-tasking-request,
  -- not by a DB constraint, since whether acknowledgment was *required*
  -- depends on the conflict check run at submit time.
  add column acknowledged_conflict boolean not null default false;
