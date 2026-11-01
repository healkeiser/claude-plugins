# /// script
# requires-python = ">=3.10"
# dependencies = ["beautifulsoup4", "markdownify"]
# ///
"""Mirror the Blender user manual, Python API reference and developer docs to local Markdown.

Sources:
  manual  https://docs.blender.org/manual/en/<version>/   page list from Sphinx objects.inv (std:doc)
  api     https://docs.blender.org/api/<version>/         page list from Sphinx objects.inv (std:doc)
  dev     https://developer.blender.org/docs/             page list from sitemap.xml (unversioned)

The Blender version comes from the skill folder name (blender-5-2 -> 5.2), or --version.
URLs are always pinned to that version, never latest/current. The crawl stops if the manual
or API docs report another version, so a refresh never silently moves on.

Resumable: pages already in docs/manifest.jsonl are not fetched again (--refresh refetches
them). docs/index.tsv is rebuilt from the manifest at the end of every run.

    uv run scripts/crawl.py [--version 5.2] [--out DIR] [--workers 4] [--delay 0.3]
                            [--only manual|api|dev] [--refresh] [--limit N]
"""

import argparse
import html
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

MANUAL = API = ""  # set by resolve_version() before any fetch
DEV = "https://developer.blender.org/docs/"
UA = "Mozilla/5.0 (blender-5-2 skill docs mirror; personal offline reference)"
# Index/search stubs with no reference value.
SKIP = re.compile(r"^(genindex|search|py-modindex)$")


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


def sphinx_pages(base: str) -> list[str]:
    """Doc names from the Sphinx inventory: every page the toctree builds."""
    data = fetch(base + "objects.inv")
    for _ in range(4):  # four plain-text header lines, then zlib
        data = data[data.index(b"\n") + 1 :]
    names = []
    for line in zlib.decompress(data).decode("utf-8").splitlines():
        m = re.match(r"(\S+) std:doc -?\d+ ", line)
        if m and not SKIP.match(m.group(1)):
            names.append(m.group(1))
    return sorted(set(names))


def dev_pages() -> list[str]:
    """Paths under /docs/ from the MkDocs sitemap ('' is the landing page)."""
    xml = fetch(DEV + "sitemap.xml").decode("utf-8")
    return sorted({u.removeprefix(DEV) for u in re.findall(r"<loc>([^<]+)</loc>", xml) if u.startswith(DEV)})


def fence_lang(lang: str) -> str:
    return {"python3": "python", "py": "python", "default": "python", "none": "", "text": ""}.get(lang, lang)


def to_markdown(node, base: str) -> str:
    # Furo and MkDocs Material chrome that can sit inside the article.
    for tag in node.select(
        "a.headerlink, script, style, nav, .md-content__button, .md-source-file, form, button, .toc-drawer"
    ):
        tag.decompose()
    # MkDocs content tabs: put each tab's label above its block instead of one run-together label row.
    for tabs in node.select("div.tabbed-set"):
        labels = [l.get_text(" ", strip=True) for l in tabs.select(":scope > .tabbed-labels > label")]
        blocks = tabs.select(":scope > .tabbed-content > .tabbed-block")
        if labels and len(labels) == len(blocks):
            new = BeautifulSoup("", "html.parser").new_tag("div")
            for label, block in zip(labels, blocks):
                p = BeautifulSoup("", "html.parser").new_tag("p")
                strong = BeautifulSoup("", "html.parser").new_tag("strong")
                strong.string = label
                p.append(strong)
                new.append(p)
                new.append(block)
            tabs.replace_with(new)
    # Sphinx hlist (Inherited Properties, References) is a layout table: markdownify would put
    # hundreds of items on one table row, so keep only its lists.
    for table in node.select("table.hlist"):
        div = BeautifulSoup("", "html.parser").new_tag("div")
        for ul in table.select("td > ul"):
            div.append(ul)
        table.replace_with(div)
    # Sphinx signatures as one code span: bpy.ops.mesh.foo(*, a=1) instead of nested emphasis.
    for dt in node.select("dt.sig"):
        code = BeautifulSoup("", "html.parser").new_tag("code")
        code.string = " ".join(dt.get_text().split())
        dt.clear()
        dt.append(code)
    # Absolute links so the user can open them, and grep finds cross-references by URL.
    for a in node.select("a[href]"):
        a["href"] = urllib.parse.urljoin(base, a["href"])
        a.attrs.pop("title", None)
    for img in node.select("img"):
        alt = img.get("alt") or ""
        img.replace_with(f"[image: {alt}]" if alt else "")
    # Code blocks: keep the language (Sphinx div.highlight-<lang>, MkDocs div.language-<lang>).
    for pre in node.select("pre"):
        lang = ""
        div = pre.find_parent("div", class_=re.compile(r"^(highlight-|language-)"))
        if div:
            lang = next((re.sub(r"^(highlight|language)-", "", c) for c in div["class"]
                         if c.startswith(("highlight-", "language-"))), "")
        code = pre.find("code")
        if code and not lang:
            lang = next((c[len("language-"):] for c in code.get("class", []) if c.startswith("language-")), "")
        for ln in pre.select(".linenos, .linenodiv"):  # line-number gutters
            ln.decompose()
        new = BeautifulSoup("", "html.parser").new_tag("pre")
        new.string = f"\x00{lang}\x00{pre.get_text()}"
        table = pre.find_parent("table", class_="highlighttable")
        (table or pre).replace_with(new)
    # No escaping: API names like active_material must stay greppable.
    md = markdownify(str(node), heading_style="ATX", code_language_callback=lambda el: "",
                     escape_underscores=False, escape_asterisks=False)
    # markdownify fences our placeholder; rewrite to ```lang
    md = re.sub(r"```\n([ \t]*)\x00([\w+-]*)\x00", lambda m: f"```{fence_lang(m.group(2))}\n{m.group(1)}", md)
    md = md.replace("\x00", "")
    # Sphinx renders each token of a parameter type as its own <em>: *Sequence**[**float**]* -> *Sequence[float]*
    md = re.sub(r"\*\*(?=[\[\]])|(?<=[\[\]])\*\*", "", md)
    md = md.replace("**,* *", ", ").replace("* *|* *", " | ")
    md = re.sub(r"\n{3,}", "\n\n", md).strip()
    return md


def convert(source: str, name: str, version: str) -> tuple[str, str, str, str, str]:
    if source == "dev":
        url, sel = DEV + name, "article.md-content__inner"
        rel = f"dev/{name}index.md" if name.endswith("/") or not name else f"dev/{name}.md"
    else:
        url = (MANUAL if source == "manual" else API) + name + ".html"
        sel, rel = "article#furo-main-content", f"{source}/{name}.md"
    page = fetch(url).decode("utf-8")
    m = re.search(r"<title>(.*?)</title>", page, re.S)
    title = html.unescape(m.group(1).strip()) if m else name
    # Parse only the article: the nav sidebar is most of each 450 KB page and parsing it dominates the crawl.
    start, end = page.find("<article"), page.rfind("</article>")
    soup = BeautifulSoup(page[start : end + 10] if start >= 0 and end > start else page, "html.parser")
    if source == "manual" and f"Blender {version}" not in title:
        raise RuntimeError(f"not a {version} page (title: {title!r})")
    title = re.sub(r"\s+[-—]\s+Blender (\d[\d.]*( LTS)? Manual|Python API|Developer Documentation)$", "", title)
    node = soup.select_one(sel)
    if node is None:
        return rel, title, url, "", ""
    md = to_markdown(node, url)  # also drops headerlink anchors from the h1
    h1 = node.find("h1")
    if source == "dev" and h1:  # <title> is the nav label ("Python API"); h1 says which release
        title = h1.get_text(" ", strip=True)
    summary = next((p for p in md.split("\n\n") if len(p) > 40 and p[0] not in "#![|>`*-:"), "")
    summary = " ".join(summary.split())[:240]
    return rel, title, url, f"# {title}\n\nSource: {url}\n\n{md}\n", summary


def resolve_version(version: str) -> None:
    """Point MANUAL/API at the docs for exactly this version, or exit."""
    global MANUAL, API
    MANUAL = f"https://docs.blender.org/manual/en/{version}/"
    API = f"https://docs.blender.org/api/{version}/"
    for base in (MANUAL, API):
        try:
            js = fetch(base + "_static/documentation_options.js").decode("utf-8")
        except urllib.error.HTTPError as e:
            sys.exit(f"{base} is not online ({e.code}); is Blender {version} documented yet?")
        m = re.search(r"VERSION:\s*'([^']*)'", js)
        if not m or m.group(1) != version:
            sys.exit(f"{base} reports version {m.group(1) if m else '?'}, not {version}")
    title = BeautifulSoup(fetch(MANUAL + "index.html"), "html.parser").title.get_text()
    if f"Blender {version}" not in title:
        sys.exit(f"{MANUAL} does not serve {version} (title: {title!r})")
    print(f"Blender {version}: {MANUAL} | {API}", flush=True)


def main() -> None:
    folder = Path(__file__).resolve().parent.parent.name
    m = re.fullmatch(r"blender-(\d+)-(\d+)", folder)
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--version", default=f"{m[1]}.{m[2]}" if m else None, required=not m, help="Blender release, e.g. 5.2")
    ap.add_argument("--out", type=Path, default=Path(__file__).resolve().parent.parent / "docs")
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--delay", type=float, default=0.3, help="seconds each worker waits between requests")
    ap.add_argument("--only", choices=["manual", "api", "dev"])
    ap.add_argument("--refresh", action="store_true", help="refetch pages already in the manifest")
    ap.add_argument("--limit", type=int, default=0, help="fetch at most N new pages (0: no limit)")
    args = ap.parse_args()
    resolve_version(args.version)

    args.out.mkdir(parents=True, exist_ok=True)
    manifest = args.out / "manifest.jsonl"
    done: dict[str, dict] = {}
    if manifest.exists():
        for line in manifest.read_text(encoding="utf-8").splitlines():
            e = json.loads(line)
            done[e["file"]] = e
    if args.refresh:  # forget the sources being refetched, keep the others
        done = {k: v for k, v in done.items() if args.only and v["source"] != args.only}
        manifest.write_text("".join(json.dumps(e) + "\n" for e in done.values()), encoding="utf-8")
    done_keys = {(e["source"], e["name"]) for e in done.values()}

    jobs = []
    if args.only in (None, "manual"):
        jobs += [("manual", n) for n in sphinx_pages(MANUAL)]
    if args.only in (None, "api"):
        jobs += [("api", n) for n in sphinx_pages(API)]
    if args.only in (None, "dev"):
        jobs += [("dev", n) for n in dev_pages()]
    todo = [j for j in jobs if j not in done_keys]
    if args.limit:
        todo = todo[: args.limit]
    print(f"{len(jobs)} pages listed, {len(todo)} to fetch", flush=True)

    lock = threading.Lock()
    count = failed = 0

    def work(job):
        nonlocal count, failed
        source, name = job
        try:
            rel, title, url, text, summary = convert(source, name, args.version)
            if not text:
                raise RuntimeError("no article body")
        except Exception as e:  # one bad page must not stop the mirror
            print(f"  failed {source}/{name}: {e}", file=sys.stderr)
            with lock:
                failed += 1
            return
        path = args.out / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
        entry = {"file": rel, "source": source, "name": name, "title": title, "summary": summary, "url": url}
        with lock:
            with manifest.open("a", encoding="utf-8") as f:
                f.write(json.dumps(entry) + "\n")
            done[rel] = entry
            count += 1
            if count % 250 == 0:
                print(f"{count} of {len(todo)} pages", flush=True)
        time.sleep(args.delay)

    with ThreadPoolExecutor(args.workers) as pool:
        list(pool.map(work, todo))

    rows = sorted(done.values(), key=lambda e: e["file"])
    with (args.out / "index.tsv").open("w", encoding="utf-8") as f:
        f.write("file\ttitle\tsummary\n")
        for e in rows:
            f.write(f"{e['file']}\t{e['title']}\t{e['summary']}\n")
    print(f"done: {count} written, {failed} failed, {len(rows)} indexed")


if __name__ == "__main__":
    main()
