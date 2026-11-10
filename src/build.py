"""Assemble the single-file Crystal Draft page.

Reads template.html, engine.js, app.js, gods.json and portraits/ next to this
script, and writes index.html at the repository root.
"""
import base64
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent
REPO = ROOT.parent

gods = json.loads((ROOT / 'gods.json').read_text())
for god in gods:
    portrait = ROOT / 'portraits' / f"{god['id']}.webp"
    god['image'] = 'data:image/webp;base64,' + base64.b64encode(portrait.read_bytes()).decode()

html = (ROOT / 'template.html').read_text()
replacements = {
    'GODS': json.dumps(gods, separators=(',', ':')),
    'ENGINE': (ROOT / 'engine.js').read_text(),
    'APP': (ROOT / 'app.js').read_text(),
}
for key, value in replacements.items():
    html = html.replace('__' + key + '__', value.replace('</script', '<\\/script'))

if '__' in html and any(token in html for token in ('__GODS__', '__ENGINE__', '__APP__', '__PEERJS__')):
    raise SystemExit('build.py left an unreplaced template token')

out = REPO / 'index.html'
out.write_text(html)
print('HTML bytes:', len(html.encode()), 'Portraits:', len(gods), 'Output:', out.name)
