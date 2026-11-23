#!/usr/bin/env python3
"""Build data/geo/: the county + ZIP reference the service-area map hover reads.

The stored service area is one dissolved polygon, so it carries no county or
ZIP names. The map works them out in the browser from these static files:

  data/geo/states.json   {"FL": [minLng, minLat, maxLng, maxLat], ...}
  data/geo/<ST>.json     [{"n": "Orange County", "b": bbox, "g": [[[ring], ...], ...] (always a list of polygons),
                           "z": [["32801", lat, lng], ...]}, ...]

Only the states a client's polygon touches are fetched.

Sources (public domain, Census Bureau):
  counties  https://www2.census.gov/geo/tiger/GENZ2023/shp/cb_2023_us_county_5m.zip
  ZIPs      https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2023_Gazetteer/2023_Gaz_zcta_national.zip
            (ZCTA internal points, so a ZIP is placed by a point that lies inside it;
             PO-box-only ZIPs have no area and are not in the file)

Each ZIP is filed under the county that contains its internal point.

Usage: python3 scripts/build-county-geo.py <cb_2023_us_county_5m.shp> <2023_Gaz_zcta_national.txt>
Needs: pyshp, shapely.
"""
import json
import os
import sys
from collections import defaultdict

import shapefile
from shapely.geometry import Point, shape
from shapely.strtree import STRtree

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
OUT = os.path.join(ROOT, 'data', 'geo')


def rnd(coords):
    if isinstance(coords[0], (int, float)):
        return [round(coords[0], 4), round(coords[1], 4)]
    return [rnd(c) for c in coords]


def main(shp_path, gaz_path):
    sf = shapefile.Reader(shp_path)
    fields = [f[0] for f in sf.fields[1:]]
    counties = []
    for sr in sf.iterShapeRecords():
        rec = dict(zip(fields, sr.record))
        geo = sr.shape.__geo_interface__
        counties.append({'rec': rec, 'geom': shape(geo), 'geo': geo, 'zips': []})

    tree = STRtree([c['geom'] for c in counties])
    unplaced = 0
    with open(gaz_path) as fh:
        header = [h.strip() for h in fh.readline().split('\t')]
        iz, ilat, ilng = header.index('GEOID'), header.index('INTPTLAT'), header.index('INTPTLONG')
        for line in fh:
            parts = [p.strip() for p in line.split('\t')]
            z, lat, lng = parts[iz], float(parts[ilat]), float(parts[ilng])
            pt = Point(lng, lat)
            hit = next((i for i in tree.query(pt) if counties[i]['geom'].covers(pt)), None)
            if hit is None:
                unplaced += 1
                continue
            counties[hit]['zips'].append([z, round(lat, 4), round(lng, 4)])

    by_state = defaultdict(list)
    for c in counties:
        st = c['rec']['STUSPS']
        g = c['geo']
        by_state[st].append({
            'n': c['rec']['NAMELSAD'],
            'b': [round(v, 4) for v in c['geom'].bounds],
            # Polygon -> [rings], MultiPolygon -> [[rings], ...]; the type is implied by depth.
            'g': rnd(g['coordinates']) if g['type'] == 'MultiPolygon' else [rnd(g['coordinates'])],
            'z': sorted(c['zips']),
        })

    os.makedirs(OUT, exist_ok=True)
    index = {}
    for st, cs in sorted(by_state.items()):
        cs.sort(key=lambda c: c['n'])
        xs = [c['b'] for c in cs]
        index[st] = [min(b[0] for b in xs), min(b[1] for b in xs), max(b[2] for b in xs), max(b[3] for b in xs)]
        with open(os.path.join(OUT, f'{st}.json'), 'w') as fh:
            json.dump(cs, fh, separators=(',', ':'))
    with open(os.path.join(OUT, 'states.json'), 'w') as fh:
        json.dump(index, fh, separators=(',', ':'))
    print(f'{len(counties)} counties in {len(by_state)} states/territories; {unplaced} ZIPs outside every county')


if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
