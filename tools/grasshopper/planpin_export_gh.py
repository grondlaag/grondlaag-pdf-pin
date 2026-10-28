#! python 3
# requirements: pymupdf
"""
GRONDLAAG / PlanPin exporter - Rhino 8 / Grasshopper Python 3 (v0.1)

Inputs (rename component inputs EXACTLY as below):
    PdfBoundaries     Curve    List     required; axis-aligned closed XY rectangles
    RemarkRectangles Curve    List     required; axis-aligned closed XY rectangles
    Title            Text     List     optional; index-aligned with remarks
    Comment          Text     List     optional; index-aligned with remarks
    Category         Text     List     optional; index-aligned with remarks
    Status           Text     List     optional; index-aligned with remarks
    Priority         Text     List     optional; index-aligned with remarks
    Reference        Text     List     optional; index-aligned with remarks
    Images           Text     Tree     optional; branch {i} = image paths for remark i
    RemarkIds        Text     List     optional; persistent UUID per remark
    OutputFolder     Text     Item     required
    FileName         Text     Item     optional; defaults to planpin-grasshopper.pdf
    Scale            Number   Item     optional; default 100 (means 1:100)
    Dpi              Integer  Item     optional; default 150
    Export           Boolean  Item     required; connect a Button

Outputs:
    PdfPath          Text     Item     path of last completed file
    RemarkMap        Integer  Tree     branch {page index, zero-based} -> remark indices
    Manifest         Text     Item     generated manifest JSON for inspection
    Log              Text     Item     status and validation messages

Notes:
    - Drawings must be baked or otherwise Rhino-printable in a TOP parallel view.
    - One source PDF page per PDF boundary, in list order. The final PDF includes
      a PlanPin overview + issue pages and embedded PlanPin source/manifest files.
    - PlanPin currently stores POINT positions, so rectangle centers are used.
    - To preserve issue identity if list ordering changes, supply RemarkIds.
    - Script intentionally does not automatically upload to a website.
"""

import datetime
import json
import math
import mimetypes
import os
import re
import tempfile
import uuid

import Rhino
import Rhino.Geometry as rg
import System.Drawing as drawing
import Grasshopper as gh
from Grasshopper.Kernel.Data import GH_Path
import scriptcontext as sc

# PyMuPDF installed by Rhino's Python 3 package requirements above.
import fitz

VALID_CATEGORY = {'design', 'technical', 'site', 'coordination', 'safety', 'other'}
VALID_STATUS = {'open', 'in progress', 'resolved'}
VALID_PRIORITY = {'low', 'medium', 'high'}
CATEGORY_MAP = {
    'ontwerp': 'design', 'design': 'design',
    'technisch': 'technical', 'technical': 'technical',
    'werf': 'site', 'site': 'site',
    'coordinatie': 'coordination', 'coördinatie': 'coordination',
    'coordination': 'coordination',
    'veiligheid': 'safety', 'safety': 'safety',
    'overig': 'other', 'overige': 'other', 'other': 'other',
}
STATUS_MAP = {
    'open': 'open',
    'in behandeling': 'in progress', 'in progress': 'in progress',
    'opgelost': 'resolved', 'resolved': 'resolved',
}
PRIORITY_MAP = {
    'laag': 'low', 'low': 'low',
    'middel': 'medium', 'medium': 'medium',
    'hoog': 'high', 'high': 'high',
}


def _as_list(items):
    if items is None:
        return []
    if isinstance(items, (str, bytes)):
        return [items]
    try:
        return list(items)
    except TypeError:
        return [items]


def _value(values, index, default, field, n):
    """Optional list: either empty or exactly one item per rectangle."""
    items = _as_list(values)
    if not items:
        return default
    if len(items) != n:
        raise ValueError('{} has {} items; expected {} (or leave unconnected)'.format(
            field, len(items), n))
    raw = items[index]
    return default if raw is None else str(raw).strip()


def _choice(values, index, default, field, n, allowed, aliases):
    raw = _value(values, index, default, field, n).strip().lower()
    normalized = aliases.get(raw, raw)
    if normalized not in allowed:
        raise ValueError('{}[{}] = {!r} is not a supported PlanPin value'.format(field, index, raw))
    return normalized


def _get_box(curve, label, tolerance):
    if curve is None or not hasattr(curve, 'GetBoundingBox'):
        raise ValueError('{} must be a closed rectangular Curve'.format(label))
    if not curve.IsClosed:
        raise ValueError('{} is not a closed curve'.format(label))
    bb = curve.GetBoundingBox(True)
    dx, dy = bb.Max.X - bb.Min.X, bb.Max.Y - bb.Min.Y
    if dx <= tolerance or dy <= tolerance:
        raise ValueError('{} has zero width or height'.format(label))
    if bb.Max.Z - bb.Min.Z > tolerance:
        raise ValueError('{} must lie on the XY plane'.format(label))
    # Rectangles rotated in XY cannot be accurately exported as axis-aligned windows.
    perimeter = float(curve.GetLength())
    expected = 2.0 * (dx + dy)
    if abs(perimeter - expected) > max(tolerance * 10.0, expected * 0.002):
        raise ValueError('{} must be an axis-aligned rectangle'.format(label))
    return (float(bb.Min.X), float(bb.Min.Y), float(bb.Max.X), float(bb.Max.Y))


def _contains(outer, inner, tol):
    return (inner[0] >= outer[0] - tol and inner[1] >= outer[1] - tol
            and inner[2] <= outer[2] + tol and inner[3] <= outer[3] + tol)


def _normalize_point(page_box, issue_box):
    cx = (issue_box[0] + issue_box[2]) * 0.5
    cy = (issue_box[1] + issue_box[3]) * 0.5
    # PlanPin origin is page TOP LEFT (x,y in range 0..1).
    return ((cx - page_box[0]) / (page_box[2] - page_box[0]),
            (page_box[3] - cy) / (page_box[3] - page_box[1]))


def _image_paths(images_tree, index):
    if images_tree is None:
        return []
    try:
        p = GH_Path(index)
        if not images_tree.PathExists(p):
            return []
        return [str(x).strip() for x in images_tree.Branch(p) if str(x).strip()]
    except (AttributeError, TypeError):
        raise ValueError('Images must use Tree Access with branches {0}, {1}, ...')


def _safe_image_name(text):
    name = re.sub(r'[^a-z0-9._-]+', '-', text.lower()).strip('-')[:64]
    return name or 'image'


def _collect_image_info(tree, i, marker_id):
    images = []
    contents = []
    for path in _image_paths(tree, i):
        if not os.path.isfile(path):
            raise ValueError('Image not found for remark {}: {}'.format(i, path))
        name = os.path.basename(path)
        image_id = str(uuid.uuid5(uuid.NAMESPACE_URL, marker_id + ':' + os.path.normcase(os.path.abspath(path))))
        attachment = 'planpin-images/{}-{}'.format(image_id, _safe_image_name(name))
        mimetype = mimetypes.guess_type(name)[0] or 'application/octet-stream'
        with open(path, 'rb') as f:
            data = f.read()
        images.append(dict(id=image_id, name=name, type=mimetype,
                           size=len(data), attachmentName=attachment))
        contents.append((attachment, name, data))
    return images, contents


def _get_top_view(doc):
    view = doc.Views.Find('Top', False)
    if view is None:
        view = doc.Views.ActiveView
    if view is None or not view.ActiveViewport.IsParallelProjection:
        raise ValueError('Open a parallel Top viewport in Rhino before exporting')
    direction = view.ActiveViewport.CameraDirection
    up = view.ActiveViewport.CameraUp
    direction.Unitize()
    up.Unitize()
    if (rg.Vector3d.Multiply(direction, rg.Vector3d(0, 0, -1)) < 0.999
            or rg.Vector3d.Multiply(up, rg.Vector3d(0, 1, 0)) < 0.999):
        raise ValueError('A top-down XY viewport, with +Y pointing up, is required')
    return view


def _capture_source_pdf(doc, boundaries, file_path, scale, dpi):
    view = _get_top_view(doc)
    mm_per_unit = Rhino.RhinoMath.UnitScale(doc.ModelUnitSystem, Rhino.UnitSystem.Millimeters)
    if not math.isfinite(mm_per_unit) or mm_per_unit <= 0:
        raise ValueError('Model units are not compatible with PDF print scale')

    pdf = Rhino.FileIO.FilePdf.Create()
    for j, box in enumerate(boundaries):
        # Exact model size -> physical page size. Scale 100 means 1:100.
        w_mm = (box[2] - box[0]) * mm_per_unit / scale
        h_mm = (box[3] - box[1]) * mm_per_unit / scale
        w_px = max(1, int(round(w_mm / 25.4 * dpi)))
        h_px = max(1, int(round(h_mm / 25.4 * dpi)))
        # Do not silently distort impossible paper sizes.
        if w_mm < 1 or h_mm < 1 or w_mm > 5080 or h_mm > 5080:
            raise ValueError('Page {} has unsupported paper size {:.1f} x {:.1f} mm at 1:{}'.format(
                j + 1, w_mm, h_mm, scale))
        if max(w_px, h_px) > 30000:
            raise ValueError('Page {} is too large at {} DPI; lower Dpi'.format(j + 1, dpi))

        settings = Rhino.Display.ViewCaptureSettings(view, drawing.Size(w_px, h_px), float(dpi))
        try:
            settings.ViewArea = Rhino.Display.ViewCaptureSettings.ViewAreaMapping.Window
            settings.SetWindowRect(rg.Point3d(box[0], box[3], 0),
                                   rg.Point3d(box[2], box[1], 0))
            settings.RasterMode = False
            settings.DrawGrid = False
            settings.DrawAxis = False
            settings.DrawBackground = False
            settings.UsePrintWidths = True
            result = pdf.AddPage(settings)
            if result < 0:
                raise RuntimeError('Rhino PDF AddPage failed for boundary {}'.format(j))
        finally:
            settings.Dispose()
    pdf.Write(file_path)
    if not os.path.isfile(file_path) or os.path.getsize(file_path) == 0:
        raise RuntimeError('Rhino did not write the source PDF')


def _append_text(page, y, text, size=11, color=(0.15, 0.16, 0.18)):
    # PDF's standard fonts are not guaranteed to support all Unicode. Most
    # commonly used Dutch labels are ASCII-safe here; user prose may vary.
    page.insert_textbox(fitz.Rect(48, y, 564, y + 60), str(text),
                        fontsize=size, fontname='helv', color=color)


def _render_final_pdf(source_file, output_file, manifest, image_contents, messages):
    with open(source_file, 'rb') as f:
        source_bytes = f.read()
    pdf = fitz.open(stream=source_bytes, filetype='pdf')
    n = len(manifest['issues'])
    plan_pages = len(pdf)
    if plan_pages != manifest['totalPlanPages']:
        raise RuntimeError('Rhino exported {} pages but {} were expected'.format(
            plan_pages, manifest['totalPlanPages']))

    # Same high-level structure as PlanPin's own exported PDFs:
    # plan pages, one summary page, then one detail page per issue.
    # Allocate all pages before creating links; PDF link targets must exist.
    pdf.new_page(width=612, height=792)
    for _ in manifest['issues']:
        pdf.new_page(width=612, height=792)
    overview = pdf[plan_pages]
    overview.insert_text((48, 55), 'PlanPin - opmerkingenoverzicht', fontsize=19, fontname='hebo')
    _append_text(overview, 78, '{} planpagina(s) | {} opmerkingen'.format(plan_pages, n), 11)
    for i, issue in enumerate(manifest['issues'][:27]):
        row_y = 120 + i * 23
        overview.insert_text((48, row_y), '{}.  P{} - {}'.format(
            i + 1, issue['pageNumber'], issue['title'][:60]), fontsize=10)
        overview.insert_link({'kind': fitz.LINK_GOTO,
                              'from': fitz.Rect(45, row_y - 11, 565, row_y + 5),
                              'page': plan_pages + 1 + i,
                              'to': fitz.Point(0, 0)})
    if n > 27:
        _append_text(overview, 760, 'Overige {} opmerkingen: zie de volgende detailpagina\'s'.format(n - 27), 9)

    for i, issue in enumerate(manifest['issues']):
        page = pdf[plan_pages + 1 + i]
        page.insert_text((48, 52), 'Opmerking {}'.format(i + 1), fontsize=20, fontname='hebo')
        _append_text(page, 76, issue['title'], 14)
        _append_text(page, 122, 'Planpagina {}  |  {}'.format(issue['pageNumber'], issue['reference']), 11)
        _append_text(page, 150, 'Categorie: {}   Status: {}   Prioriteit: {}'.format(
            issue['category'], issue['status'], issue['priority']), 10)
        page.insert_text((48, 198), 'Commentaar', fontsize=12, fontname='hebo')
        # Fit long comments in a bounded field; source text is always preserved
        # in the embedded manifest even when it cannot all fit on the detail page.
        page.insert_textbox(fitz.Rect(48, 214, 564, 475), issue['comment'],
                            fontsize=10, fontname='helv', lineheight=1.3)
        page.insert_text((48, 500), 'Terug naar planpagina {}'.format(issue['pageNumber']), fontsize=11)
        page.insert_link({'kind': fitz.LINK_GOTO,
                          'from': fitz.Rect(48, 486, 390, 512),
                          'page': issue['pageNumber'] - 1,
                          'to': fitz.Point(0, 0)})
        for image_index, image in enumerate(issue['images'][:3]):
            key = image['attachmentName']
            found = next((v for v in image_contents if v[0] == key), None)
            if found is not None and image['type'].startswith('image/'):
                try:
                    img_w = 150
                    pos_x = 48 + 171 * image_index
                    page.insert_image(fitz.Rect(pos_x, 530, pos_x + img_w, 710),
                                      stream=found[2], keep_proportion=True)
                except Exception as exc:
                    messages.append('Image preview not added (but attachment retained): {}'.format(exc))

    # Draw numbered markers on plan pages, linking to corresponding issue page.
    # The embedded original source remains unmarked so PlanPin can redraw its own markers.
    for i, issue in enumerate(manifest['issues']):
        page = pdf[issue['pageNumber'] - 1]
        x, y = issue['x'] * page.rect.width, issue['y'] * page.rect.height
        radius = 10
        page.draw_circle(fitz.Point(x, y), radius, color=(0.35, 0.15, 0.08),
                         fill=(0.89, 0.39, 0.23), width=1.4)
        num = str(i + 1)
        page.insert_text((x - 3.1 * len(num), y + 3.4), num,
                         fontsize=9, color=(1, 1, 1))
        page.insert_link({'kind': fitz.LINK_GOTO,
                          'from': fitz.Rect(x - radius - 4, y - radius - 4,
                                            x + radius + 4, y + radius + 4),
                          'page': plan_pages + 1 + i,
                          'to': fitz.Point(0, 0)})

    # Critical: PlanPin's pdfjs.ts loads original source and restores the markers
    # from exactly these embedded attachment names.
    pdf.embfile_add('planpin-source.pdf', source_bytes,
                    filename='planpin-source.pdf',
                    desc='PlanPin original unmarked source PDF')
    manifest_bytes = json.dumps(manifest, ensure_ascii=False, indent=2).encode('utf-8')
    pdf.embfile_add('planpin-manifest.json', manifest_bytes,
                    filename='planpin-manifest.json',
                    desc='PlanPin marker manifest v1')
    for name, original_name, data in image_contents:
        pdf.embfile_add(name, data, filename=original_name, desc='PlanPin issue image')
    metadata = pdf.metadata or {}
    metadata.update({'creator': 'Grasshopper / grondlaag',
                     'producer': 'PlanPin GH exporter',
                     'subject': 'PlanPin export with embedded issue manifest',
                     'keywords': 'planpin-manifest-v1, planpin, issues'})
    pdf.set_metadata(metadata)
    pdf.save(output_file, garbage=4, deflate=True)
    pdf.close()
    return manifest_bytes.decode('utf-8')


def build_manifest_and_assignments(page_boxes, remark_boxes, params):
    """Logic independent of Rhino PDF creation. Returns manifest, page->indices, images."""
    n = len(remark_boxes)
    assignments = [[] for _ in page_boxes]
    output_folder = os.path.abspath(str(params['OutputFolder']))
    filename = params['FileName']
    filename = str(filename or 'planpin-grasshopper.pdf').strip()
    if not filename.lower().endswith('.pdf'):
        filename += '.pdf'
    if os.path.basename(filename) != filename:
        raise ValueError('FileName must be a file name, not a path')

    now = datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00', 'Z')
    issues, all_image_contents = [], []
    for i, rect in enumerate(remark_boxes):
        matches = [j for j, boundary in enumerate(page_boxes) if _contains(boundary, rect, params['tolerance'])]
        if len(matches) != 1:
            raise ValueError('Remark {} must be inside exactly one PDF boundary; found {}'.format(i, len(matches)))
        page_index = matches[0]
        assignments[page_index].append(i)
        x, y = _normalize_point(page_boxes[page_index], rect)
        supplied_id = _value(params['RemarkIds'], i, '', 'RemarkIds', n)
        if supplied_id:
            try:
                issue_id = str(uuid.UUID(supplied_id))
            except ValueError:
                raise ValueError('RemarkIds[{}] must be a valid UUID'.format(i))
        else:
            # Stable while file path and remark indices stay stable.
            issue_id = str(uuid.uuid5(uuid.NAMESPACE_URL,
                                      'grondlaag:planpin:{}:{}'.format(
                                          os.path.join(output_folder, filename), i)))
        title = _value(params['Title'], i, 'opmerking {}'.format(i + 1), 'Title', n)
        comment = _value(params['Comment'], i, '', 'Comment', n)
        reference = _value(params['Reference'], i, '', 'Reference', n)
        category = _choice(params['Category'], i, 'other', 'Category', n, VALID_CATEGORY, CATEGORY_MAP)
        status = _choice(params['Status'], i, 'open', 'Status', n, VALID_STATUS, STATUS_MAP)
        priority = _choice(params['Priority'], i, 'medium', 'Priority', n, VALID_PRIORITY, PRIORITY_MAP)
        images, contents = _collect_image_info(params['Images'], i, issue_id)
        all_image_contents.extend(contents)
        issues.append(dict(
            id=issue_id, pageNumber=page_index + 1, x=round(x, 9), y=round(y, 9),
            title=title or 'opmerking zonder titel', comment=comment,
            category=category, status=status, priority=priority,
            reference=reference, createdAt=now,
            issueNumber=i + 1, issuePageNumber=len(page_boxes) + i + 2,
            images=images))
    if len({i['id'] for i in issues}) != len(issues):
        raise ValueError('Duplicate RemarkIds detected')
    manifest = dict(kind='planpin-manifest', version=1, sourceFileName=filename,
                    exportedAt=now, totalPlanPages=len(page_boxes),
                    issues=issues, sessions=[])
    return manifest, assignments, all_image_contents


def make_remark_tree(assignments):
    tree = gh.DataTree[int]()
    for page_index, remark_indices in enumerate(assignments):
        path = GH_Path(page_index)
        tree.EnsurePath(path)
        for remark_index in remark_indices:
            tree.Add(remark_index, path)
    return tree


def main(inputs):
    doc = Rhino.RhinoDoc.ActiveDoc
    if doc is None:
        raise ValueError('No active Rhino document')
    page_curves = _as_list(inputs['PdfBoundaries'])
    remark_curves = _as_list(inputs['RemarkRectangles'])
    if not page_curves:
        raise ValueError('Connect at least one PdfBoundaries curve')
    if not inputs['OutputFolder'] or not str(inputs['OutputFolder']).strip():
        raise ValueError('OutputFolder is required')
    folder = os.path.abspath(os.path.expanduser(str(inputs['OutputFolder'])))
    if not os.path.isdir(folder):
        raise ValueError('OutputFolder does not exist: {}'.format(folder))
    scale = float(inputs['Scale']) if inputs['Scale'] is not None else 100.0
    dpi = int(inputs['Dpi']) if inputs['Dpi'] is not None else 150
    if not math.isfinite(scale) or scale <= 0 or dpi < 72 or dpi > 600:
        raise ValueError('Scale must be > 0 and Dpi must be 72..600')
    tolerance = max(float(doc.ModelAbsoluteTolerance), 1.0e-7)
    pages = [_get_box(c, 'PdfBoundaries[{}]'.format(j), tolerance)
             for j, c in enumerate(page_curves)]
    remarks = [_get_box(c, 'RemarkRectangles[{}]'.format(i), tolerance)
               for i, c in enumerate(remark_curves)]
    inputs['tolerance'] = tolerance
    inputs['FileName'] = inputs['FileName'] or 'planpin-grasshopper.pdf'
    manifest, assignments, contents = build_manifest_and_assignments(pages, remarks, inputs)
    target_path = os.path.join(folder, manifest['sourceFileName'])

    messages = []
    with tempfile.TemporaryDirectory(prefix='planpin-gh-') as temp_dir:
        source = os.path.join(temp_dir, 'source.pdf')
        result = os.path.join(temp_dir, 'final.pdf')
        _capture_source_pdf(doc, pages, source, scale, dpi)
        manifest_str = _render_final_pdf(source, result, manifest, contents, messages)
        # Validate the embedded manifest before touching any existing output file.
        check = fitz.open(result)
        try:
            expected = {'planpin-manifest.json', 'planpin-source.pdf'}
            available = set(check.embfile_names())
            if not expected.issubset(available):
                raise RuntimeError('PlanPin attachments were not embedded successfully')
            verified = json.loads(check.embfile_get('planpin-manifest.json').decode('utf-8'))
            if verified != manifest:
                raise RuntimeError('Embedded PlanPin manifest failed round-trip validation')
            if check.page_count != len(pages) + 1 + len(remarks):
                raise RuntimeError('Final PDF page count is inconsistent')
        finally:
            check.close()
        # Atomic replacement avoids leaving a partial PDF at OutputFolder.
        staged = os.path.join(folder, '.{}.partial'.format(manifest['sourceFileName']))
        try:
            import shutil
            shutil.copyfile(result, staged)
            os.replace(staged, target_path)
        finally:
            if os.path.isfile(staged):
                os.remove(staged)

    messages.insert(0, 'Export OK: {} plan pages, {} issues, {} attached images -> {}'.format(
        len(pages), len(remarks), len(contents), target_path))
    return target_path, make_remark_tree(assignments), manifest_str, '\n'.join(messages)


# Grasshopper component's global input/output bindings.
# Store the last successful result; only the first True after False triggers export.
_key = 'grondlaag-planpin-gh-export:' + str(ghenv.Component.InstanceGuid)
_pressed = bool(Export)
_previous = bool(sc.sticky.get(_key + ':pressed', False))
sc.sticky[_key + ':pressed'] = _pressed

PdfPath, RemarkMap, Manifest, Log = sc.sticky.get(
    _key + ':last', ('', gh.DataTree[int](), '', 'Connect inputs and press Export.'))

if _pressed and not _previous:
    try:
        _inputs = {name: globals().get(name) for name in (
            'PdfBoundaries', 'RemarkRectangles', 'Title', 'Comment',
            'Category', 'Status', 'Priority', 'Reference', 'Images',
            'RemarkIds', 'OutputFolder', 'FileName', 'Scale', 'Dpi')}
        PdfPath, RemarkMap, Manifest, Log = main(_inputs)
        sc.sticky[_key + ':last'] = (PdfPath, RemarkMap, Manifest, Log)
    except Exception as exc:
        Log = 'EXPORT FAILED: {}'.format(exc)
        ghenv.Component.AddRuntimeMessage(gh.Kernel.GH_RuntimeMessageLevel.Error, Log)
elif _pressed:
    Log = 'Export input is still True. Release and press again.\n' + Log