# Adds a fade transition to every slide (pptxgenjs cannot write transitions).
import re, shutil, sys, zipfile
src = sys.argv[1]; tmp = src + '.tmp'
with zipfile.ZipFile(src) as zin, zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as zout:
    for item in zin.infolist():
        data = zin.read(item.filename)
        if re.fullmatch(r'ppt/slides/slide\d+\.xml', item.filename):
            s = data.decode('utf8')
            if '<p:transition' not in s:
                tag = '<p:transition spd="med"><p:fade/></p:transition>'
                s = s.replace('</p:clrMapOvr>', '</p:clrMapOvr>' + tag, 1) if '</p:clrMapOvr>' in s else s.replace('</p:cSld>', '</p:cSld>' + tag, 1)
            data = s.encode('utf8')
        zout.writestr(item, data)
shutil.move(tmp, src)
print('transitions added')
