"""Standalone smoke-test for exporter, no Rhino installation required.
Run: python test_export_core.py
"""
import ast
import datetime
import json
import math
import mimetypes
import os
from pathlib import Path
import re
import tempfile
import uuid
import fitz

SCRIPT = Path(__file__).with_name('planpin_export_gh.py')
source = ast.parse(SCRIPT.read_text(encoding='utf-8'))
functions = [node for node in source.body if isinstance(node, ast.FunctionDef)]
config_names = {'VALID_CATEGORY', 'VALID_STATUS', 'VALID_PRIORITY',
                'CATEGORY_MAP', 'STATUS_MAP', 'PRIORITY_MAP'}
config = [node for node in source.body if isinstance(node, ast.Assign) and
          any(isinstance(t, ast.Name) and t.id in config_names for t in node.targets)]
ns = dict(datetime=datetime, json=json, math=math, mimetypes=mimetypes,
          os=os, re=re, uuid=uuid, fitz=fitz)
exec(compile(ast.Module(body=config + functions, type_ignores=[]), str(SCRIPT), 'exec'), ns)

with tempfile.TemporaryDirectory() as d:
    # Construct a 2-page replacement for Rhino source PDF
    source_path = os.path.join(d, 'source.pdf')
    final_path = os.path.join(d, 'final.pdf')
    source_pdf = fitz.open()
    source_pdf.new_page(width=600, height=420)
    source_pdf.new_page(width=800, height=600)
    source_pdf.save(source_path)
    source_pdf.close()

    params = dict(OutputFolder=d, FileName='sample.pdf', tolerance=0.00001,
                  RemarkIds=[], Title=['A', 'B', 'C'],
                  Comment=['door 01', 'Check wall', 'Long description'],
                  Reference=['room 1','room 2','room 3'],
                  Category=['technical', 'ontwerp', 'other'],
                  Status=['open', 'in behandeling', 'resolved'],
                  Priority=['medium', 'hoog', 'low'], Images=None)
    boxes = [(0, 0, 100, 70), (110, 0, 210, 70)]
    remarks = [(10, 15, 20, 25), (125, 15, 150, 35), (50, 45, 60, 55)]
    manifest, assigned, attachments = ns['build_manifest_and_assignments'](boxes, remarks, params)
    assert assigned == [[0, 2], [1]]
    assert manifest['issues'][0]['x'] == 0.15
    assert math.isclose(manifest['issues'][0]['y'], 1 - 20 / 70, abs_tol=1e-8)
    assert manifest['issues'][1]['pageNumber'] == 2
    assert manifest['issues'][1]['category'] == 'design'
    assert manifest['issues'][1]['status'] == 'in progress'
    assert manifest['issues'][1]['priority'] == 'high'
    assert manifest['issues'][2]['issuePageNumber'] == 6
    assert ns['build_manifest_and_assignments'](boxes, remarks, params)[0]['issues'][0]['id'] == manifest['issues'][0]['id']
    logs = []
    serialized = ns['_render_final_pdf'](source_path, final_path, manifest, attachments, logs)
    output_pdf = fitz.open(final_path)
    assert output_pdf.page_count == 6
    assert sorted(output_pdf.embfile_names()) == ['planpin-manifest.json', 'planpin-source.pdf']
    embedded_manifest = json.loads(output_pdf.embfile_get('planpin-manifest.json'))
    assert embedded_manifest == manifest
    assert json.loads(serialized) == manifest
    embedded_pdf = fitz.open(stream=output_pdf.embfile_get('planpin-source.pdf'),filetype='pdf')
    assert embedded_pdf.page_count == 2
    assert len(output_pdf[0].get_links()) >= 1
    assert len(output_pdf[2].get_links()) >= 1
    assert len(output_pdf[3].get_links()) >= 1
    embedded_pdf.close()
    output_pdf.close()
    # Invalid/ambiguous page assignment should fail rather than silently misplace remarks
    try:
        ns['build_manifest_and_assignments'](boxes, [(95, 10, 115, 20)], dict(params, Title=[], Comment=[], Reference=[], Category=[], Status=[], Priority=[]))
    except ValueError as exc:
        assert 'exactly one' in str(exc)
    else:
        raise AssertionError('Expected a ValueError on overlapping/missing boundary')
    print('PASS: 2-page source, 3 issues, full manifest roundtrip, correct page links and safety validation')


# Regression: v0.1 incorrectly rejected rotated and slightly irregular remark outlines.
# These lightweight geometry doubles exercise validation without Rhino installed.
class _Pt:
    def __init__(self, x, y, z=0):
        self.X, self.Y, self.Z = x, y, z

class _BB:
    def __init__(self, mn, mx):
        self.Min, self.Max = mn, mx

class _Curve:
    def __init__(self, mn, mx, length, closed=True):
        self.bb = _BB(mn, mx)
        self.length = length
        self.IsClosed = closed

    def GetBoundingBox(self, accurate):
        return self.bb

    def GetLength(self):
        return self.length

# Diamond with bbox dimensions 20 x 20; perimeter 4 * sqrt(200), not 80.
rotated = _Curve(_Pt(10, 10), _Pt(30, 30), 4 * math.sqrt(200))
assert ns['_get_box'](rotated, 'RemarkRectangles[50]', 1e-6,
                      require_axis_aligned=False) == (10.0, 10.0, 30.0, 30.0)
assert ns['_normalize_point']((0, 0, 100, 100), (10, 10, 30, 30)) == (0.2, 0.8)
try:
    ns['_get_box'](rotated, 'PdfBoundaries[0]', 1e-6)
except ValueError as exc:
    assert 'axis-aligned' in str(exc)
else:
    raise AssertionError('Rotated PDF boundaries must still be rejected')

irregular = _Curve(_Pt(10, 10), _Pt(30, 30), 95)
assert ns['_get_box'](irregular, 'RemarkRectangles[51]', 1e-6,
                      require_axis_aligned=False) == (10.0, 10.0, 30.0, 30.0)

open_curve = _Curve(_Pt(10, 10), _Pt(30, 30), 80, closed=False)
try:
    ns['_get_box'](open_curve, 'RemarkRectangles[52]', 1e-6,
                   require_axis_aligned=False)
except ValueError as exc:
    assert 'not a closed' in str(exc)
else:
    raise AssertionError('Open remark outlines should still be rejected')

print('PASS: rotated/irregular remark outlines accepted; PDF boundaries remain strict')