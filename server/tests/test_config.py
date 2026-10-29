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
