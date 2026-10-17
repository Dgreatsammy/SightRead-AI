import sys
import numpy as np
from PIL import Image, ImageFilter, ImageOps
variant, src, out = sys.argv[1], sys.argv[2], sys.argv[3]
im = Image.open(src).convert("L"); w,h = im.size
def otsu(arr):
    hist,_ = np.histogram(arr, bins=256, range=(0,256)); total=arr.size
    sum_all = np.dot(np.arange(256), hist); w0=0; sum0=0; best=0; thr=127
    for t in range(256):
        w0 += hist[t]
        if w0==0: continue
        w1 = total-w0
        if w1==0: break
        sum0 += t*hist[t]; m0=sum0/w0; m1=(sum_all-sum0)/w1
        v = w0*w1*(m0-m1)**2
        if v>best: best=v; thr=t
    return thr
def adaptive(gray_img, window, bias):
    a = np.array(gray_img, dtype=np.float64); H,W = a.shape
    ii = np.pad(a.cumsum(0).cumsum(1), ((1,0),(1,0)))
    r = window//2
    y0 = np.clip(np.arange(H)-r,0,H); y1 = np.clip(np.arange(H)+r+1,0,H)
    x0 = np.clip(np.arange(W)-r,0,W); x1 = np.clip(np.arange(W)+r+1,0,W)
    s = ii[np.ix_(y1,x1)] - ii[np.ix_(y0,x1)] - ii[np.ix_(y1,x0)] + ii[np.ix_(y0,x0)]
    n = (y1-y0)[:,None]*(x1-x0)[None,:]
    mean = s/n
    return Image.fromarray(((a > mean*(1-bias))*255).astype("uint8"))
if variant=="base":          # what the server does today: contrast, light sharpening, enlarge to ~2200
    s_ = 2200/max(w,h); g = ImageOps.autocontrast(im).filter(ImageFilter.UnsharpMask(radius=1, percent=100, threshold=0))
    g = g.resize((round(w*s_),round(h*s_)), Image.LANCZOS)
elif variant in ("aglobal","aadapt"):    # input already shaded: enlarge then binarise globally / locally
    s_ = 2200/max(w,h); g = ImageOps.autocontrast(im).resize((round(w*s_),round(h*s_)), Image.LANCZOS)
    if variant=="aglobal":
        a = np.array(g); g = Image.fromarray(((a>otsu(a))*255).astype("uint8"))
    else:
        g = adaptive(g, window=max(31, round(g.size[0]/20)|1), bias=0.12)
elif variant=="x3":            # bigger enlargement, no sharpening
    g = ImageOps.autocontrast(im).resize((w*3,h*3), Image.LANCZOS)
elif variant=="bin":         # enlarge to ~2200, then pure black and white
    s = 2200/max(w,h); g = ImageOps.autocontrast(im).resize((round(w*s),round(h*s)), Image.LANCZOS)
    a = np.array(g); g = Image.fromarray(((a>otsu(a))*255).astype("uint8"))
elif variant=="denbin":      # remove speckle first, then enlarge, then black and white
    s = 2200/max(w,h); g = ImageOps.autocontrast(im.filter(ImageFilter.MedianFilter(3))).resize((round(w*s),round(h*s)), Image.LANCZOS)
    a = np.array(g); g = Image.fromarray(((a>otsu(a))*255).astype("uint8"))
g.save(out, dpi=(300,300)); print(variant, (w,h), "->", g.size)
