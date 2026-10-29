import json
import tempfile
import types
import sys
from pathlib import Path
import fitz

# Minimal Rhino/GH shims: exercise only pure geometry-data/PyMuPDF routines.
rhino = types.ModuleType('Rhino')
rhino.Geometry = types.ModuleType('Rhino.Geometry')
sys.modules['Rhino'] = rhino
sys.modules['Rhino.Geometry'] = rhino.Geometry
sys.modules['System'] = types.ModuleType('System')
sys.modules['System.Drawing'] = types.ModuleType('System.Drawing')
sys.modules['System'].Drawing = sys.modules['System.Drawing']
gh = types.ModuleType('Grasshopper')
gh.Kernel = types.ModuleType('Grasshopper.Kernel')
gh.Kernel.Data = types.ModuleType('Grasshopper.Kernel.Data')
class FakePath:
    def __init__(self,*args): self.Indices=list(args)
    def __str__(self): return '{'+';'.join(map(str,self.Indices))+'}'
gh.Kernel.Data.GH_Path = FakePath
sys.modules['Grasshopper']=gh
sys.modules['Grasshopper.Kernel']=gh.Kernel
sys.modules['Grasshopper.Kernel.Data']=gh.Kernel.Data
sc = types.ModuleType('scriptcontext')
sc.sticky={}
sys.modules['scriptcontext']=sc

script=Path(__file__).with_name('planpin_export_gh.py').read_text()
script=script.split('# Grasshopper component\'s global input/output bindings.')[0]
ns={}
exec(compile(script, 'planpin_export_gh.py', 'exec'),ns)
class Tree:
    def __init__(self,data):
        self.data=data
        self.Paths=[FakePath(*k) for k in data]
    def Branch(self,path):return self.data[tuple(path.Indices)]

tables=ns['_parse_table_data'](Tree({
    (0,0): ['51.11.20.ARCH. | scheidingswand','4,87','2,95','-1','-14,37','152,53','-2191,32'],
    (0,1): ['53.25.ARCH. | tapijttegels','0,15','4,87','1','0,73','45,49','33,23'],
    **{(1,i): ['heel lange artikelomschrijving voor controle of alles correct afgebroken wordt '+str(i), '1','2','3','4','5', '6'] for i in range(35)}
}), ['artikelwijziging','a','b','i','hv','eenheidsprijs','prijsimpact'],['prijsimpact','hv'],2)
assert len(tables)==2
assert tables[0]['totals']==['prijsimpact','hv']
assert ns['_table_total_values'](tables[0])['prijsimpact']=='-2.158,09'
assert ns['_table_total_values'](tables[0])['hv']=='-13,64'
assert ns['_parse_table_data'](None,['art'],[],2)=={}
assert ns['_parse_table_data'](Tree({(1,0): []}),['art'],[],2)=={}
try:ns['_parse_table_data'](Tree({(3,0):['x']}),['art'],[],2)
except ValueError:pass
else:raise AssertionError('out of bounds branch must error')

with tempfile.TemporaryDirectory() as d:
    source=Path(d)/'source.pdf'
    output=Path(d)/'output.pdf'
    src=fitz.open()
    for _ in range(2):src.new_page(width=600,height=800)
    src.save(source);src.close()
    manifest={'kind':'planpin-manifest','version':1,'sourceFileName':'test.pdf','exportedAt':'2026-10-29T00:00:00Z','totalPlanPages':2,'issues':[], 'sessions':[]}
    for i in range(2):
        manifest['issues'].append(dict(id=f'cafe{i}',pageNumber=i+1,x=.5,y=.5,
          title=f'test {i}',comment='test comment',category='other',status='open',priority='medium',reference='',
          createdAt='2026-10-29T00:00:00Z',issueNumber=i+1,issuePageNumber=4+i,images=[],table=tables[i]))
    log=[]
    ns['_render_final_pdf'](str(source),str(output),manifest,[],log,
      snapshot_regions=[(.1,.1,.3,.3),(.1,.1,.3,.3)],snapshot_margin=.3)
    doc=fitz.open(output)
    embedded=json.loads(doc.embfile_get('planpin-manifest.json'))
    assert embedded['issues'][0]['table']['columns']==tables[0]['columns']
    assert doc.page_count>5,doc.page_count
    for issue in embedded['issues']:
        p=doc[issue['issuePageNumber']-1]
        assert 'Opmerking' in p.get_text()
    all_text='\n'.join(p.get_text() for p in doc)
    assert '-2.158,09' in all_text, all_text[-3000:]
    assert 'heel lange artikelomschrijving' in all_text
    import shutil
    shutil.copy2(output, Path(__file__).with_name('example-table.pdf'))
    print('PASS — pages:',doc.page_count,'table continuation pages:',doc.page_count-5,'pdf size',output.stat().st_size,'bytes')
    doc.close()