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
