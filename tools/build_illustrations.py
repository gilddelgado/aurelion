"""Writes the engineering drawings into index.html from data/outlines.json.

Usage: python tools/build_illustrations.py
"""
import json, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = json.load(open(os.path.join(ROOT, 'data', 'outlines.json')))
GROUND = 233
MONO = (201, 371)


def pts(path):
    return [tuple(map(float, p.split())) for p in re.findall(r'(-?[\d.]+ -?[\d.]+)', path)]


def top_envelope(poly, x):
    ys = []
    for (x1, y1), (x2, y2) in zip(poly, poly[1:] + poly[:1]):
        if (x1 - x) * (x2 - x) <= 0 and x1 != x2:
            ys.append(y1 + (y2 - y1) * (x - x1) / (x2 - x1))
    return min(ys) if ys else None


def streamline(poly, offset, x0=0, x1=600, step=10):
    xs = list(range(x0, x1 + 1, step))
    raw = []
    for x in xs:
        y = top_envelope(poly, x)
        raw.append(None if y is None else y - offset)
    known = [(x, y) for x, y in zip(xs, raw) if y is not None]
    first, last = known[0], known[-1]
    ys = []
    for x, y in zip(xs, raw):
        if y is None:
            y = first[1] if x < first[0] else last[1] + 10 * min(1, (x - last[0]) / 40)
        ys.append(y)
    for _ in range(3):
        ys = [ys[0]] + [(ys[i - 1] + 2 * ys[i] + ys[i + 1]) / 4 for i in range(1, len(ys) - 1)] + [ys[-1]]
    return 'M' + ' L'.join(f'{x} {y:.1f}' for x, y in zip(xs, ys))


side, top, wheels = D['side'], D['top'], D['wheels']
near = sorted([w for w in wheels if w['top'][1] > 165], key=lambda w: w['side'][0])
front_axle = sum(w['top'][0] for w in wheels[:2]) / 2
rear_axle = sum(w['top'][0] for w in wheels[2:]) / 2
body = ' '.join(side['body'])
silhouette = pts(side['silhouette'][0])
wing = side['wing'][0]
pivot = D['wing_pivot']

wheel_svg = ''.join(
    f'<g transform="translate({w["side"][0]} {w["side"][1]})"><circle r="{w["r"] - 1.2:.1f}"/><circle r="{w["r"] * 0.7:.1f}" stroke-opacity=".45"/>'
    + ''.join(f'<line x1="0" y1="-{w["r"] * 0.16:.1f}" x2="0" y2="-{w["r"] * 0.66:.1f}" transform="rotate({a})" stroke-opacity=".35"/>' for a in range(0, 360, 72))
    + '</g>' for w in near)
glass_svg = ''.join(f'<path d="{g}"/>' for g in side['glass'])

defs = f'''<svg width="0" height="0" style="position:absolute" aria-hidden="true">
            <defs>
                <pattern id="carbon" width="8" height="8" patternUnits="userSpaceOnUse">
                    <rect width="8" height="8" fill="#141414"/>
                    <rect width="4" height="4" fill="#262626"/>
                    <rect x="4" y="4" width="4" height="4" fill="#262626"/>
                </pattern>
                <pattern id="alu-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                    <rect width="6" height="6" fill="rgba(255,255,255,0.02)"/><line x1="0" y1="0" x2="0" y2="6" stroke="rgba(200,205,210,0.28)" stroke-width="1.2"/>
                </pattern>
                <linearGradient id="goldLine" x1="0" x2="1">
                    <stop offset="0" stop-color="#e6b31e" stop-opacity="0"/>
                    <stop offset=".5" stop-color="#e6b31e"/>
                    <stop offset="1" stop-color="#ff6b00" stop-opacity=".2"/>
                </linearGradient>
                <linearGradient id="scanGlow" x1="0" x2="1">
                    <stop offset="0" stop-color="#e6b31e" stop-opacity="0"/>
                    <stop offset=".85" stop-color="#e6b31e" stop-opacity=".35"/>
                    <stop offset="1" stop-color="#fff2c4" stop-opacity=".9"/>
                </linearGradient>
                <clipPath id="clip-aventador-body"><path d="{body}"/></clipPath>
                <symbol id="aventador-body" viewBox="0 0 600 260">
                    <path d="{body}" fill="rgba(255,255,255,0.02)" stroke="rgba(255,255,255,0.55)" stroke-width="1.4" stroke-linejoin="round"/>
                    <g fill="rgba(230,179,30,0.08)" stroke="rgba(255,255,255,0.35)" stroke-linejoin="round">{glass_svg}</g>
                    <g fill="none" stroke="rgba(255,255,255,0.6)" stroke-width="1.4">{wheel_svg}</g>
                    <line x1="0" y1="{GROUND}" x2="600" y2="{GROUND}" stroke="rgba(255,255,255,0.12)"/>
                </symbol>
                <symbol id="aventador-side" viewBox="0 0 600 260">
                    <use href="#aventador-body"/>
                    <path d="{wing}" fill="rgba(255,255,255,0.02)" stroke="rgba(255,255,255,0.55)" stroke-width="1.2" stroke-linejoin="round"/>
                </symbol>
            </defs>
        </svg>'''

m0, m1 = MONO
chassis = f'''<svg viewBox="0 0 600 260" class="w-[92%] h-auto relative float-anim" role="img" aria-label="Side view of the Aventador LP 700-4 with the carbon-fibre monocoque highlighted between the aluminium front and rear frames">
                            <use href="#aventador-side"/>
                            <g clip-path="url(#clip-aventador-body)">
                                <rect x="0" y="0" width="{m0}" height="{GROUND}" fill="url(#alu-hatch)"/>
                                <rect x="{m1}" y="0" width="{600 - m1}" height="{GROUND}" fill="url(#alu-hatch)"/>
                                <rect x="{m0}" y="0" width="{m1 - m0}" height="{GROUND}" fill="url(#carbon)" fill-opacity=".92"/>
                                <rect class="mono-scan" x="{m0 - 46}" y="0" width="46" height="{GROUND}" fill="url(#scanGlow)"/>
                                <g stroke="#e6b31e" stroke-width="2"><line x1="{m0}" y1="0" x2="{m0}" y2="{GROUND}"/><line x1="{m1}" y1="0" x2="{m1}" y2="{GROUND}"/></g>
                            </g>
                            <path d="{body}" fill="none" stroke="#e6b31e" stroke-width="1.6" stroke-linejoin="round" clip-path="url(#clip-mono-band)"/>
                            <clipPath id="clip-mono-band"><rect x="{m0}" y="0" width="{m1 - m0}" height="{GROUND}"/></clipPath>
                            <g class="data-font" font-size="11" letter-spacing="2">
                                <line x1="{(m0 + m1) / 2:.0f}" y1="104" x2="{(m0 + m1) / 2:.0f}" y2="38" stroke="#e6b31e" stroke-opacity=".6"/>
                                <circle cx="{(m0 + m1) / 2:.0f}" cy="104" r="3" fill="#e6b31e"/>
                                <text x="{(m0 + m1) / 2:.0f}" y="28" text-anchor="middle" fill="#e6b31e">CARBON MONOCOQUE · 147.5 KG</text>
                                <text x="96" y="252" text-anchor="middle" fill="#9a9a9a" font-size="9.5">ALUMINIUM FRONT FRAME</text>
                                <text x="492" y="252" text-anchor="middle" fill="#9a9a9a" font-size="9.5">ALUMINIUM REAR FRAME</text>
                            </g>
                        </svg>'''

tb = ' '.join(top['body'])
tglass = ''.join(f'<path d="{g}"/>' for g in top['glass'])
cy = 165
gear = (300, 352)
engine = (356, 446)
cyl = ''.join(f'<circle cx="{engine[0] + 10 + i * 14.6:.1f}" cy="{cy - 17}" r="5.6"/><circle cx="{engine[0] + 10 + i * 14.6:.1f}" cy="{cy + 17}" r="5.6"/>' for i in range(6))
tyres = ''.join(f'<rect x="{w["top"][0] - w["r"]:.1f}" y="{w["top"][1] - 13:.1f}" width="{2 * w["r"]:.1f}" height="26" rx="5"/>' for w in wheels)
fw = [w for w in wheels if abs(w['top'][0] - front_axle) < 5]
rw = [w for w in wheels if abs(w['top'][0] - rear_axle) < 5]
powertrain = f'''<svg viewBox="0 0 600 330" class="w-full h-auto relative" role="img" aria-label="Plan view of the Aventador LP 700-4 drivetrain: V12 behind the cabin, 7-speed ISR gearbox ahead of it in the centre tunnel, a shaft to the Haldex IV coupling at the front axle, and the rear differential">
                            <path d="{tb}" fill="rgba(255,255,255,0.02)" stroke="rgba(255,255,255,0.4)" stroke-width="1.4" stroke-linejoin="round"/>
                            <g fill="rgba(230,179,30,0.05)" stroke="rgba(255,255,255,0.18)">{tglass}</g>
                            <g fill="#1b1b1b" stroke="rgba(255,255,255,0.5)">{tyres}</g>
                            <g fill="none" stroke="rgba(255,255,255,0.22)"><rect x="262" y="{cy - 62}" width="46" height="36" rx="9"/><rect x="262" y="{cy + 26}" width="46" height="36" rx="9"/></g>
                            <g fill="none" stroke="#e6b31e" stroke-width="2" class="flow">
                                <path d="M{gear[0]} {cy} L{front_axle + 14:.1f} {cy}"/>
                                <path d="M{front_axle:.1f} {cy - 12} L{front_axle:.1f} {fw[0]['top'][1] + 13:.1f}"/><path d="M{front_axle:.1f} {cy + 12} L{front_axle:.1f} {fw[1]['top'][1] - 13:.1f}"/>
                                <path d="M{rear_axle:.1f} {cy - 12} L{rear_axle:.1f} {min(w['top'][1] for w in rw) + 13:.1f}"/><path d="M{rear_axle:.1f} {cy + 12} L{rear_axle:.1f} {max(w['top'][1] for w in rw) - 13:.1f}"/>
                            </g>
                            <rect x="{front_axle - 13:.1f}" y="{cy - 12}" width="26" height="24" rx="4" fill="rgba(230,179,30,0.14)" stroke="#e6b31e"/>
                            <rect x="{gear[0]}" y="{cy - 15}" width="{gear[1] - gear[0]}" height="30" rx="4" fill="#141414" stroke="#e6b31e"/>
                            <g fill="#e6b31e" opacity=".75">{''.join(f'<rect x="{gear[0] + 6 + i * 6.4:.1f}" y="{cy - 9}" width="3.4" height="18"/>' for i in range(7))}</g>
                            <rect x="{engine[0]}" y="{cy - 33}" width="{engine[1] - engine[0]}" height="66" rx="6" fill="#141414" stroke="rgba(255,255,255,0.6)"/>
                            <g fill="none" stroke="#ff6b00" stroke-width="1.5" class="v12-fire">{cyl}</g>
                            <circle cx="{rear_axle:.1f}" cy="{cy}" r="12" fill="rgba(230,179,30,0.14)" stroke="#e6b31e"/>
                            <g class="data-font" font-size="10.5" letter-spacing="1.5" fill="#bbb">
                                <text x="{(engine[0] + engine[1]) / 2:.0f}" y="{cy - 56}" text-anchor="middle" fill="#ff6b00">6.5 L V12</text>
                                <text x="{(engine[0] + engine[1]) / 2:.0f}" y="{cy - 42}" text-anchor="middle" fill="#ff6b00">700 CV</text>
                                <text x="{(gear[0] + gear[1]) / 2:.0f}" y="{cy + 50}" text-anchor="middle">7-SPEED ISR</text>
                                <line x1="{(gear[0] + gear[1]) / 2:.0f}" y1="{cy + 16}" x2="{(gear[0] + gear[1]) / 2:.0f}" y2="{cy + 39}" stroke="#666"/>
                                <text x="{front_axle - 20:.0f}" y="{cy + 4}" text-anchor="end">HALDEX IV</text>
                                <text x="{rear_axle + 18:.0f}" y="{cy + 4}">REAR DIFF</text>
                                <text x="36" y="22" fill="#666">FRONT ←</text>
                            </g>
                        </svg>'''

flow = [streamline(silhouette, o) for o in (14, 36, 60)]
wing_svg = f'''<svg viewBox="0 0 600 300" class="w-full h-auto" role="img" aria-label="Side view of the Aventador LP 700-4 with airflow lines over the body and the active rear wing">
                        <g fill="none" stroke="url(#goldLine)" stroke-width="1.5" class="stream">
                            <path d="{flow[2]}" transform="translate(0 30)"/>
                            <path d="{flow[1]}" transform="translate(0 30)"/>
                            <path d="{flow[0]}" transform="translate(0 30)"/>
                            <path d="M0 {GROUND + 30 - 6} C200 {GROUND + 30 - 8} 400 {GROUND + 30 - 8} 600 {GROUND + 30 - 6}" stroke-opacity=".4"/>
                        </g>
                        <g transform="translate(0,30)">
                            <use href="#aventador-body" width="600" height="260"/>
                            <g id="aero-wing" style="transform-origin:{pivot[0]}px {pivot[1]}px; transition: transform .9s cubic-bezier(.16,1,.3,1); transform: translateY(0) rotate(0deg)">
                                <path d="{wing}" fill="#e6b31e" stroke="#e6b31e" stroke-width="1" stroke-linejoin="round"/>
                            </g>
                            <g id="aero-struts" stroke="rgba(255,255,255,.55)" stroke-width="2" style="opacity:0; transition: opacity .4s">
                                <line x1="{pivot[0] + 12:.1f}" y1="{pivot[1]:.1f}" x2="{pivot[0] + 12:.1f}" y2="{pivot[1] - 8:.1f}"/><line x1="{pivot[0] + 30:.1f}" y1="{pivot[1] - 1:.1f}" x2="{pivot[0] + 30:.1f}" y2="{pivot[1] - 9:.1f}"/>
                            </g>
                        </g>
                    </svg>'''


def replace(html, key, content):
    start, end = f'<!-- {key}:START -->', f'<!-- {key}:END -->'
    a, b = html.index(start) + len(start), html.index(end)
    indent = re.search(r'\n([ \t]*)$', html[:html.index(start)]).group(1)
    return html[:a] + '\n' + indent + content + '\n' + indent + html[b:]


path = os.path.join(ROOT, 'index.html')
html = open(path, encoding='utf-8').read()
for key, content in (('ILLUSTRATIONS-DEFS', defs), ('ILLUSTRATION-CHASSIS', chassis), ('ILLUSTRATION-POWERTRAIN', powertrain), ('ILLUSTRATION-AERO', wing_svg)):
    html = replace(html, key, content)
open(path, 'w', encoding='utf-8').write(html)
print('illustrations written; wing pivot', pivot, 'axles', round(front_axle, 1), round(rear_axle, 1))
