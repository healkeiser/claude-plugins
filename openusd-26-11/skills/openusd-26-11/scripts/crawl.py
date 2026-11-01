# /// script
# requires-python = ">=3.10"
# dependencies = ["beautifulsoup4", "markdownify"]
# ///
"""Mirror the OpenUSD documentation and the USD Survival Guide to local Markdown.

Sources:
  openusd   https://openusd.org/<tag>/       page list from Sphinx objects.inv (Doxygen API excluded)
  api       https://openusd.org/<tag>/api/   Doxygen narrative pages only (pages.html), no class reference
  survival  https://lucascheller.github.io/VFX-UsdSurvivalGuide/   page list from the mdBook sidebar (unversioned)

The USD version comes from the skill folder name (openusd-26-11 -> 26.11), or --version.
openusd.org/versions.json maps it to its URL segment: "release" for the current release,
"dev" for the next one, the number itself for older ones. The crawl stops if the version is
not listed or the fetched docs report another version, so a refresh never silently moves on.

Every run fetches everything again (a few hundred pages, a few minutes) and rewrites docs/.

    uv run scripts/crawl.py [--version 26.11] [--out DIR] [--workers 4] [--delay 0.3] [--only openusd|api|survival]
"""

import argparse
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zlib
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from bs4 import BeautifulSoup
from markdownify import markdownify

SITE = "https://openusd.org/"
OPENUSD = API = ""  # set by resolve_version() before any fetch
SURVIVAL = "https://lucascheller.github.io/VFX-UsdSurvivalGuide/"
UA = "Mozilla/5.0 (openusd skill docs mirror; personal offline reference)"
# Pages with no reference value: build/style notes, license stubs, version badges.
SKIP = re.compile(r"^(README|dl_license|tut_setup_version_badge|genindex|search|slack_channels)$")


def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code == 404:
                raise
            wait = 10 * (attempt + 1)
        except (urllib.error.URLError, TimeoutError):
            wait = 5 * (attempt + 1)
        print(f"  retry {url} in {wait}s", file=sys.stderr)
        time.sleep(wait)
    raise RuntimeError(f"gave up on {url}")


def openusd_pages() -> list[str]:
    """Doc names from the Sphinx inventory: every page the toctree builds, nothing from /api/."""
    data = fetch(OPENUSD + "objects.inv")
    for _ in range(4):  # four plain-text header lines, then zlib
        data = data[data.index(b"\n") + 1 :]
    names = []
    for line in zlib.decompress(data).decode("utf-8").splitlines():
        m = re.match(r"(\S+) std:doc -?\d+ ", line)
        if m and not SKIP.match(m.group(1)):
            names.append(m.group(1))
    return sorted(set(names))


def api_pages() -> list[str]:
    """Narrative pages listed on the Doxygen "Related Pages" index (module overviews, guides)."""
    html = fetch(API + "pages.html").decode("utf-8")
    names = set(re.findall(r'href="([a-z_0-9]+)\.html"', html)) - {"deprecated", "pages", "index"}
    return sorted(names)


def survival_pages() -> list[str]:
    soup = BeautifulSoup(fetch(SURVIVAL), "html.parser")
    names = []
    for a in soup.select("#sidebar a[href], nav a[href], .chapter a[href]"):
        href = a["href"].split("#")[0].removeprefix("./")
        if href.endswith(".html") and "://" not in href and href not in ("print.html", "toc.html"):
            names.append(href[: -len(".html")])
    return sorted(set(names) | {"index"})


def to_markdown(node, base: str) -> str:
    for tag in node.select("a.headerlink, script, style, .mobile-nav-chapters, nav, div.toc"):
        tag.decompose()
    # Absolute links so the user can open them, and grep finds cross-references by URL.
    for a in node.select("a[href]"):
        a["href"] = urllib.parse.urljoin(base, a["href"])
        a.attrs.pop("title", None)  # Doxygen tooltips would triple every link's length
    for img in node.select("img"):
        alt = img.get("alt") or ""
        img.replace_with(f"[image: {alt}]" if alt else "")
    # Doxygen code: <div class="fragment"> of <div class="line"> rows.
    for frag in node.select("div.fragment"):
        pre = BeautifulSoup("", "html.parser").new_tag("pre")
        pre.string = "\n".join(l.get_text().rstrip() for l in frag.select("div.line"))
        frag.replace_with(pre)
    # Sphinx/mdBook code blocks: keep the language so fences stay readable.
    for pre in node.select("pre"):
        lang = ""
        div = pre.find_parent("div", class_=re.compile(r"highlight-"))
        if div:
            lang = next((c[len("highlight-"):] for c in div["class"] if c.startswith("highlight-")), "")
        code = pre.find("code")
        if code and not lang:
            lang = next((c[len("language-"):] for c in code.get("class", []) if c.startswith("language-")), "")
        text = pre.get_text()
        new = BeautifulSoup("", "html.parser").new_tag("pre")
        new.string = f"\x00{lang}\x00{text}"
        pre.replace_with(new)
    md = markdownify(str(node), heading_style="ATX", code_language_callback=lambda el: "")
    # markdownify fences our placeholder; rewrite to ```lang
    md = re.sub(
        r"```\n([ \t]*)\x00([\w+-]*)\x00",
        lambda m: f"```{'python' if m.group(2) in ('python3', 'py') else m.group(2)}\n{m.group(1)}",
        md,
    )
    md = md.replace("\x00", "")
    md = re.sub(r"\n{3,}", "\n\n", md).strip()
    return md


def convert(source: str, name: str) -> tuple[str, str, str, str]:
    base = {"openusd": OPENUSD, "api": API, "survival": SURVIVAL}[source]
    url = base + name + ".html"
    soup = BeautifulSoup(fetch(url), "html.parser")
    title = soup.title.get_text(strip=True) if soup.title else name
    title = re.split(r" (?:—|&mdash;|-) (?:Universal Scene Description|USD Survival Guide)|^Universal Scene Description: ", title)[-1 if title.startswith("Universal Scene Description:") else 0].strip()
    if source == "api":
        t = soup.select_one("div.headertitle div.title")
        title = t.get_text(" ", strip=True) if t else title
        node = soup.select_one("div.contents")
    elif source == "openusd":
        node = soup.select_one('[itemprop="articleBody"], div[role="main"]')
    else:
        node = soup.select_one("main")
    if node is None:
        return title, url, "", ""
    md = to_markdown(node, url)
    summary = next((p for p in md.split("\n\n") if len(p) > 40 and p[0] not in "#![|>`*-"), "")
    return title, url, f"# {title}\n\nSource: {url}\n\n{md}\n", " ".join(summary.split())[:240]


def resolve_version(version: str) -> None:
    """Point OPENUSD/API at the docs for exactly this version, or exit."""
    global OPENUSD, API
    entries = json.loads(fetch(SITE + "versions.json"))["versions"]
    entry = next((e for e in entries if e.get("version") == version), None)
    if entry is None:
        sys.exit(f"USD {version} is not on openusd.org; listed: {', '.join(e['version'] for e in entries)}")
    OPENUSD = f"{SITE}{entry.get('tag') or version}/"
    API = OPENUSD + "api/"
    title = BeautifulSoup(fetch(OPENUSD + "index.html"), "html.parser").title.get_text()
    if f"{version} documentation" not in title:
        sys.exit(f"{OPENUSD} does not serve {version} (title: {title!r})")
    print(f"USD {version}: {OPENUSD}", flush=True)


def main() -> None:
    folder = Path(__file__).resolve().parent.parent.name
    m = re.fullmatch(r"openusd-(\d\d)-(\d\d)", folder)
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--version", default=f"{m[1]}.{m[2]}" if m else None, required=not m, help="USD release, e.g. 26.11")
    ap.add_argument("--out", type=Path, default=Path(__file__).resolve().parent.parent / "docs")
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--delay", type=float, default=0.3)
    ap.add_argument("--only", choices=["openusd", "api", "survival"])
    args = ap.parse_args()
    if args.only != "survival":
        resolve_version(args.version)

    jobs = []
    if args.only in (None, "openusd"):
        jobs += [("openusd", n) for n in openusd_pages()]
    if args.only in (None, "api"):
        jobs += [("api", n) for n in api_pages()]
    if args.only in (None, "survival"):
        jobs += [("survival", n) for n in survival_pages()]
    print(f"{len(jobs)} pages to fetch", flush=True)

    def work(job):
        source, name = job
        try:
            title, url, text, summary = convert(source, name)
        except Exception as e:  # one bad page must not stop the mirror
            print(f"  failed {source}/{name}: {e}", file=sys.stderr)
            return None
        time.sleep(args.delay)
        if not text:
            print(f"  no body {url}", file=sys.stderr)
            return None
        rel = f"{source}/{name}.md"
        path = args.out / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
        return rel, title, summary

    with ThreadPoolExecutor(args.workers) as pool:
        rows = [r for r in pool.map(work, jobs) if r]

    index = args.out / "index.tsv"
    keep = []
    if args.only and index.exists():  # partial run: keep the other source's rows
        keep = [l for l in index.read_text(encoding="utf-8").splitlines()[1:] if not l.startswith(args.only + "/")]
    lines = keep + [f"{rel}\t{title}\t{summary}" for rel, title, summary in rows]
    index.write_text("file\ttitle\tsummary\n" + "\n".join(sorted(lines)) + "\n", encoding="utf-8")
    print(f"done: {len(rows)} of {len(jobs)} pages written, {len(lines)} indexed")


if __name__ == "__main__":
    main()
