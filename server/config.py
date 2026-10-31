# サーバー設定ファイル（リポジトリ直下の config.json）。
# テキストエディタで書き換えてサーバーを再起動すると反映される（GUI なし）。
# 読み込み失敗時（ファイル無し / JSON 不正 / port が範囲外）は既定値へフォールバックして警告を出す。
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG_PATH = os.path.join(ROOT, "config.json")
DEFAULT_PORT = 8443
DEFAULT_PHOTOS_ROOT = "Photos"
DEFAULT_ALBUM_MODE = 1  # 1=全ディレクトリ/サブディレクトリを別アルバム、2=第一階層ディレクトリのみアルバム
DEFAULT_DOWNSCALE_CACHE_DIR = "data/downscale"  # 配信時ダウンスケールのキャッシュ格納先（2026-10-31）
DEFAULT_DOWNSCALE_ENABLED = True  # 配信時ダウンスケールの ON/OFF（false で原画そのまま配信）
DOWNSCALE_MAX_PX = 2560  # 原画の長辺上限(px)。超過写真は配信時にこの長辺へ縮小して JPEG 化（Quest 3 実測検討より）
DOWNSCALE_JPEG_QUALITY = 85  # 配信時ダウンスケールの JPEG 品質


def album_for_rel(rel: str, mode: int = DEFAULT_ALBUM_MODE) -> str:
    """relpath（photos_root からの相対・スラ区切り）からアルバムキーを導出。
    '' は photos_root 直下。mode=1: 直属の親ディレクトリパス（全階層が別アルバム）。
    mode=2: 第一階層ディレクトリ（第二階層以下の写真もそのアルバムに含む）。"""
    if "/" not in rel:
        return ""
    if mode == 2:
        return rel.split("/", 1)[0]
    return rel.rsplit("/", 1)[0]


def load_config(path: str = CONFIG_PATH) -> dict:
    """config.json を読んで設定辞書を返す。不正値は既定値にフォールバック。

    photos_root: 写真データディレクトリ。相対パスはリポジトリ直下からの相対。
    絶対パスも可。ディレクトリが存在しない場合は警告して作成する（空ギャラリー）。

    album_mode: アルバム定義。1=photos_root 配下の全ディレクトリ/サブディレクトリを
    別アルバム（既定・従来動作）、2=第一階層ディレクトリのみアルバム（第二階層
    以下の写真もそのアルバムに含む）。

    downscale_cache_dir: 配信時ダウンスケール（長辺 DOWNSCALE_MAX_PX 超過の原画を
    JPEG 化して配信）のキャッシュ格納先。相対パスはリポジトリ直下からの相対、
    絶対パスも可。photos_root 配下を指定した場合は索引に混入するため既定値へ
    フォールバック。ディレクトリ自体は必要時に遅延作成される。

    downscale_enabled: 配信時ダウンスケールの ON/OFF（真偽値、既定 true）。
    false にすると長辺上限超過の原画もそのまま配信する（従来動作）。
    """
    cfg: dict = {}
    try:
        # utf-8-sig: BOM 付き UTF-8（PowerShell の Set-Content -Encoding UTF8 や一部エディタで
        # 保存されることがある）でも読めるようにする。BOM なし UTF-8 もそのまま読める。
        with open(path, encoding="utf-8-sig") as f:
            loaded = json.load(f)
        if isinstance(loaded, dict):
            cfg = loaded
        else:
            print(f"config.json がオブジェクトではないため既定値を使用（port {DEFAULT_PORT} / photos_root {DEFAULT_PHOTOS_ROOT}）")
    except FileNotFoundError:
        pass  # 設定ファイルが無いのはエラーではない（既定値で作動）
    except (json.JSONDecodeError, OSError) as e:
        print(f"config.json が読み込めないため既定値を使用（port {DEFAULT_PORT}）: {e}")
    port = cfg.get("port", DEFAULT_PORT)
    # bool は int のサブクラスだがポートとして不正。文字列も拒否。
    if not isinstance(port, int) or isinstance(port, bool) or not (1 <= port <= 65535):
        print(f"config.json の port が不正なため既定ポート {DEFAULT_PORT} を使用: {port!r}")
        port = DEFAULT_PORT
    photos_root = cfg.get("photos_root", DEFAULT_PHOTOS_ROOT)
    if not isinstance(photos_root, str) or not photos_root.strip():
        print(f"config.json の photos_root が不正なため既定値 {DEFAULT_PHOTOS_ROOT!r} を使用: {photos_root!r}")
        photos_root = DEFAULT_PHOTOS_ROOT
    if not os.path.isabs(photos_root):
        photos_root = os.path.join(ROOT, photos_root)
    photos_root = os.path.normpath(photos_root)
    if not os.path.isdir(photos_root):
        print(f"photos_root が存在しないため作成します: {photos_root}")
        try:
            os.makedirs(photos_root)
        except OSError as e:
            print(f"photos_root を作成できないため既定値 {DEFAULT_PHOTOS_ROOT!r} を使用: {e}")
            photos_root = os.path.join(ROOT, DEFAULT_PHOTOS_ROOT)
    album_mode = cfg.get("album_mode", DEFAULT_ALBUM_MODE)
    # bool は int のサブクラスだがアルバムモードとして不正
    if not isinstance(album_mode, int) or isinstance(album_mode, bool) or album_mode not in (1, 2):
        print(f"config.json の album_mode が不正なため既定値 {DEFAULT_ALBUM_MODE} を使用: {album_mode!r}")
        album_mode = DEFAULT_ALBUM_MODE
    downscale_cache_dir = cfg.get("downscale_cache_dir", DEFAULT_DOWNSCALE_CACHE_DIR)
    if not isinstance(downscale_cache_dir, str) or not downscale_cache_dir.strip():
        print(f"config.json の downscale_cache_dir が不正なため既定値 {DEFAULT_DOWNSCALE_CACHE_DIR!r} を使用: {downscale_cache_dir!r}")
        downscale_cache_dir = DEFAULT_DOWNSCALE_CACHE_DIR
    if not os.path.isabs(downscale_cache_dir):
        downscale_cache_dir = os.path.join(ROOT, downscale_cache_dir)
    downscale_cache_dir = os.path.normpath(downscale_cache_dir)
    # キャッシュが photos_root 配下だとインデックスがキャッシュ JPEG を写真として拾ってしまう
    if downscale_cache_dir == photos_root or downscale_cache_dir.startswith(photos_root + os.sep):
        print(f"config.json の downscale_cache_dir が photos_root 配下のため既定値 {DEFAULT_DOWNSCALE_CACHE_DIR!r} を使用: {downscale_cache_dir}")
        downscale_cache_dir = os.path.normpath(os.path.join(ROOT, DEFAULT_DOWNSCALE_CACHE_DIR))
    downscale_enabled = cfg.get("downscale_enabled", DEFAULT_DOWNSCALE_ENABLED)
    if not isinstance(downscale_enabled, bool):
        print(f"config.json の downscale_enabled が真偽値でないため既定値 {DEFAULT_DOWNSCALE_ENABLED} を使用: {downscale_enabled!r}")
        downscale_enabled = DEFAULT_DOWNSCALE_ENABLED
    return {
        "port": port,
        "photos_root": photos_root,
        "album_mode": album_mode,
        "downscale_cache_dir": downscale_cache_dir,
        "downscale_enabled": downscale_enabled,
    }
