# /// script
# requires-python = ">=3.10"
# dependencies = ["beautifulsoup4", "markdownify"]
# ///
"""Mirror the Cinema 4D user manual and the Cinema 4D Python SDK documentation to local Markdown.

Sources:
  python  https://developers.maxon.net/docs/py/<2027_0_0>/   page list from Sphinx objects.inv (everything:
          c4d.*, maxon.*, c4d.modules.*, constants, types, manuals, examples). Pinned by URL.
  manual  https://help.maxon.net/c4d/en-us/Content/html/   page list from the static table of contents
          that every MadCap Flare page embeds. Not versioned by URL: the crawl stops if the manual reports
          another Cinema 4D version than this skill's.

The version comes from the skill folder name (cinema4d-2027 -> 2027, Python SDK 2027_0_0), or --version
(e.g. 2027.1 -> SDK 2027_1_0). Resumable: pages already in docs/manifest.jsonl are skipped; --refresh
fetches everything again. ~9,400 pages (manual ~7,400), about 1.5 hours.

    uv run scripts/crawl.py [--version 2027] [--out DIR] [--workers 4] [--delay 0.3] [--only python|manual] [--refresh]
"""

import argparse
import gzip
import json
import re
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import zlib
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from bs4 import BeautifulSoup
from markdownify import markdownify

PY = ""  # set in main() from the version
MANUAL = "https://help.maxon.net/c4d/en-us/Content/html/"
MANUAL_ROOT = "33010"  # "What's new in Cinema 4D <version>"
UA = "Mozilla/5.0 (cinema4d-2027 docs mirror; personal offline reference)"
# Sphinx pages with no reference value.
SKIP = re.compile(r"^(genindex|search|py-modindex|license)$")


def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Encoding": "gzip"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                data = r.read()
                return gzip.decompress(data) if r.headers.get("Content-Encoding") == "gzip" else data
        except urllib.error.HTTPError as e:
            if e.code == 404:
                raise
            wait = 15 * (attempt + 1)
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            wait = 5 * (attempt + 1)
        print(f"  retry {url} in {wait}s", file=sys.stderr)
        time.sleep(wait)
    raise RuntimeError(f"gave up on {url}")


def python_pages(version: str) -> list[str]:
    """Doc names from the Sphinx inventory; the header states the SDK version it was built for."""
    data = fetch(PY + "objects.inv")
    header = data[:300].decode("utf-8", "replace")
    m = re.search(r"# Version: (\S+)", header)
    if not m or m[1] != version:
        sys.exit(f"{PY} reports SDK version {m[1] if m else '?'}, not {version}")
    for _ in range(4):  # four plain-text header lines, then zlib
        data = data[data.index(b"\n") + 1 :]
    names = set()
    for line in zlib.decompress(data).decode("utf-8").splitlines():
        m = re.match(r"(\S+) std:doc -?\d+ ", line)
        if m and not SKIP.match(m[1]):
            names.add(m[1])
    return sorted(names)


def manual_version(soup) -> str | None:
    v = soup.select_one(".mc-variable.Cinema4DVarSet\\.CinemaVer")
    return v.get_text(strip=True) if v else None


def manual_pages(major: str) -> list[str]:
    """Every topic in the static table of contents that each Flare page carries (~700 KB of nav)."""
    soup = BeautifulSoup(fetch(MANUAL + MANUAL_ROOT + ".html"), "html.parser")
    title = soup.title.get_text(strip=True) if soup.title else ""
    if manual_version(soup) != major or major not in title:
        sys.exit(f"the online manual is for Cinema 4D {manual_version(soup)} ({title!r}), not {major}")
    names = set()
    for a in soup.select("nav.static-toc a[href]"):
        href = a["href"].split("#")[0]
        # shortcut: only topics in Content/html/; the few _REDSHIFT_ links go to the separate Redshift docs.
        if href.endswith(".html") and "/" not in href:
            names.add(href[: -len(".html")])
    return sorted(names | {MANUAL_ROOT})


def to_markdown(node, base: str) -> str:
    for tag in node.select("a.headerlink, script, style, button, nav:not(.section-index), noscript, video, audio, iframe, .nocontent, .breadcrumbs, img.icon"):
        tag.decompose()
    # Flare "new in <version>" badges: a bare year in the text reads as noise, so label it.
    for tag in node.select("div.release_marker"):
        tag.string = f"[Release marker: {tag.get_text(strip=True)}]"
        tag.name = "p"
    # Flare parameters (p.IDcontainer) and menu commands (span.c4d_menu_id) become "#### " headings
    # carrying their symbol: the parameter id is the c4d constant, PLUGIN_CMD_<n> the CallCommand id.
    for p in node.select("p.IDcontainer, p:has(> span.c4d_menu_id)"):
        name = p.select_one("span.c4d_id, span.c4d_menu_id")
        rng = p.select_one("span.range")
        sym = (p.get("data-debug") or "").partition("]:")[2]
        text = " ".join(x.get_text(" ", strip=True) for x in (name, rng) if x) or p.get_text(" ", strip=True)
        p.clear()
        p.name = "h4"
        p.string = f"{text} ({sym})" if sym else text
    for tag in node.select("p.c4d_group, p.section-index__title"):
        tag.name = "h2"
    for tag in node.select("p.admonition-title"):
        tag.string = f"**{tag.get_text(strip=True)}:**"
    for a in node.select("a[href]"):
        a["href"] = urllib.parse.urljoin(base, a["href"])
        a.attrs.pop("title", None)
    for img in node.select("img"):
        alt = (img.get("alt") or "").strip()
        if "/" in alt or re.search(r"\.(png|jpe?g|gif|svg|webp)$", alt, re.I):
            alt = ""  # Sphinx falls back to the file path when an image has no alt text
        img.replace_with(f"[image: {alt}]" if alt else "")
    # Sphinx API entries: each signature becomes a "#### " heading, and the definition-list nesting
    # (which markdownify indents) is flattened so code blocks and tables stay at the margin.
    for dl in node.select("dl.py"):
        for dt in dl.find_all("dt", recursive=False):
            h = BeautifulSoup("", "html.parser").new_tag("h4")
            code = BeautifulSoup("", "html.parser").new_tag("code")
            code.string = " ".join(dt.get_text("").split())
            h.append(code)
            dt.replace_with(h)
        for dd in dl.find_all("dd", recursive=False):
            dd.unwrap()
        dl.unwrap()
    # Sphinx code blocks: keep the language so fences stay readable.
    for pre in node.select("pre"):
        lang = ""
        div = pre.find_parent("div", class_=re.compile(r"highlight-"))
        if div:
            lang = next((c[len("highlight-") :] for c in div["class"] if c.startswith("highlight-")), "")
        code = pre.find("code")
        if code and not lang:
            lang = next((c[len("language-") :] for c in code.get("class", []) if c.startswith("language-")), "")
        new = BeautifulSoup("", "html.parser").new_tag("pre")
        new.string = f"\x00{lang}\x00{pre.get_text()}"
        pre.replace_with(new)
    # No escaping: grep must find BFM_INPUT_QUALIFIER as written, not BFM\_INPUT\_QUALIFIER.
    md = markdownify(
        str(node), heading_style="ATX", code_language_callback=lambda el: "",
        escape_underscores=False, escape_asterisks=False,
    )
    md = re.sub(
        r"```\n([ \t]*)\x00([\w+-]*)\x00",
        lambda m: f"```{'python' if m[2] in ('python3', 'py', 'default') else m[2]}\n{m[1]}",
        md,
    )
    md = md.replace("\x00", "").replace(" ", " ")
    md = re.sub(r"[ \t]+\n", "\n", md)
    md = re.sub(r"\n{3,}", "\n\n", md).strip()
    return md


def convert(source: str, name: str, major: str) -> tuple[str, str, str, str]:
    url = (PY if source == "python" else MANUAL) + name + ".html"
    soup = BeautifulSoup(fetch(url), "html.parser")
    title = soup.title.get_text(" ", strip=True) if soup.title else name
    title = re.sub(r"\s*(?:—|&#8212;|-)\s*Cinema 4D Python SDK.*$", "", title)
    if source == "python":
        node = soup.select_one("div.body[role=main]:not(.mxn-search-overlay-results), div[role=main]")
    else:
        v = manual_version(soup)
        if v and v != major:
            raise RuntimeError(f"page reports Cinema 4D {v}, not {major}")
        node = soup.select_one("#mc-main-content") or soup.select_one("main")
    if node is None:
        return title, url, "", ""
    md = to_markdown(node, url)
    first, _, rest = md.partition("\n\n")
    if first.lstrip("# ").replace("\\", "") == title:  # the page's own heading repeats the title
        md = rest
    return title, url, f"# {title}\n\nSource: {url}\n\n{md}\n", summarize(md)


def summarize(md: str) -> str:
    """First real paragraph; for parameter-only manual tabs, the parameter names instead."""
    summary = next((p for p in md.split("\n\n") if len(p) > 40 and p[0] not in "#![|>`*-"), "")
    if not summary:
        names = re.findall(r"^#{2,4} (.+?)(?: \[[^\]]*\])?(?: \([A-Z0-9_]+\))?$", md, re.M)
        names = [n for n in names if n != "In this section"]
        topics = re.findall(r"^\* \[([^\]]+)\]", md, re.M)  # section index: the child topics
        summary = "Parameters: " + ", ".join(names) if names else "Topics: " + ", ".join(topics) if topics else ""
    if not summary:  # short pages: whatever first paragraph there is
        summary = next((p for p in md.split("\n\n") if p.strip() and p[0] != "#"), "")
    return " ".join(summary.split())[:240]


def main() -> None:
    folder = Path(__file__).resolve().parent.parent.name
    m = re.fullmatch(r"cinema4d-(\d{4})", folder)
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--version", default=m[1] if m else None, required=not m, help="Cinema 4D release, e.g. 2027 or 2027.1")
    ap.add_argument("--out", type=Path, default=Path(__file__).resolve().parent.parent / "docs")
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--delay", type=float, default=0.3, help="seconds each worker waits between requests")
    ap.add_argument("--only", choices=["python", "manual"])
    ap.add_argument("--refresh", action="store_true", help="ignore the manifest and fetch everything again")
    args = ap.parse_args()

    global PY
    parts = (args.version.split(".") + ["0", "0"])[:3]
    major, sdk = parts[0], ".".join(parts)
    PY = f"https://developers.maxon.net/docs/py/{'_'.join(parts)}/"

    jobs = []
    if args.only in (None, "python"):
        jobs += [("python", n) for n in python_pages(sdk)]
        print(f"Python SDK {sdk}: {PY}", flush=True)
    if args.only in (None, "manual"):
        jobs += [("manual", n) for n in manual_pages(major)]
        print(f"Cinema 4D {major} manual: {MANUAL}", flush=True)

    args.out.mkdir(parents=True, exist_ok=True)
    manifest = args.out / "manifest.jsonl"
    done: dict[str, dict] = {}
    if args.refresh:
        manifest.unlink(missing_ok=True)
    elif manifest.exists():
        for line in manifest.read_text(encoding="utf-8").splitlines():
            e = json.loads(line)
            done[e["file"]] = e
    todo = [j for j in jobs if "title" not in done.get(f"{j[0]}/{j[1]}.md", {})]
    print(f"{len(jobs)} pages, {len(todo)} to fetch", flush=True)

    lock = threading.Lock()
    count = 0

    def work(job):
        nonlocal count
        source, name = job
        rel = f"{source}/{name}.md"
        try:
            title, url, text, summary = convert(source, name, major)
            if not text:
                raise RuntimeError("no body")
            path = args.out / rel
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text, encoding="utf-8")
            entry = {"file": rel, "title": title, "summary": summary}
        except Exception as e:  # one bad page must not stop the mirror
            print(f"  failed {rel}: {e}", file=sys.stderr)
            entry = {"file": rel, "error": str(e)}
        with lock:
            with manifest.open("a", encoding="utf-8") as f:
                f.write(json.dumps(entry) + "\n")
            done[rel] = entry
            count += 1
            if count % 200 == 0:
                print(f"{count} of {len(todo)} fetched", flush=True)
        time.sleep(args.delay)

    with ThreadPoolExecutor(args.workers) as pool:
        list(pool.map(work, todo))

    rows = sorted((e for e in done.values() if "title" in e), key=lambda e: e["file"])
    with (args.out / "index.tsv").open("w", encoding="utf-8") as f:
        f.write("file\ttitle\tsummary\n")
        for e in rows:
            f.write(f"{e['file']}\t{' '.join(e['title'].split())}\t{e['summary']}\n")
    failed = [e["file"] for e in done.values() if "error" in e]
    print(f"done: {count} fetched, {len(rows)} indexed, {len(failed)} failed (rerun to retry them)")


if __name__ == "__main__":
    main()
