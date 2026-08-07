#!/usr/bin/env python3
"""
Final geometry pass. Produces templates.json for the flyer app.

Photo window comes from diffing the original Canva export against the cleaned
one. `amplified` is the exception: its placeholder never got deleted, so its
window is found by the placeholder's own flat colours instead.

The NAME box is whatever else changed, outside the photo window, at a lower
threshold so anti-aliased text edges are not missed.
"""
import glob, json, os, re
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ORIG, CLEAN = os.path.join(HERE, 'canva'), os.path.join(HERE, 'clean')
OUT = os.path.join(HERE, 'templates.json')

# id, label, category, accent
META = {
    '14.png':                 ('elite-emerald', 'Elite Emerald', 'Rank',  '#28e07a'),
    'EMERALD.png':            ('emerald',       'Emerald',       'Rank',  '#28e07a'),
    'GOLD.png':               ('gold',          'Gold',          'Rank',  '#e8b23a'),
    'SAPPHIRE.png':           ('sapphire',      'Sapphire',      'Rank',  '#3a7be0'),
    'SILVER.png':             ('silver',        'Silver',        'Rank',  '#c3ccd6'),
    'Club 4.png':             ('club-4',        'Club 4',        'Club',  '#a855f7'),
    'mission30.png':          ('mission-30',    'Mission 30',    'Club',  '#8dfa00'),
    'amplified.png':          ('amplified',     'Amplified Bonus', 'Club', '#22d3ee'),
    'welcome.png':            ('welcome',       'Welcome',       'Club',  '#8dfa00'),
    '5.png':                  ('jacksonville-we',  'Jacksonville (We are)', 'Event', '#8dfa00'),
    'all in - elevate.png':   ('jacksonville-im',  'Jacksonville (I am)',   'Event', '#8dfa00'),
    '7.png':                  ('cyprus-we',        'Cyprus (We are)',       'Event', '#8dfa00'),
    'cyprus.png':             ('cyprus-im',        'Cyprus (I am)',         'Event', '#8dfa00'),
    '8.png':                  ('kenya',            'Kenya',                 'Event', '#8dfa00'),
}

# Josefin Sans Bold sizes read off Canva, per page size
NAME_SIZE = {1080: 51, 800: 34}


def comps(mask, min_area=250):
    h, w = mask.shape
    parent = {}
    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]; x = parent[x]
        return x
    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb: parent[rb] = ra
    labels = np.zeros((h, w), dtype=np.int32); nxt = 1
    for y in range(h):
        row = mask[y]; x = 0
        while x < w:
            if not row[x]: x += 1; continue
            x0 = x
            while x < w and row[x]: x += 1
            neigh = set()
            if y > 0:
                seg = labels[y-1, max(0, x0-1):min(w, x+1)]
                neigh = {int(v) for v in np.unique(seg) if v}
            if neigh:
                lab = min(neigh)
                for n in neigh: union(lab, n)
            else:
                lab = nxt; parent[lab] = lab; nxt += 1
            labels[y, x0:x] = lab
    if nxt == 1: return []
    roots = np.zeros(nxt, dtype=np.int32)
    for l in range(1, nxt): roots[l] = find(l)
    merged = roots[labels.ravel()].reshape(h, w)
    out = []
    ids, counts = np.unique(merged[merged > 0], return_counts=True)
    for i, c in zip(ids, counts):
        if c < min_area: continue
        ys, xs = np.where(merged == i)
        out.append({'bbox': [int(xs.min()), int(ys.min()),
                             int(xs.max()-xs.min()+1), int(ys.max()-ys.min()+1)], 'area': int(c)})
    out.sort(key=lambda d: -d['area'])
    return out


def placeholder_window(im):
    """Fallback: locate the flat sky/hill/cloud placeholder graphic itself."""
    a = np.asarray(im.convert('RGB')).astype(int)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    m = ((abs(r-136) < 26) & (abs(g-162) < 26) & (b < 60)) | \
        ((r > 195) & (r < 250) & (g > 230) & (b > 248)) | \
        ((r > 250) & (g > 250) & (b > 250))
    c = comps(m, min_area=2000)
    return c[0]['bbox'] if c else None


templates = []
for path in sorted(glob.glob(os.path.join(ORIG, '*.png'))):
    fn = os.path.basename(path)
    if fn not in META:
        print('skip (no metadata):', fn); continue
    tid, label, category, accent = META[fn]
    a = np.asarray(Image.open(path).convert('RGB')).astype(int)
    b = np.asarray(Image.open(os.path.join(CLEAN, fn)).convert('RGB')).astype(int)
    H, W = a.shape[:2]
    delta = np.abs(a - b).sum(axis=2)

    photo = comps(delta > 26, min_area=3000)
    win = photo[0]['bbox'] if photo else None
    fill = photo[0]['area'] / (win[2]*win[3]) if photo else 0
    shape = 'circle' if 0.70 < fill < 0.86 and abs(win[2]-win[3])/max(win[2], win[3]) < 0.10 else 'rect'

    # amplified's placeholder survived the cleanup, so the diff finds nothing useful
    if fn == 'amplified.png' or win is None or win[2] < W*0.10 or win[3] < H*0.06:
        win = placeholder_window(Image.open(path))
        shape = 'rect'
        print(f'{fn}: used placeholder-colour fallback -> {win}')

    # NAME box: everything else that changed, at a looser threshold
    soft = delta > 10
    x, y, w, h = win
    pad = 8
    soft[max(0, y-pad):y+h+pad, max(0, x-pad):x+w+pad] = False
    text = comps(soft, min_area=120)
    if text:
        x0 = min(c['bbox'][0] for c in text); y0 = min(c['bbox'][1] for c in text)
        x1 = max(c['bbox'][0]+c['bbox'][2] for c in text)
        y1 = max(c['bbox'][1]+c['bbox'][3] for c in text)
        name_box = [x0, y0, x1-x0, y1-y0]
    else:
        name_box = None

    templates.append({
        'id': tid, 'label': label, 'category': category, 'accent': accent,
        'art': f'art/{tid}.png',
        'w': W, 'h': H,
        'photo': {'shape': shape,
                  'x': round(win[0]/W, 5), 'y': round(win[1]/H, 5),
                  'w': round(win[2]/W, 5), 'h': round(win[3]/H, 5)},
        'name': ({'x': round((name_box[0]+name_box[2]/2)/W, 5),
                  'y': round((name_box[1]+name_box[3])/H, 5),
                  'maxWidth': round(min(0.92, (name_box[2]*1.9)/W), 5),
                  'size': round(NAME_SIZE[W]/ (W/ (W/ (H/H))) / W, 5) if False else round(NAME_SIZE[W]/W, 5),
                  'font': 'Josefin Sans', 'weight': 700, 'color': '#ffffff',
                  'align': 'center', 'case': 'upper'}
                 if name_box else None),
        '_name_px': name_box,
        '_photo_px': win,
        '_fill': round(float(fill), 3),
    })

with open(OUT, 'w') as f:
    json.dump({'version': 2, 'source': 'VIAGO Canva "Viago Rank & Event Recognition"',
               'templates': templates}, f, indent=2)

print()
for t in templates:
    print(f"{t['id']:20s} {t['w']}x{t['h']:<5d} {t['photo']['shape']:>6s} "
          f"photo={t['_photo_px']}  name={t['_name_px']}")
print(f"\n{len(templates)} templates -> {OUT}")
