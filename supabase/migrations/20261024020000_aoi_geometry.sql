-- Replace the plain point+radius AOI with a proper footprint geometry driven
-- by the two imaging modes (spot: 6x6km square, strip: 6km-wide rectangle up
-- to 30km long). The centroid + bounding radius are kept alongside the full
-- polygon so the community-objection check can keep using simple circle
-- overlap math (conservative: a rectangle's bounding circle is always >= the
-- rectangle itself, so this never under-triggers review).

alter table public.tasking_requests
  drop column if exists center_lat,
  drop column if exists center_lng,
  drop column if exists radius_km;

alter table public.tasking_requests
  add column imaging_mode text not null check (imaging_mode in ('spot', 'strip')),
  add column aoi_geojson jsonb not null,
  add column centroid_lat double precision not null,
  add column centroid_lng double precision not null,
  add column bounding_radius_km double precision not null;
