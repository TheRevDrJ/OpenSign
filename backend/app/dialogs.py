"""Native file/folder dialogs, opened on the display machine.

Cross-platform, because these are called from a FastAPI worker thread:

- macOS: shell out to `osascript` (the built-in Cocoa choosers). No Tk
  dependency, and — crucially — it runs in its own process, so it isn't bound
  by macOS's rule that GUI must live on the main thread. (Calling tkinter from
  uvicorn's worker thread crashes on macOS; Homebrew's Python also ships
  without Tk, so `import tkinter` fails outright there.) The chooser is run
  inside an activated `System Events` block so the dialog comes to the FRONT —
  a bare osascript chooser opens behind the browser, unfocused, and is missed.
- Windows / Linux: tkinter, which ships with the stdlib Python on Windows and
  tolerates being driven off the main thread.

Each function returns a real filesystem path, or None if the user cancels.
"""

from __future__ import annotations

import subprocess
import sys

IMAGE_EXTS = ["png", "jpg", "jpeg", "gif", "bmp", "webp", "svg"]

_IS_MAC = sys.platform == "darwin"


# --- macOS: osascript / AppleScript -----------------------------------------

def _osascript(script: str) -> str | None:
    """Run an AppleScript; return its stdout, or None on cancel/error.
    A cancelled `choose …` dialog exits non-zero with error -128 (not logged);
    any other failure is logged to stderr (→ backend.log) so it's debuggable."""
    try:
        r = subprocess.run(
            ["osascript", "-e", script], capture_output=True, text=True
        )
    except FileNotFoundError:
        print("[dialogs] osascript not found", file=sys.stderr, flush=True)
        return None
    if r.returncode != 0:
        err = r.stderr.strip()
        if "-128" not in err:  # -128 = user canceled; that's not an error
            print(f"[dialogs] osascript failed (rc={r.returncode}): {err}",
                  file=sys.stderr, flush=True)
        return None
    return r.stdout.strip() or None


def _choose(choose_expr: str, posix: bool = True) -> str | None:
    """Run a Standard Additions `choose …` expression with the dialog brought
    to the front. `choose …` works inside a System Events tell block, and
    activating System Events makes the resulting dialog frontmost."""
    inner = f"POSIX path of ({choose_expr})" if posix else choose_expr
    return _osascript(
        'tell application "System Events"\n'
        "    activate\n"
        f"    return {inner}\n"
        "end tell"
    )


def _type_list(exts: list[str]) -> str:
    # -> {"png", "jpg", …} for AppleScript's `choose file of type`
    return "{" + ", ".join(f'"{e}"' for e in exts) + "}"


# --- Windows / Linux: tkinter ------------------------------------------------

def _tk(dialog: str, **kw) -> str | None:
    import tkinter as tk
    from tkinter import filedialog

    root = tk.Tk()
    root.withdraw()
    root.attributes("-topmost", True)
    try:
        path = getattr(filedialog, dialog)(parent=root, **kw)
    finally:
        root.destroy()
    return path or None


# --- Public API (OS-dispatched) ---------------------------------------------

def pick_folder(title: str = "Choose a folder") -> str | None:
    if _IS_MAC:
        p = _choose(f'choose folder with prompt "{title}"')
        # osascript hands back folders with a trailing slash; drop it to match
        # tkinter and avoid double slashes when the path is later joined.
        return p[:-1] if p and p.endswith("/") and len(p) > 1 else p
    return _tk("askdirectory", title=title)


def pick_image(title: str = "Choose an image") -> str | None:
    if _IS_MAC:
        return _choose(
            f'choose file with prompt "{title}" of type {_type_list(IMAGE_EXTS)}'
        )
    pattern = " ".join(f"*.{e}" for e in IMAGE_EXTS)
    return _tk(
        "askopenfilename",
        title=title,
        filetypes=[("Images", pattern), ("All files", "*.*")],
    )


def save_layout(
    title: str = "Save layout", default_name: str = "opensign-layout.json"
) -> str | None:
    if _IS_MAC:
        p = _choose(
            f'choose file name with prompt "{title}" default name "{default_name}"'
        )
        if p and not p.lower().endswith(".json"):
            p += ".json"
        return p
    return _tk(
        "asksaveasfilename",
        title=title,
        defaultextension=".json",
        initialfile=default_name,
        filetypes=[("OpenSign layout", "*.json"), ("All files", "*.*")],
    )


def load_layout(title: str = "Load layout") -> str | None:
    if _IS_MAC:
        return _choose(f'choose file with prompt "{title}" of type {{"json"}}')
    return _tk(
        "askopenfilename",
        title=title,
        filetypes=[("OpenSign layout", "*.json"), ("All files", "*.*")],
    )
