# 原寸大の数学（PLAN.md §4.2）— 純粋関数。サーバ・テスト・フロント（TS移植）で同じ定数を使う。
import math

IPD_DEFAULT_MM = 63.0
MAX_YAW_DEG = 60.0     # |yaw|超は低信頼 → フォールバック（None）
MIN_PLANE_M = 0.3      # §4.2 安全クランプ（プレイン最大辺）
MAX_PLANE_M = 3.0


def corrected_pupil_px(pupil_px, yaw_deg=0.0):
    """姿勢補正 pupil_px / cos(yaw)（§4.2）。|yaw|>60° は None（低信頼）。"""
    if pupil_px is None or pupil_px <= 0:
        return None
    if yaw_deg is None:
        yaw_deg = 0.0
    if abs(yaw_deg) > MAX_YAW_DEG:
        return None
    return pupil_px / math.cos(math.radians(yaw_deg))


def mm_per_px(pupil_px, yaw_deg=0.0, ipd_mm=IPD_DEFAULT_MM):
    """① 被写体深度平面での1pxの実寸(mm)。補正不可なら None。"""
    c = corrected_pupil_px(pupil_px, yaw_deg)
    if c is None:
        return None
    return ipd_mm / c


def clamp_mm_per_px(w_px, h_px, mmpp):
    """§4.2 安全クランプ: プレイン最大辺を 0.3〜3.0m に収める。
    戻り値 (mmpp調整後, クランプしたか)。"""
    max_px = max(w_px, h_px)
    if max_px <= 0 or mmpp is None or mmpp <= 0:
        return mmpp, False
    plane_max_m = max_px * mmpp / 1000.0
    if plane_max_m > MAX_PLANE_M:
        return mmpp * MAX_PLANE_M / plane_max_m, True
    if plane_max_m < MIN_PLANE_M:
        return mmpp * MIN_PLANE_M / plane_max_m, True
    return mmpp, False


def plane_size_m(w_px, h_px, mmpp):
    """②③ プレインの物理サイズ(m)。"""
    return w_px * mmpp / 1000.0, h_px * mmpp / 1000.0


def height_mm(crown_y, sole_y, mmpp):
    """身長(mm) = 頭頂→足元。入力欠損・足元が頭頂より上（異常）は None。"""
    if crown_y is None or sole_y is None or mmpp is None or mmpp <= 0:
        return None
    h = (sole_y - crown_y) * mmpp
    return h if h > 0 else None
