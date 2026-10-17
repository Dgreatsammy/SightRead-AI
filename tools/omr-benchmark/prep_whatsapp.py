import sys, subprocess
from PIL import Image, ImageFilter, ImageOps
pdf, out_png = sys.argv[1], sys.argv[2]
subprocess.run(["pdftoppm","-r","150","-f","1","-l","1","-png","-singlefile",pdf,out_png[:-4]+"_page"],check=True)
im = Image.open(out_png[:-4]+"_page.png").convert("RGB")
long_side = max(im.size); s = 1600/long_side
im = im.resize((round(im.width*s), round(im.height*s)), Image.LANCZOS)          # WhatsApp-style shrink
tmp = out_png[:-4]+"_wa.jpg"; im.save(tmp, "JPEG", quality=65)                    # WhatsApp-style compression
im = Image.open(tmp)
w,h = im.size                                                                       # same preprocessing as the server
scale = min(3, 2200/max(w,h)) if max(w,h) < 2200 else 1
g = ImageOps.autocontrast(im.convert("L")).filter(ImageFilter.UnsharpMask(radius=1, percent=100, threshold=0))
if scale > 1.05: g = g.resize((round(w*scale), round(h*scale)), Image.LANCZOS)
g.save(out_png, dpi=(300,300)); print(im.size, "->", g.size)
