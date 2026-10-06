"""Builds the AURELION logo files in assets/brand from the original logo image.

Usage: python tools/build_logo.py
"""
import os, re
import cv2
import numpy as np
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BRAND = os.path.join(ROOT, 'assets', 'brand')
SOURCE = os.path.join(BRAND, 'source', 'aurelion-logo-original.jpg')
S = 8

GOLD_STOPS = [(0, '#ffe697'), (.13, '#f1c34b'), (.34, '#cc8f1d'), (.50, '#7f4c07'), (.62, '#ad7416'),
              (.78, '#ecc455'), (.90, '#d49d2e'), (1, '#7e4b08')]


def trace():
    src = cv2.imread(SOURCE)
    h, w = src.shape[:2]
    ink = np.clip((255 - src[:, :, 0].astype(np.float32)) / 150.0, 0, 1)
    big = cv2.GaussianBlur(cv2.resize(ink, (w * S, h * S), interpolation=cv2.INTER_CUBIC), (0, 0), S * 0.55)
    mask = (big > 0.5).astype(np.uint8) * 255
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (S * 2 + 1, S * 2 + 1)))
    contours, hier = cv2.findContours(mask, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
    hier = hier[0]
    ring = lambda c: 'M' + ' L'.join(f'{x:.2f} {y:.2f}' for x, y in cv2.approxPolyDP(c, 0.3 * S, True).reshape(-1, 2) / S) + 'Z'
    letters = []
    for i, c in enumerate(contours):
        if hier[i][3] != -1 or cv2.contourArea(c) / S / S < 60:
            continue
        rings, k = [c], hier[i][2]
        while k != -1:
            if cv2.contourArea(contours[k]) / S / S > 300:
                rings.append(contours[k])
            k = hier[k][0]
        x, y, bw, bh = cv2.boundingRect(c)
        letters.append(((x / S, y / S, (x + bw) / S, (y + bh) / S), ' '.join(ring(r) for r in rings)))
    letters.sort(key=lambda t: t[0][0])
    return letters


def gold_gradient(gid, y0, y1):
    stops = ''.join(f'<stop offset="{o}" stop-color="{c}"/>' for o, c in GOLD_STOPS)
    return f'<linearGradient id="{gid}" gradientUnits="userSpaceOnUse" x1="0" y1="{y0:.1f}" x2="0" y2="{y1:.1f}">{stops}</linearGradient>'


def logo_svg(letters):
    x0 = min(b[0] for b, _ in letters); y0 = min(b[1] for b, _ in letters)
    x1 = max(b[2] for b, _ in letters); y1 = max(b[3] for b, _ in letters)
    vb = (round(x0 - 3), round(y0 - 3), round(x1 - x0 + 6), round(y1 - y0 + 6))
    paths = ''.join(f'<path d="{d}"/>' for _, d in letters)
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb[0]} {vb[1]} {vb[2]} {vb[3]}" width="{vb[2]}" height="{vb[3]}" role="img" aria-labelledby="t">
  <title id="t">AURELION</title>
  <defs>
    {gold_gradient('gold', y0, y1)}
    <linearGradient id="sheen" gradientUnits="userSpaceOnUse" x1="{x0:.0f}" y1="0" x2="{x1:.0f}" y2="0">
      <stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".3" stop-color="#fff" stop-opacity=".16"/>
      <stop offset=".5" stop-color="#fff" stop-opacity="0"/><stop offset=".72" stop-color="#fff" stop-opacity=".12"/>
      <stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </linearGradient>
    <filter id="bevel" x="-2%" y="-10%" width="104%" height="120%" color-interpolation-filters="sRGB">
      <feGaussianBlur in="SourceAlpha" stdDeviation="1.6" result="blur"/>
      <feSpecularLighting in="blur" surfaceScale="3" specularConstant="1.5" specularExponent="38" lighting-color="#fff6d8" result="spec">
        <feDistantLight azimuth="235" elevation="42"/>
      </feSpecularLighting>
      <feComposite in="spec" in2="SourceAlpha" operator="in" result="specIn"/>
      <feComposite in="SourceGraphic" in2="specIn" operator="arithmetic" k1="0" k2="1" k3="1" k4="0"/>
    </filter>
    <clipPath id="letters">{paths}</clipPath>
  </defs>
  <g filter="url(#bevel)">
    <g fill="url(#gold)">{paths}</g>
    <rect x="{vb[0]}" y="{vb[1]}" width="{vb[2]}" height="{vb[3]}" fill="url(#sheen)" clip-path="url(#letters)"/>
    <g clip-path="url(#letters)" fill="none" stroke="#6e4306" stroke-width="2.4" stroke-linejoin="round" stroke-opacity=".9">{paths}</g>
  </g>
</svg>
'''


def favicon_svg(letters):
    (ax0, ay0, ax1, ay1), a_path = letters[0]
    size = max(ax1 - ax0, ay1 - ay0) * 1.32
    cx, cy = (ax0 + ax1) / 2, (ay0 + ay1) / 2 + (ay1 - ay0) * 0.04
    vx, vy = cx - size / 2, cy - size / 2
    r = size * 0.2
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vx:.1f} {vy:.1f} {size:.1f} {size:.1f}">
  <defs>{gold_gradient('g', ay0, ay1)}</defs>
  <rect x="{vx:.1f}" y="{vy:.1f}" width="{size:.1f}" height="{size:.1f}" rx="{r:.1f}" fill="#0a0a0b"/>
  <path d="{a_path}" fill="url(#g)" stroke="#6e4306" stroke-width="2.5" stroke-linejoin="round"/>
</svg>
'''


def render(svg_name, out_name, width, height):
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={'width': width, 'height': height})
        wrap = os.path.join(BRAND, '_render.html')
        open(wrap, 'w').write(f'<html><body style="margin:0;background:transparent"><img src="{svg_name}" style="display:block;width:{width}px;height:{height}px"></body></html>')
        page.goto('file://' + wrap)
        page.wait_for_timeout(300)
        page.screenshot(path=os.path.join(BRAND, out_name), omit_background=True)
        browser.close()
        os.remove(wrap)


def main():
    letters = trace()
    assert len(letters) == 10, f'expected 10 shapes (A U R E E E L I O N), found {len(letters)}'
    logo = logo_svg(letters)
    open(os.path.join(BRAND, 'aurelion-logo.svg'), 'w').write(logo)
    open(os.path.join(BRAND, 'favicon.svg'), 'w').write(favicon_svg(letters))
    vb = list(map(float, re.search(r'viewBox="([^"]+)"', logo).group(1).split()))
    render('aurelion-logo.svg', 'aurelion-logo.png', 2400, round(2400 * vb[3] / vb[2]))
    render('favicon.svg', 'favicon-32.png', 32, 32)
    render('favicon.svg', 'apple-touch-icon.png', 180, 180)
    for f in sorted(os.listdir(BRAND)):
        if os.path.isfile(os.path.join(BRAND, f)):
            print(f, os.path.getsize(os.path.join(BRAND, f)) // 1024, 'KB')


if __name__ == '__main__':
    main()
