# /// script
# requires-python = ">=3.10"
# dependencies = ["beautifulsoup4", "markdownify"]
# ///
"""Mirror the rez documentation to local Markdown, built from the official git tag.

Default (--source git): shallow-clone github.com/AcademySoftwareFoundation/rez at the tag,
build docs/source with Sphinx in a throwaway uv venv (docs/requirements.txt, Python 3.13 as
.readthedocs.yaml), convert the built HTML, delete the temp dir. `Source:` lines still point
at the canonical https://rez.readthedocs.io/en/<version>/<page>.html.
--source web fetches rez.readthedocs.io instead (it Cloudflare-challenges bursts; slow).

Page list from the Sphinx objects.inv (std:doc entries): user guide, CLI pages (commands/)
and the API reference (api/rez.*). Everything is mirrored except genindex/search.

The rez version comes from the skill folder name (rez-3-4 -> the latest 3.4.x git tag, or
readthedocs version for --source web), or --version (exact, e.g. 3.4.0). The run stops if no
such tag/version exists or the built docs report another version. Branches, `stable` and
`latest` are never used: they move.

Every run rebuilds everything and rewrites docs/. Needs git and uv on PATH.

    uv run scripts/crawl.py [--version 3.4.0] [--out DIR] [--source git|web] [--workers 1] [--delay 1.5]
"""

import argparse
import json
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import zlib
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from bs4 import BeautifulSoup
from markdownify import markdownify

SITE = "https://rez.readthedocs.io/en/"
REPO = "https://github.com/AcademySoftwareFoundation/rez"
LOCAL: Path | None = None  # built HTML dir when --source git; pages are read from here
VERSIONS = "https://readthedocs.org/api/v3/projects/rez/versions/?active=true&limit=100"
BASE = ""  # set by resolve_version() before any page fetch
UA = "Mozilla/5.0 (rez skill docs mirror; personal offline reference)"
SKIP = re.compile(r"^(genindex|search|py-modindex)$")


def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    for attempt in range(6):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code == 404:
                raise
            # 429 = Cloudflare bot challenge on readthedocs.io after a burst; only a long pause clears it
            wait = (60 if e.code == 429 else 10) * (attempt + 1)
        except (urllib.error.URLError, TimeoutError):
            wait = 5 * (attempt + 1)
        print(f"  retry {url} in {wait}s", file=sys.stderr)
        time.sleep(wait)
    raise RuntimeError(f"gave up on {url}")


def pages() -> list[str]:
    """Doc names from the Sphinx inventory: every page the toctree builds."""
    data = (LOCAL / "objects.inv").read_bytes() if LOCAL else fetch(BASE + "objects.inv")
    for _ in range(4):  # four plain-text header lines, then zlib
        data = data[data.index(b"\n") + 1 :]
    names = []
    for line in zlib.decompress(data).decode("utf-8").splitlines():
        m = re.match(r"(\S+) std:doc -?\d+ ", line)
        if m and not SKIP.match(m.group(1)):
            names.append(m.group(1))
    return sorted(set(names))


def to_markdown(node, base: str) -> str:
    for tag in node.select("a.headerlink, script, style, nav, .toc-drawer, .related-pages, .content-icon-container"):
        tag.decompose()
    # Absolute links so the user can open them, and grep finds cross-references by URL.
    for a in node.select("a[href]"):
        if a["href"].startswith("https://docs.python.org/"):
            a.unwrap()  # intersphinx links on every str/dict/None would triple API signature length
            continue
        a["href"] = urllib.parse.urljoin(base, a["href"])
        a.attrs.pop("title", None)
    for img in node.select("img"):
        alt = img.get("alt") or ""
        img.replace_with(f"[image: {alt}]" if alt else "")
    # Sphinx code blocks: keep the language so fences stay readable.
    for pre in node.select("pre"):
        lang = ""
        div = pre.find_parent("div", class_=re.compile(r"highlight-"))
        if div:
            lang = next((c[len("highlight-"):] for c in div["class"] if c.startswith("highlight-")), "")
        new = BeautifulSoup("", "html.parser").new_tag("pre")
        new.string = f"\x00{lang}\x00{pre.get_text()}"
        pre.replace_with(new)
    # no escaping: API names like __init__ and *args must stay greppable verbatim
    md = markdownify(str(node), heading_style="ATX", code_language_callback=lambda el: "", escape_underscores=False, escape_asterisks=False)
    # markdownify fences our placeholder; rewrite to ```lang (Sphinx "default"/"none" -> plain)
    md = re.sub(
        r"```\n([ \t]*)\x00([\w+-]*)\x00",
        lambda m: "```" + {"python3": "python", "py": "python", "default": "", "none": ""}.get(m[2], m[2]) + "\n" + m[1],
        md,
    )
    md = md.replace("\x00", "")
    md = re.sub(r"\n{3,}", "\n\n", md).strip()
    return md


def convert(name: str) -> tuple[str, str, str, str]:
    url = BASE + name + ".html"  # canonical URL, also the base for absolute links
    html = (LOCAL / f"{name}.html").read_bytes() if LOCAL else fetch(url)
    soup = BeautifulSoup(html, "html.parser")
    title = soup.title.get_text(strip=True) if soup.title else name
    title = re.split(r" - rez \S+ documentation$", title)[0].strip()
    node = soup.select_one('article[role="main"]')
    if node is None:
        return title, url, "", ""
    md = to_markdown(node, url)
    md = re.sub(r"\A# [^\n]*\n+", "", md)  # page's own H1; we write the title ourselves
    summary = next((p for p in md.split("\n\n") if len(p) > 40 and p[0] not in "#![|>`*-"), "")
    return title, url, f"# {title}\n\nSource: {url}\n\n{md}\n", " ".join(summary.split())[:240]


def resolve_version(version: str) -> None:
    """Point BASE at the docs for exactly this version (or latest x.y.z for an x.y prefix), or exit."""
    global BASE
    slugs = [v["slug"] for v in json.loads(fetch(VERSIONS))["results"]]
    nums = [s for s in slugs if re.fullmatch(r"\d+\.\d+\.\d+", s)]
    match = [s for s in nums if s == version or s.startswith(version + ".")]
    if not match:
        sys.exit(f"rez {version} is not on readthedocs; listed: {', '.join(nums)}")
    version = max(match, key=lambda s: tuple(map(int, s.split("."))))
    BASE = f"{SITE}{version}/"
    title = BeautifulSoup(fetch(BASE + "index.html"), "html.parser").title.get_text()
    if f"rez {version} documentation" not in title:
        sys.exit(f"{BASE} does not serve {version} (title: {title!r})")
    print(f"rez {version}: {BASE}", flush=True)


def pick(tags: list[str], version: str) -> str:
    match = [t for t in tags if re.fullmatch(r"\d+\.\d+\.\d+", t) and (t == version or t.startswith(version + "."))]
    if not match:
        sys.exit(f"rez {version}: no such release; listed: {', '.join(t for t in tags if t[:1].isdigit())}")
    return max(match, key=lambda t: tuple(map(int, t.split("."))))


def build_from_git(version: str, tmp: Path) -> None:
    """Clone the release tag and build its Sphinx HTML into tmp/html; point LOCAL/BASE there."""
    global LOCAL, BASE
    out = subprocess.run(["git", "ls-remote", "--tags", REPO], capture_output=True, text=True, check=True).stdout
    tag = pick(re.findall(r"refs/tags/([^\s^]+)$", out, re.M), version)
    run = lambda *cmd: subprocess.run(cmd, check=True)  # noqa: E731
    run("git", "clone", "-q", "--depth", "1", "--branch", tag, "-c", "advice.detachedHead=false", REPO, str(tmp / "rez"))
    venv = tmp / "venv"
    run("uv", "venv", "-q", "-p", "3.13", str(venv))  # Python per the tag's .readthedocs.yaml
    py = venv / ("Scripts/python.exe" if sys.platform == "win32" else "bin/python")
    run("uv", "pip", "install", "-q", "--python", str(py), "-r", str(tmp / "rez/docs/requirements.txt"))
    # conf.py puts the checkout's src/ on sys.path itself, so autodoc and the CLI pages need no install
    run(str(py), "-m", "sphinx", "-q", "-b", "html", str(tmp / "rez/docs/source"), str(tmp / "html"))
    LOCAL, BASE = tmp / "html", f"{SITE}{tag}/"
    title = BeautifulSoup((LOCAL / "index.html").read_bytes(), "html.parser").title.get_text()
    if f"rez {tag} documentation" not in title:
        sys.exit(f"tag {tag} built docs for another version (title: {title!r})")
    print(f"rez {tag}: built from {REPO} tag {tag}", flush=True)


def main() -> None:
    folder = Path(__file__).resolve().parent.parent.name
    m = re.fullmatch(r"rez-(\d+)-(\d+)", folder)
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--version", default=f"{m[1]}.{m[2]}" if m else None, required=not m, help="rez release, e.g. 3.4.0")
    ap.add_argument("--out", type=Path, default=Path(__file__).resolve().parent.parent / "docs")
    ap.add_argument("--source", choices=["git", "web"], default="git")
    ap.add_argument("--workers", type=int, default=1)
    ap.add_argument("--delay", type=float, default=1.5)
    args = ap.parse_args()
    tmp = Path(tempfile.mkdtemp(prefix="rez-docs-"))  # outside the skill folder
    try:
        if args.source == "git":
            build_from_git(args.version, tmp)
            args.delay = 0  # local files: nothing to throttle
        else:
            resolve_version(args.version)
        crawl(args)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def crawl(args) -> None:
    names = pages()
    print(f"{len(names)} pages to fetch", flush=True)

    def work(name):
        try:
            title, url, text, summary = convert(name)
        except Exception as e:  # one bad page must not stop the mirror
            print(f"  failed {name}: {e}", file=sys.stderr)
            return None
        time.sleep(args.delay)
        if not text:
            print(f"  no body {url}", file=sys.stderr)
            return None
        rel = f"{name}.md"
        path = args.out / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
        return rel, title, summary

    with ThreadPoolExecutor(args.workers) as pool:
        rows = [r for r in pool.map(work, names) if r]

    lines = sorted(f"{rel}\t{title}\t{summary}" for rel, title, summary in rows)
    (args.out / "index.tsv").write_text("file\ttitle\tsummary\n" + "\n".join(lines) + "\n", encoding="utf-8")
    print(f"done: {len(rows)} of {len(names)} pages written, {len(lines)} indexed")


if __name__ == "__main__":
    main()
