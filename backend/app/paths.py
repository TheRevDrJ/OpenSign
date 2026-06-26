"""Filesystem layout. Resolves a writable data dir whether running from source
(dev) or frozen as a PyInstaller .exe (the eventual shipping shape)."""

import sys
from pathlib import Path


def base_dir() -> Path:
    # Frozen exe: data lives next to the executable. Dev: the project root.
    if getattr(sys, 'frozen', False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parents[2]  # opensign/


DATA_DIR = base_dir() / 'data'
CONFIG_PATH = DATA_DIR / 'config.json'


def ensure_dirs() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
