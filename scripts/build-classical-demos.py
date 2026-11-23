"""Optional maintainer rebuild; the browser/app build does not need Python/uv.
Run: python3 scripts/build-classical-demos.py
Needs uv (python-ly 0.9.9 is pinned). Original sources stay unchanged.
"""
from pathlib import Path
import hashlib
import json
import subprocess
import tempfile
import zipfile
import xml.etree.ElementTree as E

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public/demos'
SOURCES = OUT / 'sources'
for item in json.loads((ROOT / 'docs/DEMO_SOURCES.lock.json').read_text())['files']:
    assert hashlib.sha256((ROOT / item['path']).read_bytes()).hexdigest() == item['sha256'], item['path']

entries = [
    ('bach-invention-01', 'bach-invention-01.musicxml', 'Invention No. 1 · BWV 772', 96, 'https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=40'),
    ('wtk1-prelude1', 'bach-prelude-bwv846.musicxml', 'Prelude in C major · BWV 846', 60, 'https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=5'),
    ('mozart', 'mozart-k545-opening.musicxml', 'Piano Sonata K. 545 · Allegro (opening)', 132, 'https://github.com/cuthbertLab/music21/blob/master/music21/corpus/mozart/k545/movement1_exposition.mxl'),
]
with tempfile.TemporaryDirectory(prefix='modscore-classical-') as workdir:
    for original, filename, title, bpm, url in entries:
        if original == 'mozart':
            with zipfile.ZipFile(SOURCES / 'mozart-k545-source.mxl') as archive:
                name = next(n for n in archive.namelist() if n.endswith('.xml') and not n.startswith('META-INF/'))
                root = E.fromstring(archive.read(name))
            measure = root.find("part/measure[@number='7']")
            # Only the first B3 chord member is an error; the later B3 is genuine.
            wrong = next(n for n in measure.findall('note') if n.findtext('pitch/step') == 'B' and n.findtext('pitch/octave') == '3')
            wrong.find('pitch/step').text = 'C'
            wrong.find('pitch/octave').text = '4'
        else:
            target = Path(workdir) / 'conversion.musicxml'
            subprocess.run(['uvx', '--from', 'python-ly==0.9.9', 'ly', 'musicxml', str(SOURCES / (original + '.ly')), '-o', str(target)], check=True, capture_output=True)
            root = E.parse(target).getroot()
        part = root.find('part')
        for measure in list(part):
            if not len(measure):
                part.remove(measure)
        if original == 'wtk1-prelude1':
            for note in root.findall('.//note'):
                if note.findtext('staff', '1') == '1' and note.find('pitch') is not None:
                    octave = note.find('pitch/octave')
                    octave.text = str(int(octave.text) + 1)
        identification = root.find('identification')
        for child in list(identification):
            if child.tag not in ['creator', 'rights', 'encoding', 'source', 'miscellaneous']:
                identification.remove(child)
        E.SubElement(identification, 'source').text = url
        if original == 'mozart':
            E.SubElement(identification, 'creator', {'type': 'composer'}).text = 'Wolfgang Amadeus Mozart'
            E.SubElement(identification, 'rights').text = 'Public-domain composition. Digital source: music21 corpus (cuthbertLab/music21); BSD-3-Clause repository license and notice in sources/music21-LICENSE.txt. Opening measures 1–12, not the complete movement.'
            for direction in root.findall('.//direction'):
                if direction.find('direction-type/words') is not None and direction.find('sound') is None:
                    E.SubElement(direction, 'sound', {'tempo': '132'})
        work = E.Element('work')
        E.SubElement(work, 'work-title').text = title
        root.insert(0, work)
        for scorepart in root.findall('.//score-part'):
            scorepart.find('part-name').text = 'Piano'
        attributes = part.find('measure/attributes')
        if original != 'mozart' and attributes.find("clef[@number='1']") is None:
            clef = E.SubElement(attributes, 'clef', {'number': '1'})
            E.SubElement(clef, 'sign').text = 'G'
            E.SubElement(clef, 'line').text = '2'
        if attributes.find('key') is None:
            key = E.SubElement(attributes, 'key')
            E.SubElement(key, 'fifths').text = '0'
            E.SubElement(key, 'mode').text = 'major'
        direction = E.Element('direction')
        marking = E.SubElement(E.SubElement(direction, 'direction-type'), 'metronome')
        E.SubElement(marking, 'beat-unit').text = 'quarter'
        E.SubElement(marking, 'per-minute').text = str(bpm)
        E.SubElement(direction, 'sound', {'tempo': str(bpm)})
        part.find('measure').insert(1, direction)
        for measure in part.findall('measure'):
            measure.attrib.pop('width', None)
            if int(measure.attrib['number']) > 1 and (int(measure.attrib['number']) - 1) % 3 == 0:
                E.SubElement(measure, 'print', {'new-system': 'yes'})
        E.ElementTree(root).write(OUT / filename, encoding='utf-8', xml_declaration=True)
        print(filename)
