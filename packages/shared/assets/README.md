# Road graph asset

`algiers-roads.json` is the compact road graph used for offline routing (see `src/routing`).

- **Source:** OpenStreetMap, motorway / trunk / primary / secondary / tertiary roads and their links, for the box
  `[36.60, 2.80, 36.85, 3.55]` (Algiers and the autoroute east to Boudouaou).
- **Licence:** ODbL 1.0. Show "© OpenStreetMap contributors" wherever the map or a route is displayed.
- **Date:** `meta.osmTimestamp` is the date of the OpenStreetMap snapshot the data was built from.
- **Rebuild:** `bun run build:roads` (needs the internet; takes a few minutes). Commit the result.
- **Format:** see `RoadGraphAsset` in `src/routing/build.ts`. Nodes are junctions and road ends in 1e-5 degrees;
  the bends of a road are an encoded polyline on its edge. Speeds are not stored: they come from `THRESHOLDS.routing`.
- **Limits:** no turn restrictions, no live traffic, minor roads (residential, service) are not included.
