# /// script
# requires-python = ">=3.10"
# dependencies = ["beautifulsoup4", "markdownify"]
# ///
"""Mirror the Houdini 22.0 help and the HDK guide pages to local Markdown.

Sources:
  houdini  the user docs (nodes, VEX, HOM, Solaris, Karma, Copernicus, KineFX, APEX, PDG...),
           rendered by the local Houdini install's own help server (`hhelp serve`), walked
           breadth-first from the index. Source lines point at https://www.sidefx.com/docs/houdini<ver>/.
  hdk      the narrative HDK pages (_h_d_k__*.html, the "Table Of Contents" tree of index.html),
           not the per-class/file/namespace Doxygen reference. Fetched from sidefx.com.

Why not crawl sidefx.com for the user docs: www.sidefx.com/robots.txt disallows every versioned
docs path (/docs/houdini22.0/, /docs/hdk22.0/...) and asks for Crawl-delay 5 elsewhere; several
thousand pages at one per 5 s would take most of a day. The local help server renders the same
wiki sources with the same templates, offline, for exactly the installed version. The HDK is not
shipped with Houdini, so it comes from the unversioned /docs/hdk/ (allowed), one request per 5 s,
after checking that it is the pinned version; it is byte-identical to /docs/hdk22.0/.

The version comes from the skill folder name (houdini-22 -> 22.0), or --version. The crawl exits if
no matching Houdini install is found (--hfs, $HFS, or SideFX's default install location on
Windows, Linux or macOS) or the docs report another version.

Resumable: docs/manifest.jsonl records every page done; a rerun skips them and continues the
frontier. --refresh starts over.

    uv run scripts/crawl.py [--version 22.0] [--hfs DIR] [--only houdini|hdk] [--workers 8] [--refresh]
"""

import argparse
import glob
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from bs4 import BeautifulSoup
from markdownify import markdownify

UA = "Mozilla/5.0 (houdini-22 skill docs mirror; personal offline reference)"
HDK_FETCH = "https://www.sidefx.com/docs/hdk/"
HDK_DELAY = 5.0  # robots.txt Crawl-delay
# Help-server paths with no reference value or that are not pages.
SKIP = re.compile(r"^(images|icons|static|_|search|find|examples/|gallery|licenses|credits|education)", re.I)
ASSET = re.compile(r"\.(png|jpe?g|gif|svg|webp|ico|css|js|json|zip|hip|hipnc|hda|hdanc|otl|bgeo(\.sc)?|usd[ac]?|mp4|webm|pdf|txt|py|woff2?|ttf|xml)$", re.I)


def fetch(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "en-US"})
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                if "html" not in r.headers.get("Content-Type", "html"):
                    raise ValueError(f"not HTML: {r.headers.get('Content-Type')}")
                return r.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            if e.code not in (429, 500, 502, 503, 504):
                raise
            wait = 30 * (attempt + 1)
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            wait = 10 * (attempt + 1)
        print(f"  retry {url} in {wait}s", file=sys.stderr)
        time.sleep(wait)
    raise RuntimeError(f"gave up on {url}")


def find_hfs(version: str, hfs: str | None) -> Path:
    """--hfs, then $HFS, then SideFX's default install locations on Windows, Linux and macOS."""
    defaults = [
        f"C:/Program Files/Side Effects Software/Houdini {version}.*",
        f"/opt/hfs{version}.*",
        f"/Applications/Houdini/Houdini{version}.*/Frameworks/Houdini.framework/Versions/Current/Resources",
    ]
    cands = [hfs] if hfs else [os.environ.get("HFS", "")] + sorted(
        (c for pat in defaults for c in glob.glob(pat)), reverse=True)
    for c in cands:
        # the version check on the docs themselves runs later; here only skip installs of another release
        if c and (Path(c) / "bin").is_dir() and (hfs or f"{version}." in c.replace("\\", "/")):
            return Path(c)
    sys.exit(f"no Houdini {version} install found (pass --hfs or set $HFS)")


def start_help_server(hfs: Path) -> tuple[subprocess.Popen, str]:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    exe = next(p for p in (hfs / "bin" / "hhelp.exe", hfs / "bin" / "hhelp") if p.exists())
    proc = subprocess.Popen([str(exe), "serve", "-h", "127.0.0.1", "-p", str(port), "--bgindex", "false"],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    base = f"http://127.0.0.1:{port}/"
    for _ in range(120):
        try:
            urllib.request.urlopen(base, timeout=5).read()
            return proc, base
        except OSError:
            if proc.poll() is not None:
                sys.exit("hhelp serve exited")
            time.sleep(1)
    proc.kill()
    sys.exit("hhelp serve did not answer")


def norm(path: str) -> str:
    """Help path -> canonical page path ending in .html (the website's spelling)."""
    path = path.lstrip("/")
    if path == "" or path.endswith("/"):
        return path + "index.html"
    return path if path.endswith(".html") else path + ".html"


def code_lang(text: str, default: str) -> str:
    if re.search(r"(^|\n)\s*(import \w|from [\w.]+ import|def \w+\(|class \w+[(:]|>>> )|\bhou\.\w", text):
        return "python"
    if default in ("", "vex") and re.search(r"(^|[\s(=])@\w|\b(int|float|vector[24]?|matrix3?|string|void)\s+@?\w+\s*[=(;\[]", text):
        return "vex"
    return default


def to_markdown(node, page_url: str, rewrite, default_lang: str) -> str:
    for a in node.select("a[href]"):
        a["href"] = rewrite(urllib.parse.urljoin(page_url, a["href"]))
        a.attrs.pop("title", None)  # Doxygen tooltips would triple every link's length
    for img in node.select("img"):
        alt = (img.get("alt") or "").strip()
        img.replace_with(f"[image: {alt}]" if len(alt) > 2 else "")
    # Doxygen code: <div class="fragment"> of <div class="line"> rows.
    for frag in node.select("div.fragment"):
        pre = BeautifulSoup("", "html.parser").new_tag("pre")
        pre.string = "\n".join(l.get_text().rstrip() for l in frag.select("div.line")) or frag.get_text()
        frag.replace_with(pre)
    for pre in node.select("pre"):
        text = pre.get_text().strip("\n")
        new = BeautifulSoup("", "html.parser").new_tag("pre")
        new.string = f"\x00{code_lang(text, default_lang)}\x00{text}"
        pre.replace_with(new)
    md = markdownify(str(node), heading_style="ATX", code_language_callback=lambda el: "")
    md = re.sub(r"```\n([ \t]*)\x00([\w+-]*)\x00", lambda m: f"```{m.group(2)}\n{m.group(1)}", md)
    md = md.replace("\x00", "").replace("\ufffd", "")
    md = re.sub(r"[ \t]+\n", "\n", md)
    md = re.sub(r"\n{3,}", "\n\n", md).strip()
    return md


def summary_of(md: str) -> str:
    p = next((p for p in md.split("\n\n") if len(p) > 30 and p[0] not in "#![|>`*-"), "")
    return " ".join(p.split())[:240]


def convert_houdini(html: str, page_url: str, rewrite) -> tuple[str, str]:
    soup = BeautifulSoup(html, "html.parser")
    main = soup.select_one("main")
    if main is None:
        return "", ""
    h1 = main.select_one("header h1.title")
    # get_text("") keeps "hou." + "Node" together; the subtitle is separated by markup whitespace
    title = " ".join(h1.get_text("").split()) if h1 else (soup.title.get_text(strip=True) if soup.title else "")
    summary = main.select_one("header p.summary")
    lead = " ".join(summary.get_text(" ").split()) if summary else ""
    for tag in main.select("header, div.toc, .video-container, .example-buttons, "
                           "script, style, nav, .headerlink, .sidebar, .interface, form, button"):
        tag.decompose()
    # Page metadata tables (Since, Inheritance, See also...) as "**Label:** value" blocks; drop the page TOC.
    for table in main.select("table.metatable"):
        rows = [str(w.extract()) for w in table.select(".page-warning")]  # deprecation notices live here
        for tr in table.select("tr"):
            label, content = tr.select_one("td.label, th"), tr.select_one("td.content")
            name = label.get_text(" ", strip=True) if label else ""
            if content and name != "On this page":
                rows.append(f"<div><p><strong>{name}:</strong></p>{content.decode_contents()}</div>" if content.find(["ul", "ol"])
                            else f"<p><strong>{name}:</strong> {content.decode_contents().strip()}</p>")
        table.replace_with(BeautifulSoup("".join(rows), "html.parser"))
    # Parameter labels in bold with the internal parm name (the div id); method signatures as headings.
    for label in main.select("div.parameter > p.label"):
        label.name = "p"
        pid = label.parent.get("id")
        inner = label.decode_contents()
        label.clear()
        label.append(BeautifulSoup(f"<strong>{inner}</strong>" + (f" (<code>{pid}</code>)" if pid else ""), "html.parser"))
    for label in main.select("div.method > p.label"):
        label.name = "h4"
    for label in main.select("div.sbs-item > p.label, div.item > p.label"):
        if not label.find("strong"):
            inner = label.decode_contents()
            label.clear()
            label.append(BeautifulSoup(f"<strong>{inner}</strong>", "html.parser"))
    lang = "python" if "/hom/" in page_url else ""
    body = to_markdown(main, page_url, rewrite, lang)
    return title, (f"{lead}\n\n{body}" if lead else body)


def convert_hdk(html: str, page_url: str, rewrite) -> tuple[str, str]:
    soup = BeautifulSoup(html, "html.parser")
    t = soup.select_one("div.headertitle div.title")
    title = t.get_text(" ", strip=True) if t else (soup.title.get_text(strip=True).removeprefix("HDK: ") if soup.title else "")
    node = soup.select_one("div.contents")
    if node is None:
        return title, ""
    for tag in node.select("script, style, div.toc, a.anchor"):
        tag.decompose()
    return title, to_markdown(node, page_url, rewrite, "cpp")


def main() -> None:
    folder = Path(__file__).resolve().parent.parent.name
    m = re.fullmatch(r"houdini-(\d+)(?:-(\d+))?", folder)
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--version", default=f"{m[1]}.{m[2] or 0}" if m else None, required=not m, help="e.g. 22.0")
    ap.add_argument("--hfs", help="Houdini install to serve the help from")
    ap.add_argument("--out", type=Path, default=Path(__file__).resolve().parent.parent / "docs")
    ap.add_argument("--workers", type=int, default=8, help="local help servers to run in parallel")
    ap.add_argument("--only", choices=["houdini", "hdk"])
    ap.add_argument("--limit", type=int, default=0, help="stop after N new pages per source (0: no limit)")
    ap.add_argument("--refresh", action="store_true", help="forget the manifest and fetch everything again")
    args = ap.parse_args()
    ver = args.version
    web = {"houdini": f"https://www.sidefx.com/docs/houdini{ver}/", "hdk": f"https://www.sidefx.com/docs/hdk{ver}/"}

    args.out.mkdir(parents=True, exist_ok=True)
    manifest = args.out / "manifest.jsonl"
    done: dict[tuple[str, str], dict] = {}
    selected = [args.only] if args.only else ["houdini", "hdk"]
    if manifest.exists():
        for line in manifest.read_text(encoding="utf-8").splitlines():
            e = json.loads(line)
            if not (args.refresh and e["source"] in selected):  # --refresh forgets only the sources being crawled
                done[(e["source"], e["path"])] = e
    if args.refresh:
        for src in selected:
            shutil.rmtree(args.out / src, ignore_errors=True)
        manifest.write_text("".join(json.dumps(e) + "\n" for e in done.values()), encoding="utf-8")
    lock = threading.Lock()
    failed: list[str] = []

    def crawl(source: str, bases: list[str], root: str, keep, convert, delay: float) -> None:
        """Breadth-first over in-scope links, one worker per base URL (each a server of the same pages).
        keep(path) says whether a canonical path is a page to mirror."""
        fetch_base = bases[0]  # links and rewrites resolve against this one
        free = list(bases)

        def to_path(url: str) -> str | None:
            if not url.startswith(fetch_base):
                return None
            p = urllib.parse.urlsplit(url[len(fetch_base):]).path
            p = urllib.parse.unquote(p)
            # Wiki markup sometimes leaks into hrefs ("start, end, step", "<<clip = false>>").
            return None if ASSET.search(p) or re.search(r"[\s<>,]", p) else norm(p)

        def rewrite(url: str) -> str:
            # Links into the mirrored site point at the pinned public URL, anchors kept.
            if url.startswith(fetch_base):
                rest = url[len(fetch_base):]
                p, _, frag = rest.partition("#")
                p = p.split("?")[0]
                return web[source] + (norm(p) if not ASSET.search(p) else p) + (f"#{frag}" if frag else "")
            return url

        new = 0

        def work(path: str) -> list[str]:
            nonlocal new
            url = fetch_base + path
            entry = {"source": source, "path": path, "links": []}
            with lock:
                base = free.pop()
            try:
                html = fetch(base + path)
                soup_links = re.findall(r'href=["\']([^"\'#?]+)', html)
                links = sorted({p for h in soup_links if (p := to_path(urllib.parse.urljoin(url, h))) and keep(p)})
                title, md = convert(html, url, rewrite)
                entry["links"] = links
                if md:
                    rel = f"{source}/{path.removesuffix('.html')}.md"
                    dest = args.out / rel
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    dest.write_text(f"# {title}\n\nSource: {web[source]}{path}\n\n{md}\n", encoding="utf-8")
                    entry.update(file=rel, title=title, summary=summary_of(md))
            except Exception as e:  # one bad page must not stop the mirror
                print(f"  failed {source}/{path}: {e}", file=sys.stderr)
                entry["error"] = str(e)[:200]
                failed.append(f"{source}/{path}")
            with lock:
                free.append(base)
                with manifest.open("a", encoding="utf-8") as f:
                    f.write(json.dumps(entry) + "\n")
                done[(source, path)] = entry
                new += 1
                if new % 200 == 0:
                    print(f"  {source}: {new} new pages", flush=True)
            time.sleep(delay)
            return entry["links"]

        seen = {p for s, p in done if s == source} | {root}
        frontier = [] if (source, root) in done else [root]
        for (s, _), e in list(done.items()):
            if s == source:
                for p in e["links"]:
                    if p not in seen:
                        seen.add(p)
                        frontier.append(p)
        with ThreadPoolExecutor(len(bases)) as pool:
            while frontier and not (args.limit and new >= args.limit):
                batch, frontier = frontier, []
                if args.limit:
                    batch = batch[: args.limit - new]
                for links in pool.map(work, batch):
                    for p in links:
                        if p not in seen:
                            seen.add(p)
                            frontier.append(p)
        print(f"{source}: {new} new pages, {len(frontier)} left in frontier", flush=True)
        if not frontier:  # finished: link lists are only needed to resume, and they are most of the manifest
            with lock:
                for (s, _), e in done.items():
                    if s == source:
                        e["links"] = []
                manifest.write_text("".join(json.dumps(e) + "\n" for e in done.values()), encoding="utf-8")

    if args.only in (None, "houdini"):
        hfs = find_hfs(ver, args.hfs)
        # One hhelp server answers one request at a time (~1 s a page), so run one per worker.
        servers = [start_help_server(hfs) for _ in range(args.workers)]
        try:
            bases = [b for _, b in servers]
            title = BeautifulSoup(fetch(bases[0]), "html.parser").title.get_text(strip=True)
            if title != f"Houdini {ver}":
                sys.exit(f"{hfs} serves {title!r}, not Houdini {ver}")
            print(f"houdini: {hfs} help, {len(bases)} servers", flush=True)
            crawl("houdini", bases, "index.html", lambda p: not SKIP.match(p), convert_houdini, 0.0)
        finally:
            for proc, _ in servers:
                proc.kill()

    if args.only in (None, "hdk"):
        changes = fetch(HDK_FETCH + "_h_d_k__changes.html")
        listed = sorted({tuple(map(int, v)) for v in re.findall(r"Houdini (\d+)\.(\d+)", changes)})
        if not listed or listed[-1] != tuple(map(int, ver.split("."))):
            sys.exit(f"{HDK_FETCH} documents HDK up to {listed[-1] if listed else '?'}, not {ver}")
        print(f"hdk: {HDK_FETCH} is {ver}", flush=True)
        crawl("hdk", [HDK_FETCH], "index.html", lambda p: p == "index.html" or p.startswith("_h_d_k__"),
              convert_hdk, HDK_DELAY)

    # index.tsv: one line per page, the file the skill greps first.
    # The help server ignores case, so some pages are linked twice (Unity/ and unity/); keep one row.
    rows = sorted({e["file"].lower(): e for e in done.values() if e.get("file")}.values(), key=lambda e: e["file"])
    with (args.out / "index.tsv").open("w", encoding="utf-8") as f:
        f.write("file\ttitle\tsummary\n")
        for e in rows:
            f.write(f"{e['file']}\t{e['title']}\t{e['summary']}\n")
    print(f"done: {len(rows)} pages indexed, {len(failed)} failed this run")


if __name__ == "__main__":
    main()
