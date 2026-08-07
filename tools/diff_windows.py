#!/usr/bin/env python3
"""
Derive exact photo windows and NAME text boxes by diffing Matt's original
Canva export (placeholder + NAME present) against the cleaned export
(both removed). Whatever changed is exactly what we need to reproduce.
"""
import glob, json, os
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ORIG = os.path.join(HERE, 'canva')
CLEAN = os.path.join(HERE, 'clean')

def components(mask, min_area=400):
    """Label 4-connected runs, return (bbox, area, mask) per component, largest first."""
    h, w = mask.shape
    parent = {}
    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]; x = parent[x]
        return x
    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb: parent[rb] = ra
    labels = np.zeros((h, w), dtype=np.int32)
    nxt = 1
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
        m = merged == i
        ys, xs = np.where(m)
        out.append({
            'bbox': [int(xs.min()), int(ys.min()), int(xs.max()-xs.min()+1), int(ys.max()-ys.min()+1)],
            'area': int(c), 'mask': m,
        })
    out.sort(key=lambda d: -d['area'])
    return out

result = {}
for path in sorted(glob.glob(os.path.join(ORIG, '*.png'))):
    name = os.path.basename(path)
    cpath = os.path.join(CLEAN, name)
    if not os.path.exists(cpath):
        result[name] = {'error': 'no cleaned counterpart'}; continue
    a = np.asarray(Image.open(path).convert('RGB')).astype(int)
    b = np.asarray(Image.open(cpath).convert('RGB')).astype(int)
    if a.shape != b.shape:
        result[name] = {'error': f'size mismatch {a.shape} vs {b.shape}'}; continue
    H, W = a.shape[:2]
    delta = np.abs(a - b).sum(axis=2)
    changed = delta > 26

    comps = components(changed)
    if not comps:
        result[name] = {'error': 'no differences found'}; continue

    photo = comps[0]
    px, py, pw, ph = photo['bbox']
    fill = photo['area'] / (pw * ph)
    # a circle inscribed in its bbox fills pi/4 = 0.785 of it
    shape = 'circle' if 0.70 < fill < 0.86 and abs(pw - ph) / max(pw, ph) < 0.10 else 'rect'

    # the NAME box is the union of every other changed region
    rest = [c for c in comps[1:]]
    text_box = None
    if rest:
        xs0 = min(c['bbox'][0] for c in rest)
        ys0 = min(c['bbox'][1] for c in rest)
        xs1 = max(c['bbox'][0] + c['bbox'][2] for c in rest)
        ys1 = max(c['bbox'][1] + c['bbox'][3] for c in rest)
        text_box = [xs0, ys0, xs1 - xs0, ys1 - ys0]

    result[name] = {
        'size': [W, H],
        'photo_px': [px, py, pw, ph],
        'photo_frac': [round(px/W, 4), round(py/H, 4), round(pw/W, 4), round(ph/H, 4)],
        'shape': shape,
        'fill': round(float(fill), 3),
        'name_px': text_box,
        'name_frac': [round(text_box[0]/W, 4), round(text_box[1]/H, 4),
                      round(text_box[2]/W, 4), round(text_box[3]/H, 4)] if text_box else None,
        'regions': len(comps),
    }

print(json.dumps(result, indent=2))
