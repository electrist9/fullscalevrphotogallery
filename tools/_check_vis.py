import sys, os
ROOT = r"F:\fullscalevrphotogallery"
sys.path.insert(0, os.path.join(ROOT, "server"))
from PIL import Image
import facedetect

for fn in ["usersample1.png", "usersample2.png", "usersample4.png"]:
    p = os.path.join(ROOT, "Photos", fn)
    with Image.open(p) as im:
        W, H = im.size
        rgb = facedetect._to_rgb(im)
        res = facedetect._pose_landmarker().detect(facedetect._mp_image(__import__("numpy").asarray(rgb)))
    print(fn, f"WxH={W}x{H}", "poses:", len(res.pose_landmarks))
    if res.pose_landmarks:
        lms = res.pose_landmarks[0]
        print("  lm fields:", [a for a in dir(lms[0]) if not a.startswith("_")])
        for i in (0, 11, 12, 23, 24, 27, 28, 29, 30, 31, 32):
            lm = lms[i]
            print(f"  lm{i}: x={lm.x*W:.0f} y={lm.y*H:.0f} vis={getattr(lm,'visibility',None)} pres={getattr(lm,'presence',None)}")
