
import sys, numpy as np
from PIL import Image
src,out=sys.argv[1],sys.argv[2]
im=np.array(Image.open(src).convert("L"),dtype=np.float64); h,w=im.shape
yy,xx=np.mgrid[0:h,0:w]
light=0.55+0.45*(0.6*xx/w+0.4*(1-yy/h))      # 55%..100% light across the page, like a shadow
rng=np.random.default_rng(1); noise=rng.normal(0,6,im.shape)
Image.fromarray(np.clip(im*light+noise,0,255).astype("uint8")).save(out,"JPEG",quality=60)
