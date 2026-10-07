"""Makes WebP copies of the landing images and phone-size picture layers.

Usage: python tools/optimize_assets.py
"""
import glob, os
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMG = os.path.join(ROOT, 'assets', 'img')
VIEWS = os.path.join(ROOT, 'assets', 'views')
SMALL = {'seq-': (800, 1200), 'starter-': (600,)}


def resize(im, width):
    h = round(im.height * width / im.width)
    if im.mode == 'RGBA':
        return im.convert('RGBa').resize((width, h), Image.LANCZOS).convert('RGBA')
    return im.resize((width, h), Image.LANCZOS)


def save(im, path, **kw):
    im.save(path, 'WEBP', method=6, **kw)
    return os.path.getsize(path)


def main():
    before = after = 0
    for src in sorted(glob.glob(os.path.join(IMG, '*.jpg'))):
        name = os.path.splitext(os.path.basename(src))[0]
        im = Image.open(src).convert('RGB')
        before += os.path.getsize(src)
        after += save(im, os.path.join(IMG, f'{name}.webp'), quality=80)
        for prefix, widths in SMALL.items():
            for width in widths if name.startswith(prefix) else ():
                save(resize(im, width), os.path.join(IMG, f'{name}-{width}.webp'), quality=78)
        os.remove(src)
    noise = os.path.join(IMG, 'noise.png')
    if os.path.exists(noise):
        before += os.path.getsize(noise)
        tile = Image.open(noise).convert('RGBA').resize((112, 112), Image.BILINEAR)
        after += save(tile, os.path.join(IMG, 'noise.webp'), quality=40, alpha_quality=50)
        os.remove(noise)
    if before:
        print(f'landing images: {before // 1024} KB -> {after // 1024} KB')

    made = total = 0
    for src in sorted(glob.glob(os.path.join(VIEWS, '*.webp'))):
        if src.endswith('-sm.webp'):
            continue
        dst = src[:-5] + '-sm.webp'
        if os.path.exists(dst) and os.path.getmtime(dst) >= os.path.getmtime(src):
            continue
        im = Image.open(src).convert('RGBA')
        overlay = '-paint-' not in os.path.basename(src)
        total += save(resize(im, 960), dst, quality=85 if overlay else 80, alpha_quality=90)
        made += 1
    if made:
        print(f'picture layers: {made} phone-size copies, {total / 1e6:.1f} MB')


if __name__ == '__main__':
    main()
