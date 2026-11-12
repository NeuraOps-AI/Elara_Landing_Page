"""Reproducibly prepare the supplied ELARA media and an introductory brochure.

Run with a Python environment containing Pillow, reportlab and pypdf.
pdftoppm must be on PATH. Original supplied files are preserved.
"""
from pathlib import Path
import shutil
import subprocess
from PIL import Image, ImageChops
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor, Color, white
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph
from reportlab.lib.styles import ParagraphStyle
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'public' / 'assets'
PRIVATE = ROOT / 'private'
TMP = ROOT / 'tmp' / 'pdfs'
for folder in (ASSETS, PRIVATE, TMP):
    folder.mkdir(parents=True, exist_ok=True)

subprocess.run(['pdftoppm', '-scale-to', '3000', '-png', str(ROOT / 'Elara Price sheet.pdf'), str(TMP / 'price-hi')], check=True)
source = Image.open(TMP / 'price-hi-1.png').convert('RGB')

# Isolate the original white brand mark from its orange background.
elara = source.crop((190, 78, 520, 366))
alpha = elara.convert('L')
alpha.putdata([max(0, min(255, round((min(rgb)-160)*255/95))) for rgb in elara.get_flattened_data()])
logo = Image.new('RGBA', elara.size, (255,255,255,0))
logo.putalpha(alpha)
logo = logo.crop(logo.getbbox())
logo.save(ASSETS / 'elara-logo.png')
copper = Image.new('RGBA', logo.size, '#a86336')
copper.putalpha(logo.getchannel('A'))
copper.save(ASSETS / 'elara-logo-copper.png')

nayan = source.crop((1580, 28, 1950, 374)).convert('RGBA')
mask = Image.new('L', nayan.size)
mask.putdata([max(0, min(255, 255 - min(rgb[:3]))) for rgb in nayan.get_flattened_data()])
navy = Image.new('RGBA', nayan.size, '#172947')
navy.putalpha(mask)
navy = navy.crop(navy.getbbox())
navy.save(ASSETS / 'grupe-nayan-logo.png')

for source_name, dest in [
    ('WhatsApp Image 2026-10-23 at 2.42.45 PM (1).jpeg', 'villa-day.webp'),
    ('WhatsApp Image 2026-10-23 at 2.42.45 PM.jpeg', 'villa-dusk.webp'),
]:
    Image.open(ROOT / source_name).convert('RGB').save(ASSETS / dest, 'WEBP', quality=91, method=6)
location = Image.open(ROOT / 'WhatsApp Image 2026-10-23 at 2.42.46 PM.jpeg').convert('RGB')
location = location.crop((0,184,705,1444))
location.save(ASSETS / 'location-map.webp', 'WEBP', quality=93, method=6)
location.save(TMP / 'location-map.jpg', 'JPEG', quality=95)
shutil.copy2(ROOT / 'WhatsApp Video 2026-10-23 at 2.42.44 PM.mp4', ASSETS / 'project-film.mp4')
shutil.copy2(ROOT / 'Elara Price sheet.pdf', PRIVATE / 'ELARA-Price-Sheet.pdf')

font_dir = Path('C:/Windows/Fonts')
for name, filename in [('Georgia','georgia.ttf'),('GeorgiaBold','georgiab.ttf'),('Segoe','segoeui.ttf'),('SegoeBold','seguisb.ttf')]:
    pdfmetrics.registerFont(TTFont(name, str(font_dir / filename)))

W, H = 595.276, 841.89
CREAM = HexColor('#f4f0e8')
INK = HexColor('#26382e')
BRONZE = HexColor('#a86336')
MUTED = HexColor('#68736a')
RULE = HexColor('#d3d6cd')
out = PRIVATE / 'ELARA-Brochure.pdf'
c = canvas.Canvas(str(out), pagesize=(W,H))
c.setTitle('ELARA | Sculpted Sunlit Villas - Project Overview')
c.setAuthor('ELARA - Grupe Nayan')
c.setSubject('Project overview prepared from supplied ELARA materials')

def text(s,x,y,size=11,font='Segoe',color=INK):
    c.setFillColor(color)
    c.setFont(font,size)
    c.drawString(x,y,s)

def paragraph(s,x,top,width,size=11,leading=17,color=MUTED,font='Segoe'):
    p=Paragraph(s,ParagraphStyle('copy',fontName=font,fontSize=size,leading=leading,textColor=color))
    _,h=p.wrap(width,H)
    p.drawOn(c,x,top-h)
    return top-h

def image_cover(path,x,y,w,h,anchor='c'):
    im=Image.open(path)
    iw,ih=im.size
    scale=max(w/iw,h/ih)
    dw,dh=iw*scale,ih*scale
    dx=x+(w-dw)/2
    dy=y+(h-dh)/2
    c.saveState()
    clip=c.beginPath();clip.rect(x,y,w,h)
    c.clipPath(clip,stroke=0,fill=0)
    # Preserve original JPEG compression rather than embedding raw pixels.
    c.drawImage(str(path),dx,dy,dw,dh)
    c.restoreState()

def footer(num,label='PROJECT OVERVIEW'):
    c.setStrokeColor(RULE);c.setLineWidth(.6);c.line(40,45,W-40,45)
    text('ELARA / '+label,40,28,8,color=MUTED)
    text(f'{num:02d}',W-55,28,8,color=MUTED)

# Cover: restrained editorial typography, full-width architectural render.
c.setFillColor(CREAM);c.rect(0,0,W,H,stroke=0,fill=1)
c.setFillColor(BRONZE);c.roundRect(40,674,143,125,20,stroke=0,fill=1)
c.drawImage(str(ASSETS/'elara-logo.png'),58,688,width=106,height=93,mask='auto')
c.drawImage(str(ASSETS/'grupe-nayan-logo.png'),471,723,width=78,height=73,mask='auto')
text('SCULPTED SUNLIT VILLAS',40,640,9,'SegoeBold',BRONZE)
text('A life shaped',40,592,36,'Georgia',INK)
text('around the light.',40,547,36,'Georgia',INK)
paragraph('Discover ELARA by Grupe Nayan. A distinctive villa expression, defined by flowing curves, warm tones and an open-air outlook.',40,518,437,11,17)
image_cover(ROOT/'WhatsApp Image 2026-10-23 at 2.42.45 PM.jpeg',0,93,W,365)
text('ARCHITECTURAL VIEW / DUSK',40,72,8,color=MUTED)
footer(1)
c.showPage()

# Architecture page uses only features clearly visible in the supplied render.
c.setFillColor(CREAM);c.rect(0,0,W,H,stroke=0,fill=1)
text('01 / THE ARCHITECTURE',40,795,9,'SegoeBold',BRONZE)
text('Soft lines.',40,745,34,'Georgia')
text('A strong impression.',40,702,34,'Georgia')
image_cover(ROOT/'WhatsApp Image 2026-10-23 at 2.42.45 PM (1).jpeg',40,340,W-80,322)
text('ARCHITECTURAL VIEW / DAYLIGHT',40,322,8,color=MUTED)

cols=[(40,'Sculpted form','Curved edges and a sweeping facade give ELARA its distinctive visual identity.'),
      (222,'Warm expression','A palette of soft cream and warm accents comes together in the supplied architectural views.'),
      (404,'Open-air outlook','Terrace and balcony elements bring an outdoor dimension to the villa expression.')]
for x,title,body in cols:
    c.setStrokeColor(BRONZE);c.line(x,286,x+35,286)
    text(title,x,262,13,'Georgia')
    paragraph(body,x,245,151,10,15)
paragraph('See the project film and explore the full architectural views on the ELARA website. Contact the team to discuss current specifications and villa availability.',40,141,484,10,15)
footer(2)
c.showPage()

# Location and next steps. The supplied map is explicitly a reference.
c.setFillColor(CREAM);c.rect(0,0,W,H,stroke=0,fill=1)
text('02 / EXPLORE THE LOCATION',40,795,9,'SegoeBold',BRONZE)
text('Your next chapter',40,745,32,'Georgia')
text('starts with a visit.',40,704,32,'Georgia')
c.drawImage(str(TMP/'location-map.jpg'),40,248,width=235,height=420)
text('SUPPLIED LOCATION REFERENCE',40,231,7.5,color=MUTED)
paragraph('The supplied location reference marks the site near ORR Exit #13 and shows the Greenfield Highway alignment.',305,657,244,11,17,color=INK)
paragraph('Use the reference to begin your conversation with the ELARA team. Request the exact site directions and arrange a visit before planning your journey.',305,564,244,10,16)
c.setStrokeColor(RULE);c.line(305,479,549,479)
text('Take a closer look',305,450,18,'Georgia')
paragraph('Request the official price sheet for base pricing, applicable charges, payment milestones and terms.',305,430,244,10,16)
paragraph('Ask the team about current availability, plans and project specifications.',305,355,244,10,16)
c.setFillColor(white);c.roundRect(40,105,W-80,99,13,stroke=0,fill=1)
c.drawImage(str(ASSETS/'grupe-nayan-logo.png'),56,123,width=62,height=58,mask='auto')
text('CORPORATE OFFICE',140,180,8,'SegoeBold',BRONZE)
paragraph('4th Floor, Plot No. 232, Beside SBI Bank,<br/>Nagarjuna Sagar Road, Hastinapuram,<br/>Hyderabad 500070',140,167,356,9,13)
text('www.grupenayan.com',140,116,9,'SegoeBold')
paragraph('Project overview prepared from supplied materials. Architectural views are artist impressions. Confirm specifications, availability and current pricing with the sales team.',40,85,W-80,7.3,10)
footer(3)
c.save()
reader=PdfReader(out)
assert len(reader.pages)==3
assert all(p.extract_text().strip() for p in reader.pages)
print('Prepared assets:')
for item in sorted(ASSETS.iterdir()):
    if item.suffix in ('.png','.webp'):
        print(item.relative_to(ROOT),Image.open(item).size,item.stat().st_size)
    else:
        print(item.relative_to(ROOT),item.stat().st_size)
print('Brochure:',out,'pages:',len(reader.pages),'bytes:',out.stat().st_size)
