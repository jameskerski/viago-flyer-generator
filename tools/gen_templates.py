#!/usr/bin/env python3
"""
Generates PLACEHOLDER template artwork for the VIAGO recognition flyer tool.

Every template is two PNG layers:
  <id>-<fmt>-bg.png   background art, drawn first
  <id>-<fmt>-fg.png    foreground art, drawn over the person cutout

Matt's real artwork drops in as a straight file swap: same names, same sizes.
Run:  python3 tools/gen_templates.py
"""

import json
import math
import os
import random

from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
ART = os.path.join(HERE, "..", "public", "art")
OUT_JSON = os.path.join(HERE, "..", "public", "templates.json")

BASE = (8, 12, 18)
LIME = "#8dfa00"

FORMATS = {
    "45": (1080, 1350),   # WhatsApp / feed post 4:5
    "916": (1080, 1920),  # Instagram / WhatsApp story 9:16
}

RANKS = [
    ("bronze",        "Bronze",        "#C87B3E"),
    ("silver",        "Silver",        "#C3CCD6"),
    ("gold",          "Gold",          "#E8B23A"),
    ("platinum",      "Platinum",      "#9FB6CC"),
    ("sapphire",      "Sapphire",      "#3A7BE0"),
    ("ruby",          "Ruby",          "#D6294A"),
    ("emerald",       "Emerald",       "#1FB273"),
    ("diamond",       "Diamond",       "#7FD8E8"),
    ("black-diamond", "Black Diamond", "#8dfa00"),
]

EXTRAS = [
    ("welcome", "Welcome",     "#8dfa00", "Welcome"),
    ("event",   "Event",       "#B06CF0", "Event"),
]


def hex_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def radial(size, center, radius, color, alpha):
    """Soft radial glow on its own layer."""
    w, h = size
    layer = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(layer)
    cx, cy = center
    steps = 42
    for i in range(steps, 0, -1):
        r = radius * i / steps
        a = int(alpha * (1 - i / steps) ** 2.0)
        d.ellipse([cx - r, cy - r * 0.92, cx + r, cy + r * 0.92], fill=a)
    layer = layer.filter(ImageFilter.GaussianBlur(radius * 0.12))
    tint = Image.new("RGB", (w, h), color)
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    out.paste(tint, (0, 0), layer)
    return out


def rays(size, accent, count=22):
    """Faint light rays fanning up from the stage floor."""
    w, h = size
    layer = Image.new("RGBA", (w * 2, h * 2), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    cx, cy = w, int(h * 1.72)
    length = h * 2.4
    for i in range(count):
        a = -math.pi / 2 + (i - count / 2) * (math.pi / (count * 1.25))
        spread = 0.012
        p1 = (cx + math.cos(a - spread) * length, cy + math.sin(a - spread) * length)
        p2 = (cx + math.cos(a + spread) * length, cy + math.sin(a + spread) * length)
        d.polygon([(cx, cy), p1, p2], fill=(*hex_rgb(accent), 34 if i % 2 else 20))
    layer = layer.filter(ImageFilter.GaussianBlur(40))
    return layer.resize((w, h), Image.LANCZOS)


def grain(size, amount=6):
    w, h = size
    rnd = random.Random(7)
    small = Image.new("L", (w // 2, h // 2))
    small.putdata([rnd.randint(128 - amount, 128 + amount) for _ in range((w // 2) * (h // 2))])
    n = small.resize((w, h), Image.BILINEAR)
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    out.putalpha(n.point(lambda v: int(abs(v - 128) * 1.4)))
    px = Image.new("RGB", (w, h), (255, 255, 255))
    out = Image.merge("RGBA", (*px.split(), out.split()[3]))
    return out


def vignette(size, strength=150):
    w, h = size
    mask = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(mask)
    steps = 60
    for i in range(steps):
        f = i / steps
        inset = -w * 0.45 + f * w * 0.78
        d.ellipse([inset, inset * (h / w) - h * 0.05,
                   w - inset, h - inset * (h / w) + h * 0.05],
                  outline=int(strength * (f ** 2.2)), width=int(w / steps) + 3)
    mask = mask.filter(ImageFilter.GaussianBlur(w * 0.05))
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    out.putalpha(mask)
    return Image.merge("RGBA", (*Image.new("RGB", (w, h), BASE).split(), mask))


def make_bg(size, accent):
    w, h = size
    img = Image.new("RGBA", (w, h), (*BASE, 255))
    img.alpha_composite(radial((w, h), (w * 0.5, h * 0.40), w * 1.25, accent, 150))
    img.alpha_composite(radial((w, h), (w * 0.5, h * 0.34), w * 0.55, accent, 205))
    img.alpha_composite(radial((w, h), (w * 0.5, h * 0.88), w * 0.75, accent, 120))
    img.alpha_composite(rays((w, h), accent))
    # horizon line where the stage floor sits
    d = ImageDraw.Draw(img)
    y = int(h * 0.845)
    d.rectangle([0, y, w, y + max(2, w // 540)], fill=(*hex_rgb(accent), 90))
    img.alpha_composite(vignette((w, h)))
    img.alpha_composite(grain((w, h)))
    return img.convert("RGB")


def make_fg(size, accent):
    """Overlay drawn on top of the person: bottom scrim, rules, corner marks."""
    w, h = size
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))

    # bottom scrim so text always reads over the photo
    scrim = Image.new("L", (1, h))
    start = int(h * 0.44)
    for y in range(h):
        if y < start:
            scrim.putpixel((0, y), 0)
        else:
            f = (y - start) / (h - start)
            scrim.putpixel((0, y), int(250 * (f ** 1.6)))
    scrim = scrim.resize((w, h))
    img.alpha_composite(Image.merge("RGBA", (*Image.new("RGB", (w, h), BASE).split(), scrim)))

    # top scrim, lighter, keeps the eyebrow line legible
    top = Image.new("L", (1, h))
    for y in range(h):
        f = max(0.0, 1 - y / (h * 0.24))
        top.putpixel((0, y), int(165 * (f ** 1.5)))
    top = top.resize((w, h))
    img.alpha_composite(Image.merge("RGBA", (*Image.new("RGB", (w, h), BASE).split(), top)))

    d = ImageDraw.Draw(img)
    unit = w / 1080

    # accent hairline above the name block
    ry = int(h * (0.735 if h > w * 1.4 else 0.70))
    d.rectangle([w * 0.5 - 42 * unit, ry, w * 0.5 + 42 * unit, ry + 3 * unit],
                fill=(*hex_rgb(accent), 235))

    # corner ticks
    m, ln, th = 46 * unit, 74 * unit, 3 * unit
    for (cx, cy, sx, sy) in ((m, m, 1, 1), (w - m, m, -1, 1),
                             (m, h - m, 1, -1), (w - m, h - m, -1, -1)):
        x0, x1 = sorted([cx, cx + ln * sx])
        y0, y1 = sorted([cy, cy + ln * sy])
        d.rectangle([x0, cy, x1, cy + th], fill=(*hex_rgb(LIME), 120))
        d.rectangle([cx, y0, cx + th, y1], fill=(*hex_rgb(LIME), 120))

    return img


def field(key, label, default, y, size, weight, color, tracking=0.0,
          case="upper", align="center", x=0.5, max_width=0.86, gradient=None,
          multiline=False):
    f = {
        "key": key, "label": label, "default": default,
        "style": {
            "x": x, "y": y, "size": size, "weight": weight, "color": color,
            "tracking": tracking, "case": case, "align": align, "maxWidth": max_width,
        },
    }
    if gradient:
        f["style"]["gradient"] = gradient
    if multiline:
        f["style"]["multiline"] = True
    return f


def rank_fields(rank_label, accent):
    return [
        field("eyebrow", "Top line", "CONGRATULATIONS", 0.088, 0.038, 600, "#ffffff", 0.34),
        field("rank", "Rank", rank_label.upper(), 0.145, 0.082, 800, accent, 0.06,
              gradient=["#ffffff", accent]),
        field("name", "Name", "", 0.795, 0.096, 800, "#ffffff", 0.005),
        field("sub", "Bottom line", "", 0.868, 0.036, 500, "#c9d3dd", 0.20),
    ]


def build():
    os.makedirs(ART, exist_ok=True)
    templates = []

    entries = [(slug, label, accent, "Rank", label) for slug, label, accent in RANKS]
    entries += [(slug, label, accent, cat, label) for slug, label, accent, cat in EXTRAS]

    for slug, label, accent, category, _ in entries:
        tid = f"{'rank' if category == 'Rank' else category.lower()}-{slug}" \
            if category == "Rank" else slug
        formats = {}
        for fmt, size in FORMATS.items():
            bg_name = f"{tid}-{fmt}-bg.jpg"
            fg_name = f"{tid}-{fmt}-fg.png"
            make_bg(size, accent).save(os.path.join(ART, bg_name), quality=90, optimize=True, progressive=True)
            make_fg(size, accent).save(os.path.join(ART, fg_name), optimize=True)
            tall = size[1] / size[0] > 1.5
            formats["9:16" if fmt == "916" else "4:5"] = {
                "w": size[0], "h": size[1],
                "bg": f"art/{bg_name}", "fg": f"art/{fg_name}",
                "personTop": 0.20 if tall else 0.155,
                "personHeight": 0.60 if tall else 0.64,
            }
            print("  wrote", bg_name, "+", fg_name)

        if category == "Rank":
            fields = rank_fields(label, accent)
        elif slug == "welcome":
            fields = [
                field("eyebrow", "Top line", "WELCOME TO THE TEAM", 0.088, 0.038, 600, "#ffffff", 0.30),
                field("rank", "Big line", "WELCOME", 0.145, 0.082, 800, accent, 0.06,
                      gradient=["#ffffff", accent]),
                field("name", "Name", "", 0.795, 0.096, 800, "#ffffff", 0.005),
                field("sub", "Bottom line", "", 0.868, 0.036, 500, "#c9d3dd", 0.20),
            ]
        else:
            fields = [
                field("eyebrow", "Top line", "SEE YOU THERE", 0.088, 0.038, 600, "#ffffff", 0.30),
                field("rank", "Event name", "EVENT", 0.145, 0.078, 800, accent, 0.05,
                      gradient=["#ffffff", accent]),
                field("name", "Name", "", 0.795, 0.090, 800, "#ffffff", 0.005),
                field("sub", "Date and place", "", 0.868, 0.036, 500, "#c9d3dd", 0.20),
            ]

        templates.append({
            "id": tid, "category": category, "label": label,
            "accent": accent, "formats": formats, "fields": fields,
        })

    with open(OUT_JSON, "w") as f:
        json.dump({"version": 1, "placeholder": True, "templates": templates}, f, indent=2)
    print(f"\n{len(templates)} templates -> {OUT_JSON}")


if __name__ == "__main__":
    build()
