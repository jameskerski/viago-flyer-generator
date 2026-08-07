#!/usr/bin/env python3
"""
Reworks the Amplified Bonus artwork so the photo area is taller.

The Canva design is a single flattened image, so this is pixel work:
  - the padlock icon and CONGRATULATIONS are glowing light on a dark
    background, so they are lifted out with a luminance mask and put back
    with a lighten blend. No rectangular patch edges.
  - what they leave behind is filled from a heavily blurred copy of the
    surroundings, feathered in, which reads naturally in a low-detail area.
  - the photo frame is stretched upward 9-slice style, so its corners and
    border thickness stay exactly as drawn.

Run:  python3 tools/rework_amplified.py [--src FILE] [--out FILE]
"""
import argparse, os
from PIL import Image, ImageFilter, ImageChops, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT = os.path.join(HERE, '..', 'public', 'art', 'amplified.jpg')

ICON = (330, 528, 472, 668)        # padlock circle plus its glow
TEXT = (236, 662, 566, 696)        # CONGRATULATIONS
# Region to rebuild behind them. It has to run well past the old wordmark on
# every side, because the feathered mask only reaches full strength inset from
# the edges. The bottom can run under the frame's new position safely, since
# the frame is pasted afterwards and covers it.
CLEAR = (188, 512, 612, 738)

FRAME_TOP, FRAME_BOTTOM = 730, 1050
FRAME_L, FRAME_R = 18, 452
CAP = 42

ICON_SCALE = 0.72
ICON_CY = 578
TEXT_Y = 646
FRAME_LIFT = 45


def feathered_mask(size, box, feather):
    m = Image.new('L', size, 0)
    d = ImageDraw.Draw(m)
    d.rectangle([box[0] + feather, box[1] + feather, box[2] - feather, box[3] - feather], fill=255)
    return m.filter(ImageFilter.GaussianBlur(feather * 0.6))


def light_mask(patch, floor=34, ceil=150):
    """Alpha from brightness, so glow fades out instead of ending at an edge."""
    g = patch.convert('L')
    return g.point(lambda v: 0 if v <= floor else min(255, int((v - floor) * 255 / (ceil - floor))))


def place_light(base, patch, xy):
    """Composite glowing artwork so it only ever adds light."""
    layer = Image.new('RGB', base.size, (0, 0, 0))
    layer.paste(patch, xy)
    alpha = Image.new('L', base.size, 0)
    alpha.paste(light_mask(patch), xy)
    lit = ImageChops.lighter(base, layer)
    return Image.composite(lit, base, alpha)


def stretch_frame(im, lift):
    top = im.crop((FRAME_L, FRAME_TOP, FRAME_R, FRAME_TOP + CAP))
    mid = im.crop((FRAME_L, FRAME_TOP + CAP, FRAME_R, FRAME_BOTTOM - CAP))
    bot = im.crop((FRAME_L, FRAME_BOTTOM - CAP, FRAME_R, FRAME_BOTTOM))
    mid = mid.resize((mid.width, mid.height + lift), Image.LANCZOS)
    new_top = FRAME_TOP - lift
    im.paste(top, (FRAME_L, new_top))
    im.paste(mid, (FRAME_L, new_top + CAP))
    im.paste(bot, (FRAME_L, new_top + CAP + mid.height))
    return new_top


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', default=DEFAULT)
    ap.add_argument('--out', default=DEFAULT)
    a = ap.parse_args()

    im = Image.open(a.src).convert('RGB')
    icon = im.crop(ICON)
    text = im.crop(TEXT)

    # wipe the old icon and wordmark: darken hard, then blend a blurred plate
    # over the area so there is no seam where the fill stops
    dark = im.point(lambda v: int(v * 0.34))
    im = Image.composite(dark, im, feathered_mask(im.size, CLEAR, 26))
    plate = im.filter(ImageFilter.GaussianBlur(38))
    im = Image.composite(plate, im, feathered_mask(im.size, CLEAR, 22))

    nw, nh = round(icon.width * ICON_SCALE), round(icon.height * ICON_SCALE)
    icon = icon.resize((nw, nh), Image.LANCZOS)
    im = place_light(im, icon, (round((ICON[0] + ICON[2]) / 2 - nw / 2), round(ICON_CY - nh / 2)))
    im = place_light(im, text, (TEXT[0], TEXT_Y))

    new_top = stretch_frame(im, FRAME_LIFT)

    im.save(a.out, quality=93, optimize=True, progressive=True)
    print(f'frame top {FRAME_TOP} -> {new_top}  (photo area {FRAME_LIFT}px taller)')
    print('wrote', a.out)


if __name__ == '__main__':
    main()
