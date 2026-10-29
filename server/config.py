# サーバー設定ファイル（リポジトリ直下の config.json）。
# テキストエディタで書き換えてサーバーを再起動すると反映される（GUI なし）。
# 読み込み失敗時（ファイル無し / JSON 不正 / port が範囲外）は既定値へフォールバックして警告を出す。
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG_PATH = os.path.join(ROOT, "config.json")
DEFAULT_PORT = 8443


def load_config(path: str = CONFIG_PATH) -> dict:
    """config.json を読んで設定辞書を返す。不正値は既定値にフォールバック。"""
    cfg: dict = {}
    try:
        with open(path, encoding="utf-8") as f:
            loaded = json.load(f)
        if isinstance(loaded, dict):
            cfg = loaded
        else:
            print(f"config.json がオブジェクトではないため既定ポート {DEFAULT_PORT} を使用")
    except FileNotFoundError:
        pass  # 設定ファイルが無いのはエラーではない（既定値で作動）
    except (json.JSONDecodeError, OSError) as e:
        print(f"config.json が読み込めないため既定ポート {DEFAULT_PORT} を使用: {e}")
    port = cfg.get("port", DEFAULT_PORT)
    # bool は int のサブクラスだがポートとして不正。文字列も拒否。
    if not isinstance(port, int) or isinstance(port, bool) or not (1 <= port <= 65535):
        print(f"config.json の port が不正なため既定ポート {DEFAULT_PORT} を使用: {port!r}")
        port = DEFAULT_PORT
    return {"port": port}
