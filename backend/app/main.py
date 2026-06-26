"""OpenSign backend — FastAPI on host 0.0.0.0 so /admin is reachable from any
device on the LAN. Serves images IN PLACE from wherever they live on disk (no
uploading/copying). The picker is a native OS dialog opened on the display
machine, which hands back a real filesystem path. Serves the built frontend on a
single port in production; PyInstaller bundles this into a standalone .exe."""

import json
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .config import load_config, save_config
from .paths import base_dir, ensure_dirs

app = FastAPI(title="OpenSign")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

ensure_dirs()

IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".svg"}


# --- Config (read by kiosk, written by admin) ---

@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/config")
def get_config():
    return load_config()


@app.post("/api/config")
async def set_config(cfg: dict):
    return save_config(cfg)


# --- Serve a local file in place (by absolute path) ---

@app.get("/api/localfile")
def localfile(path: str):
    p = Path(path)
    if not p.is_file():
        raise HTTPException(404, f"Not a file: {path}")
    return FileResponse(str(p))


# --- List images in a local folder (for Cycle mode) ---

@app.get("/api/folder/list")
def folder_list(path: str):
    p = Path(path)
    if not p.is_dir():
        raise HTTPException(404, f"Not a folder: {path}")
    files = sorted(
        f.name
        for f in p.iterdir()
        if f.is_file() and f.suffix.lower() in IMAGE_EXTS
    )
    return {"folder": str(p), "files": files}


# --- Native pickers (open a dialog on the display machine, return a path) ---

def _pick(kind: str) -> str | None:
    import tkinter as tk
    from tkinter import filedialog

    root = tk.Tk()
    root.withdraw()
    root.attributes("-topmost", True)
    try:
        if kind == "folder":
            path = filedialog.askdirectory(parent=root, title="Choose a folder")
        else:
            path = filedialog.askopenfilename(
                parent=root,
                title="Choose an image",
                filetypes=[
                    ("Images", "*.png *.jpg *.jpeg *.gif *.bmp *.webp *.svg"),
                    ("All files", "*.*"),
                ],
            )
    finally:
        root.destroy()
    return path or None


@app.get("/api/pick/file")
def pick_file():
    return {"path": _pick("file")}


@app.get("/api/pick/folder")
def pick_folder():
    return {"path": _pick("folder")}


# --- Save / load the whole config as a named .json layout (native dialogs) ---

@app.post("/api/layout/save")
def layout_save(cfg: dict):
    import tkinter as tk
    from tkinter import filedialog

    root = tk.Tk()
    root.withdraw()
    root.attributes("-topmost", True)
    try:
        path = filedialog.asksaveasfilename(
            parent=root,
            title="Save layout",
            defaultextension=".json",
            initialfile="opensign-layout.json",
            filetypes=[("OpenSign layout", "*.json"), ("All files", "*.*")],
        )
    finally:
        root.destroy()
    if not path:
        return {"path": None}
    Path(path).write_text(
        json.dumps(cfg, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    return {"path": path}


@app.get("/api/layout/load")
def layout_load():
    import tkinter as tk
    from tkinter import filedialog

    root = tk.Tk()
    root.withdraw()
    root.attributes("-topmost", True)
    try:
        path = filedialog.askopenfilename(
            parent=root,
            title="Load layout",
            filetypes=[("OpenSign layout", "*.json"), ("All files", "*.*")],
        )
    finally:
        root.destroy()
    if not path:
        return {"path": None, "config": None}
    try:
        cfg = json.loads(Path(path).read_text(encoding="utf-8"))
    except Exception as e:
        raise HTTPException(400, f"Not a valid layout file: {e}")
    return {"path": path, "config": cfg}


# --- Serve the built frontend in production (dist may not exist in dev) ---

DIST = base_dir() / "frontend" / "dist"
if DIST.exists():
    app.mount("/assets", StaticFiles(directory=str(DIST / "assets")), name="assets")

    @app.get("/{full_path:path}")
    def spa(full_path: str):
        if full_path.startswith(("api/", "assets/")):
            raise HTTPException(404)
        candidate = DIST / full_path
        if full_path and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(DIST / "index.html")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=6101)
