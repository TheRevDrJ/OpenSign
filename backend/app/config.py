"""Config persistence. The single source of truth is data/config.json; the
admin page writes it, the kiosk reads it. Defaults mirror frontend/src/config.ts."""

import json

from .paths import CONFIG_PATH, ensure_dirs

DEFAULT_CONFIG = {
    "mode": "text",
    "theme": "honededge",
    "light": False,
    "orientation": "landscape",
    "text": {
        "headline": "The Honed Edge",
        "subtext": "Wisdom helps one to succeed. — Ecclesiastes 10:10",
        "showLogo": True,
    },
    "images": {"kind": "single", "fit": "contain", "image": "", "folder": "", "intervalMs": 8000},
    "widgets": {
        "clock": {"enabled": False, "x": 100, "y": 100, "size": "md"},
        "calendar": {"enabled": False, "x": 100, "y": 0, "size": "md"},
        "countdown": {
            "enabled": False,
            "x": 50,
            "y": 50,
            "size": "lg",
            "label": "TIME UNTIL WORSHIP",
            "target": "10:45",
        },
    },
}


def load_config() -> dict:
    ensure_dirs()
    if CONFIG_PATH.exists():
        try:
            saved = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
            return {**DEFAULT_CONFIG, **saved}
        except Exception:
            return dict(DEFAULT_CONFIG)
    return dict(DEFAULT_CONFIG)


def save_config(cfg: dict) -> dict:
    ensure_dirs()
    CONFIG_PATH.write_text(
        json.dumps(cfg, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    return cfg
