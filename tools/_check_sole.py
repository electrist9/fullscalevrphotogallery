import sys, os, math
ROOT = r"F:\fullscalevrphotogallery"
sys.path.insert(0, os.path.join(ROOT, "server"))
from PIL import Image
import facedetect, scale

for fn in ["usersample1.png", "usersample2.png", "usersample3.png", "usersample4.png"]:
    p = os.path.join(ROOT, "Photos", fn)
    with Image.open(p) as im:
        W, H = im.size
        faces = facedetect.detect_faces(im)
        pose = facedetect.detect_pose(im) if faces else None
    f = max(faces, key=lambda f: (f["bbox"][2] - f["bbox"][0]) * (f["bbox"][3] - f["bbox"][1]))
    sole = pose["sole_y"] if pose else None
    reason = "ok"
    if sole is not None:
        face_h = f["bbox"][3] - f["bbox"][1]
        if sole <= f["eye_cy"] + 0.5 * face_h:
            sole, reason = None, "below-eye"
        elif pose["nose_x"] is not None and math.hypot(pose["nose_x"] - f["eye_cx"], pose["nose_y"] - f["eye_cy"]) > 2.0 * face_h:
            sole, reason = None, "nose-mismatch"
        elif not 0.35 <= (sole - pose["hip_cy"]) / (sole - f["crown_y"]) <= 0.65:
            sole, reason = None, f"ratio={(sole - pose['hip_cy']) / (sole - f['crown_y']):.2f}"
    mmpp = scale.mm_per_px(f["pupil_px"], f["yaw_deg"])
    h = scale.height_mm(f["crown_y"], sole, mmpp)
    print(
        fn,
        f"WxH={W}x{H}",
        f"crown_y={f['crown_y']:.0f}",
        f"sole_raw={pose['sole_y'] if pose and pose['sole_y'] is not None else 'None'}",
        f"sole={sole if sole is not None else 'None'}({reason})",
        f"height_mm={h if h is None else round(h)}",
    )
