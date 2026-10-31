# config.json 読み込み（server/config.py）の検証
import json
import os
import shutil
import sys
import uuid

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "server"))

import config  # noqa: E402

# pytest の tmp_path はサンドボックス環境で書けないため、workspace 内 .tmp を使う
TMP = os.path.join(ROOT, ".tmp", "config_tests")


def _write(text):
    os.makedirs(TMP, exist_ok=True)
    p = os.path.join(TMP, f"config_{uuid.uuid4().hex}.json")
    with open(p, "w", encoding="utf-8") as f:
        f.write(text)
    return p


def test_real_config_file_has_port():
    # リポジトリ直下の config.json は port を持つ（既定 8443）
    assert config.load_config()["port"] == config.DEFAULT_PORT


def test_valid_port():
    p = _write(json.dumps({"port": 9443}))
    try:
        assert config.load_config(p)["port"] == 9443
    finally:
        os.remove(p)


def test_bom_utf8_config_reads():
    # BOM 付き UTF-8（PowerShell 5.1 の Set-Content -Encoding UTF8 等で保存されることがある）でも読める
    p = _write("\ufeff" + json.dumps({"port": 9444}))
    try:
        assert config.load_config(p)["port"] == 9444
    finally:
        os.remove(p)


def test_out_of_range_falls_back():
    for bad in (0, 99999):
        p = _write(json.dumps({"port": bad}))
        try:
            assert config.load_config(p)["port"] == config.DEFAULT_PORT
        finally:
            os.remove(p)


def test_wrong_type_falls_back():
    for bad in ("8443", True):
        p = _write(json.dumps({"port": bad}))
        try:
            assert config.load_config(p)["port"] == config.DEFAULT_PORT
        finally:
            os.remove(p)


def test_broken_json_falls_back():
    p = _write("{port: 8443")  # 不正 JSON
    try:
        assert config.load_config(p)["port"] == config.DEFAULT_PORT
    finally:
        os.remove(p)


def test_missing_file_falls_back():
    p = os.path.join(TMP, "nope.json")
    shutil.rmtree(TMP, ignore_errors=True)
    assert config.load_config(p)["port"] == config.DEFAULT_PORT


# ---- photos_root ----

def test_photos_root_default():
    # 既定はリポジトリ直下の Photos/（実在するため作成副作用なし）
    assert config.load_config()["photos_root"] == os.path.join(ROOT, "Photos")


def test_photos_root_relative_resolved_to_root():
    target = os.path.normpath(os.path.join(ROOT, ".tmp", "alt_rel_photos"))
    shutil.rmtree(target, ignore_errors=True)
    p = _write(json.dumps({"photos_root": ".tmp/alt_rel_photos"}))
    try:
        got = config.load_config(p)["photos_root"]
        assert got == os.path.normpath(target)
        assert os.path.isdir(got)  # 存在しないため自動作成された
    finally:
        os.remove(p)
        shutil.rmtree(target, ignore_errors=True)


def test_photos_root_absolute():
    target = os.path.join(TMP, "abs_photos")
    os.makedirs(target, exist_ok=True)
    p = _write(json.dumps({"photos_root": target}))
    try:
        assert config.load_config(p)["photos_root"] == os.path.normpath(target)
    finally:
        os.remove(p)
        shutil.rmtree(target, ignore_errors=True)


def test_photos_root_invalid_falls_back():
    for bad in (123, "", "   ", True):
        p = _write(json.dumps({"photos_root": bad}))
        try:
            assert config.load_config(p)["photos_root"] == os.path.join(ROOT, "Photos")
        finally:
            os.remove(p)


# ---- album_mode ----

def test_real_config_file_has_album_mode():
    # リポジトリ直下の config.json は album_mode を持つ。運用値は 1/2 のいずれかでよく
    # （既定 1 と限らない: 実機検証中の運用値が 2 でもよい）、フォールバックせずそのまま読めることを検証する。
    with open(config.CONFIG_PATH, encoding="utf-8") as f:
        raw = json.load(f)
    assert raw.get("album_mode") in (1, 2)
    assert config.load_config()["album_mode"] == raw["album_mode"]


def test_valid_album_mode():
    for m in (1, 2):
        p = _write(json.dumps({"album_mode": m}))
        try:
            assert config.load_config(p)["album_mode"] == m
        finally:
            os.remove(p)


def test_album_mode_invalid_falls_back():
    for bad in (0, 3, "1", True, None):
        p = _write(json.dumps({"album_mode": bad}))
        try:
            assert config.load_config(p)["album_mode"] == config.DEFAULT_ALBUM_MODE
        finally:
            os.remove(p)


def test_album_mode_missing_defaults():
    p = _write(json.dumps({"port": 8443}))
    try:
        assert config.load_config(p)["album_mode"] == config.DEFAULT_ALBUM_MODE
    finally:
        os.remove(p)


# ---- downscale_cache_dir（配信時ダウンスケールキャッシュ先・2026-10-31） ----

def test_real_config_file_has_downscale_cache_dir():
    # リポジトリ直下の config.json は downscale_cache_dir を持つ（フォールバックせず読める）
    with open(config.CONFIG_PATH, encoding="utf-8") as f:
        raw = json.load(f)
    assert raw.get("downscale_cache_dir") == config.DEFAULT_DOWNSCALE_CACHE_DIR
    assert config.load_config()["downscale_cache_dir"] == os.path.normpath(
        os.path.join(ROOT, config.DEFAULT_DOWNSCALE_CACHE_DIR)
    )


def test_downscale_cache_dir_default():
    p = _write(json.dumps({"port": 8443}))
    try:
        assert config.load_config(p)["downscale_cache_dir"] == os.path.normpath(
            os.path.join(ROOT, config.DEFAULT_DOWNSCALE_CACHE_DIR)
        )
    finally:
        os.remove(p)


def test_downscale_cache_dir_relative_resolved_to_root():
    p = _write(json.dumps({"downscale_cache_dir": ".tmp/alt_ds_cache"}))
    try:
        assert config.load_config(p)["downscale_cache_dir"] == os.path.normpath(
            os.path.join(ROOT, ".tmp", "alt_ds_cache")
        )
    finally:
        os.remove(p)


def test_downscale_cache_dir_absolute():
    target = os.path.join(TMP, "abs_ds_cache")
    p = _write(json.dumps({"downscale_cache_dir": target}))
    try:
        assert config.load_config(p)["downscale_cache_dir"] == os.path.normpath(target)
    finally:
        os.remove(p)


def test_downscale_cache_dir_invalid_falls_back():
    for bad in (123, "", "   ", True, None):
        p = _write(json.dumps({"downscale_cache_dir": bad}))
        try:
            assert config.load_config(p)["downscale_cache_dir"] == os.path.normpath(
                os.path.join(ROOT, config.DEFAULT_DOWNSCALE_CACHE_DIR)
            )
        finally:
            os.remove(p)


def test_downscale_cache_dir_inside_photos_root_falls_back():
    # photos_root 配下だとキャッシュ JPEG をインデックスが写真として拾うため既定値へ
    for bad in ("Photos", "Photos/ds_cache"):
        p = _write(json.dumps({"downscale_cache_dir": bad}))
        try:
            assert config.load_config(p)["downscale_cache_dir"] == os.path.normpath(
                os.path.join(ROOT, config.DEFAULT_DOWNSCALE_CACHE_DIR)
            )
        finally:
            os.remove(p)


# ---- downscale_enabled（配信時ダウンスケール ON/OFF・2026-10-31） ----

def test_real_config_file_has_downscale_enabled():
    # リポジトリ直下の config.json は downscale_enabled を持つ（フォールバックせず読める）
    with open(config.CONFIG_PATH, encoding="utf-8") as f:
        raw = json.load(f)
    assert raw.get("downscale_enabled") is True
    assert config.load_config()["downscale_enabled"] is True


def test_downscale_enabled_default():
    p = _write(json.dumps({"port": 8443}))
    try:
        assert config.load_config(p)["downscale_enabled"] is True
    finally:
        os.remove(p)


def test_downscale_enabled_false():
    p = _write(json.dumps({"downscale_enabled": False}))
    try:
        assert config.load_config(p)["downscale_enabled"] is False
    finally:
        os.remove(p)


def test_downscale_enabled_invalid_falls_back():
    # 真偽値以外は日本語警告を出して既定 true（文字列 "false" も無効化しない）
    for bad in ("false", "true", 1, 0, None):
        p = _write(json.dumps({"downscale_enabled": bad}))
        try:
            assert config.load_config(p)["downscale_enabled"] is True
        finally:
            os.remove(p)


# ---- album_for_rel（アルバムキー導出） ----

def test_album_for_rel_mode1():
    f = config.album_for_rel
    assert f("a.jpg", 1) == ""                # photos_root 直下
    assert f("AlbumA/a.jpg", 1) == "AlbumA"   # 第一階層
    assert f("a/b/c.jpg", 1) == "a/b"         # 第二階層以下の親ディレクトリがアルバム
    assert f("a/b/c/d.jpg", 1) == "a/b/c"


def test_album_for_rel_mode2():
    f = config.album_for_rel
    assert f("a.jpg", 2) == ""                # photos_root 直下は従来どおり ''
    assert f("AlbumA/a.jpg", 2) == "AlbumA"
    assert f("a/b/c.jpg", 2) == "a"           # 第二階層以下も第一階層のアルバムに含む
    assert f("a/b/c/d.jpg", 2) == "a"
