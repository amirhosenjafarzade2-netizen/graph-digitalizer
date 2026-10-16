from pathlib import Path
import streamlit as st

st.set_page_config(page_title="Graph Digitizer Pro", layout="wide")

BASE = Path(__file__).parent

# Files that index.html references. Order matters: core must load first.
CSS_FILES = ["styles.css"]
JS_FILES = [
    "digitizer-core.js",
    "digitizer-tools.js",
    "digitizer-smoother.js",           # ← Auto Smooth (needs core + tools)
    "digitizer-curve-detector.js",
    "digitizer-table-ocr.js",          # ← new OCR module
]

def read(name: str) -> str:
    return (BASE / name).read_text(encoding="utf-8")

def build_html() -> str:
    """Take index.html as the single source of truth and inline its CSS/JS,
    so the Streamlit version can never drift from the standalone page."""
    html = read("index.html")
    for name in CSS_FILES:
        tag = f'<link rel="stylesheet" href="{name}">'
        if tag not in html:
            raise ValueError(f"index.html does not contain {tag}")
        html = html.replace(tag, f"<style>\n{read(name)}\n</style>")
    for name in JS_FILES:
        tag = f'<script src="{name}"></script>'
        if tag not in html:
            raise ValueError(f"index.html does not contain {tag}")
        # A literal </script> inside inline JS would end the tag early.
        js = read(name).replace("</script", "<\\/script")
        html = html.replace(tag, f"<script>\n{js}\n</script>")
    return html

required = ["index.html", *CSS_FILES, *JS_FILES]
missing = [n for n in required if not (BASE / n).exists()]
if missing:
    st.error(
        "Missing file(s): " + ", ".join(missing)
        + ". Put them in the same folder as app.py."
    )
    st.stop()

try:
    html_content = build_html()
except ValueError as e:
    st.error(str(e))
    st.stop()

st.title("Graph Digitizer Pro - Streamlit Edition")
st.markdown(
    "Upload a graph image using the control panel on the right, then digitize points by clicking on the canvas. "
    "Calibrate axes, add points, detect curves or extract tables/numbers with OCR, and export data as JSON, CSV, or XLSX."
)

# The page lays out to 100vh inside the iframe and scrolls its own side panel,
# so the outer iframe must not scroll too (double scrollbars).
st.components.v1.html(html_content, height=820, scrolling=False)
