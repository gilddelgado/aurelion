<p align="center"><img src="assets/brand/aurelion-logo.svg" alt="AURELION" width="520"></p>

# AURELION

A landing page and configurator for the Lamborghini Aventador LP 700-4.

## Pages

| Page | |
|---|---|
| `index.html` | Landing page: test-drive video, the one-part-at-a-time walkthrough, factory figures, starter builds, engineering, specs, cockpit and booking. |
| `configure.html` | Picture configurator. Paint, wheel finish, brake calipers and interior leather each change on their own. Front, side, rear, wheel, cabin and night views, with previews of the rear wing, lights, doors and front axle lift. |
| `configure-3d.html` | The same configurator in real-time 3D, for rotating the car. |

## Run locally

```
python3 -m http.server
```

Then open http://localhost:8000. The configurators need a server: browsers block them when the HTML files are opened straight from the folder.

## Project structure

```
css/      fonts, site, landing, configurator and compiled Tailwind styles
js/       site.js (landing page) and configurator/ (state, panel, picture stage, 3D viewer)
data/     options.json (options and sources), views.json (picture layers), outlines.json (drawings)
assets/   brand/, fonts/, img/, models/, video/, views/
vendor/   three.js r186
tools/    scripts that build the model, pictures, video, drawings and logo
```

## Rebuilding assets

```
npm install
npm run css                          # Tailwind
npm run prep-model                   # needs the source model in assets/models/source/
pip install playwright pillow opencv-python numpy && python -m playwright install chromium
python tools/render_views.py         # configurator pictures
python tools/render_stills.py        # landing images
python tools/optimize_assets.py      # WebP and phone-size copies
python tools/render_drive.py         # hero video (needs ffmpeg)
python tools/render_outlines.py && python tools/build_illustrations.py
python tools/build_logo.py           # logo files
python tools/check_isolation.py      # each option changes only its own part
```

## Credits

- 3D model: [“( FREE ) Lamborghini Aventador LP 700-4”](https://sketchfab.com/3d-models/free-lamborghini-aventador-lp-700-4-df69d51ba10146f79c8c765810ca2132) by SDC PERFORMANCE™️, licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Modified: materials adjusted, rear wing separated, parts simplified and compressed.
- [three.js](https://threejs.org/), MIT licence (`vendor/three/LICENSE.txt`).
- Fonts: Inter and Space Grotesk (SIL Open Font License 1.1), Syncopate (Apache License 2.0). Licences in `assets/fonts/`.
- Option and specification sources are listed in `data/options.json` and at the bottom of the configurator.

AURELION is not affiliated with or endorsed by Automobili Lamborghini S.p.A. Lamborghini and Aventador are trademarks of their owner.
