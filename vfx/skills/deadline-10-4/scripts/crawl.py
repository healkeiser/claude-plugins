# /// script
# requires-python = ">=3.10"
# dependencies = ["beautifulsoup4", "markdownify"]
# ///
"""Mirror the Thinkbox Deadline documentation to local Markdown.

Sources (all under https://docs.thinkboxsoftware.com/products/deadline/<version>/):
  manual     1_User Manual/         Sphinx; page list from objects.inv (std:doc entries)
  scripting  2_Scripting Reference/ Doxygen; in-app API (Deadline.Scripting, .Plugins, .Events, .Jobs...)
  python     3_Python Reference/    Doxygen; Standalone Python API (Deadline.DeadlineConnect, web service)

The Deadline version comes from the skill folder name (deadline-10-4 -> 10.4), or --version.
The crawl stops if the manual reports another version, so a refresh never silently moves on.
Doxygen pages are found from the index pages (annotated, classes, hierarchy, member indexes)
and then from the class/namespace pages themselves; member indexes, *-members lists,
source listings and graphs are not mirrored.

Every run fetches everything again (about 500 pages, a few minutes) and rewrites docs/.

    uv run scripts/crawl.py [--version 10.4] [--out DIR] [--workers 4] [--delay 0.3] [--only manual|scripting|python]
"""

import argparse
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

SITE = "https://docs.thinkboxsoftware.com/products/deadline/"
FOLDERS = {"manual": "1_User%20Manual/", "scripting": "2_Scripting%20Reference/", "python": "3_Python%20Reference/"}
BASE = {}  # source -> base URL, set in main()
UA = "Mozilla/5.0 (deadline skill docs mirror; personal offline reference)"
# Sphinx pages with no reference value: generated indexes and search.
SKIP = re.compile(r"^(genindex|search|index-linear|py-modindex)$")
# Doxygen pages worth mirroring: the welcome page, classes, structs, interfaces, namespaces.
DOXY_PAGE = re.compile(r"^(index|(?:class|struct|interface|namespace)_[a-z0-9_]+)\.html$")
DOXY_SEEDS = ["index", "annotated", "classes", "hierarchy", "namespaces", "files", "pages"]


def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code in (403, 404):
                raise
            wait = 10 * (attempt + 1)
        except (urllib.error.URLError, TimeoutError):
            wait = 5 * (attempt + 1)
        print(f"  retry {url} in {wait}s", file=sys.stderr)
        time.sleep(wait)
    raise RuntimeError(f"gave up on {url}")


def manual_pages() -> list[str]:
    data = fetch(BASE["manual"] + "objects.inv")
    for _ in range(4):  # four plain-text header lines, then zlib
        data = data[data.index(b"\n") + 1 :]
    names = []
    for line in zlib.decompress(data).decode("utf-8").splitlines():
        m = re.match(r"(\S+) std:doc -?\d+ ", line)
        if m and not SKIP.match(m.group(1)):
            names.append(m.group(1))
    return sorted(set(names))


def doxy_links(html: str) -> set[str]:
    hrefs = (h.split("#")[0] for h in re.findall(r'href="([^"]+)"', html))
    return {h[: -len(".html")] for h in hrefs if DOXY_PAGE.match(h)}


def doxy_seeds(source: str) -> set[str]:
    """Pages linked from the Doxygen index pages (several are 403 on this site; skipped)."""
    base = BASE[source]
    seeds = list(DOXY_SEEDS)
    try:  # the menu lists every member index page (functions_*.html)
        js = fetch(base + "menudata.js").decode("utf-8")
        seeds += sorted({u.split("#")[0][: -len(".html")] for u in re.findall(r'url:"([^"]+)"', js)})
    except Exception as e:
        print(f"  no menudata.js for {source}: {e}", file=sys.stderr)
    names = {"index"}
    for s in dict.fromkeys(seeds):
        try:
            names |= doxy_links(fetch(base + s + ".html").decode("utf-8"))
        except urllib.error.HTTPError:
            pass
        time.sleep(0.1)
    return names


def to_markdown(node, base: str) -> str:
    for tag in node.select("a.headerlink, script, style, nav, div.toc, div.dynheader, div.dyncontent"):
        tag.decompose()
    # Doxygen: drop the "◆" permalinks and the empty spacer rows of member tables.
    for tag in node.select("span.permalink, tr[class^=separator], tr.memdesc td:empty"):
        tag.decompose()
    for a in node.select("a"):  # "More..." jumps to the detail section further down the same page
        if a.get_text(strip=True) == "More...":
            a.decompose()
    # Doxygen signature tables (one cell per token) read better as one code line.
    for table in node.select("table.memname"):
        sig = " ".join(table.get_text(" ", strip=True).split()).replace(" ,", ",").replace("( ", "(").replace(" )", ")")
        code = BeautifulSoup("", "html.parser").new_tag("code")
        code.string = sig
        p = BeautifulSoup("", "html.parser").new_tag("p")
        p.append(code)
        table.replace_with(p)
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
    # Sphinx code blocks: keep the language so fences stay readable.
    for pre in node.select("pre"):
        lang = ""
        div = pre.find_parent("div", class_=re.compile(r"highlight-"))
        if div:
            lang = next((c[len("highlight-"):] for c in div["class"] if c.startswith("highlight-")), "")
        if lang in ("default", "none", "text"):
            lang = ""
        text = pre.get_text()
        new = BeautifulSoup("", "html.parser").new_tag("pre")
        new.string = f"\x00{lang}\x00{text}"
        pre.replace_with(new)
    md = markdownify(str(node), heading_style="ATX", code_language_callback=lambda el: "")
    md = re.sub(
        r"```\n([ \t]*)\x00([\w+-]*)\x00",
        lambda m: f"```{'python' if m.group(2) in ('python3', 'py') else m.group(2)}\n{m.group(1)}",
        md,
    )
    md = md.replace("\x00", "")
    md = re.sub(r"\n{3,}", "\n\n", md).strip()
    return md


def convert(source: str, name: str) -> tuple[str, str, str, str, set[str]]:
    url = BASE[source] + name + ".html"
    html = fetch(url).decode("utf-8")
    soup = BeautifulSoup(html, "html.parser")
    title = soup.title.get_text(strip=True) if soup.title else name
    links = set()
    if source == "manual":
        title = re.split(r" — Deadline", title)[0].strip()
        node = soup.select_one('div[role="main"]')
    else:
        links = doxy_links(html)
        t = soup.select_one("div.headertitle div.title")
        title = t.get_text(" ", strip=True) if t else title.split(": ", 1)[-1]
        node = soup.select_one("div.contents")
    if node is None:
        return title, url, "", "", links
    md = to_markdown(node, url)
    summary = next((p for p in md.split("\n\n") if len(p) > 40 and p[0] not in "#![|>`*-"), "")
    return title, url, f"# {title}\n\nSource: {url}\n\n{md}\n", " ".join(summary.split())[:240], links


def check_version(version: str) -> None:
    """Exit unless the manual at this URL reports this version; print its patch release."""
    title = BeautifulSoup(fetch(BASE["manual"] + "index.html"), "html.parser").title.get_text()
    m = re.search(r"Deadline (\d+\.\d+)(\.[\d.]+)? documentation", title)
    if not m or m[1] != version:
        sys.exit(f"{BASE['manual']} does not serve Deadline {version} (title: {title!r})")
    print(f"Deadline {m[1]}{m[2] or ''}: {SITE}{version}/", flush=True)


def main() -> None:
    folder = Path(__file__).resolve().parent.parent.name
    m = re.fullmatch(r"deadline-(\d+)-(\d+)", folder)
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--version", default=f"{m[1]}.{m[2]}" if m else None, required=not m, help="Deadline release, e.g. 10.4")
    ap.add_argument("--out", type=Path, default=Path(__file__).resolve().parent.parent / "docs")
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--delay", type=float, default=0.3)
    ap.add_argument("--only", choices=list(FOLDERS))
    args = ap.parse_args()
    for source, sub in FOLDERS.items():
        BASE[source] = f"{SITE}{args.version}/{sub}"
    check_version(args.version)
    sources = [args.only] if args.only else list(FOLDERS)

    def work(job):
        source, name = job
        try:
            title, url, text, summary, links = convert(source, name)
        except Exception as e:  # one bad page must not stop the mirror
            print(f"  failed {source}/{name}: {e}", file=sys.stderr)
            return None, set()
        time.sleep(args.delay)
        if not text:
            print(f"  no body {url}", file=sys.stderr)
            return None, links
        rel = f"{source}/{name}.md"
        path = args.out / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
        return (rel, title, summary), links

    jobs = []
    for source in sources:
        names = manual_pages() if source == "manual" else doxy_seeds(source)
        jobs += [(source, n) for n in sorted(names)]
    rows, seen = [], set()
    with ThreadPoolExecutor(args.workers) as pool:
        while jobs:  # Doxygen pages link to classes the indexes miss: crawl in rounds
            print(f"{len(jobs)} pages to fetch", flush=True)
            seen |= set(jobs)
            found = set()
            for job, (row, links) in zip(jobs, pool.map(work, jobs)):
                if row:
                    rows.append(row)
                found |= {(job[0], n) for n in links}
            jobs = sorted(found - seen)

    index = args.out / "index.tsv"
    keep = []
    if args.only and index.exists():  # partial run: keep the other sources' rows
        keep = [l for l in index.read_text(encoding="utf-8").splitlines()[1:] if not l.startswith(args.only + "/")]
    lines = keep + [f"{rel}\t{title}\t{summary}" for rel, title, summary in rows]
    index.write_text("file\ttitle\tsummary\n" + "\n".join(sorted(lines)) + "\n", encoding="utf-8")
    print(f"done: {len(rows)} of {len(seen)} pages written, {len(lines)} indexed")


if __name__ == "__main__":
    main()
