# /// script
# requires-python = ">=3.10"
# dependencies = ["beautifulsoup4", "markdownify"]
# ///
"""Mirror the Unreal Engine 5.8 documentation to local Markdown.

Walks content links breadth-first from the 5.8 landing page (the sidebar tree is
loaded by JavaScript, so it is not in the HTML). Resumable: pages already in
manifest.jsonl are not fetched again, their links re-seed the frontier.

    uv run scripts/crawl.py [--out DIR] [--workers 3] [--delay 0.5] [--limit N] [--refresh]
"""

import argparse
from html import escape as html_escape
import json
import re
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

BASE = "https://dev.epicgames.com/documentation/unreal-engine/"
ROOT = "unreal-engine-5-8-documentation"
# API references are tens of thousands of generated stubs; the engine source answers those better.
SKIP = re.compile(r"^(api|blueprintapi|pythonapi|node-reference|BlueprintAPI|API|PythonAPI)(/|$)", re.I)
UA = "Mozilla/5.0 (unreal-5-8 docs mirror; personal offline reference)"


def slug_of(href: str) -> str | None:
    url = urllib.parse.urljoin(BASE, href)
    parts = urllib.parse.urlsplit(url)
    if parts.netloc != "dev.epicgames.com" or not parts.path.startswith("/documentation/unreal-engine/"):
        return None
    slug = parts.path[len("/documentation/unreal-engine/") :].strip("/")
    if not slug or SKIP.match(slug):
        return None
    return slug


def fetch(slug: str) -> str:
    req = urllib.request.Request(BASE + slug, headers={"User-Agent": UA, "Accept-Language": "en-US"})
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                html = r.read().decode("utf-8", "replace")
            if "cf_challenge" in html:
                raise urllib.error.HTTPError(req.full_url, 429, "Cloudflare challenge", None, None)
            return html
        except urllib.error.HTTPError as e:
            if e.code == 404:
                raise
            wait = 30 * (attempt + 1)
        except (urllib.error.URLError, TimeoutError):
            wait = 10 * (attempt + 1)
        print(f"  retry {slug} in {wait}s", file=sys.stderr)
        time.sleep(wait)
    raise RuntimeError(f"gave up on {slug}")


unknown_blocks: set[str] = set()


def blocks_html(blocks: list) -> str:
    """Render the page's structured blocks to HTML (some pages are only rendered by JavaScript)."""
    out = []
    for b in blocks or []:
        t = b.get("type", "")
        if (b.get("settings") or {}).get("is_hidden"):
            continue
        if t == "header":
            n = min(int(b.get("level") or 2), 6)
            out.append(f"<h{n}>{b.get('content', '')}</h{n}>")
        elif t in ("paragraph", "enhanced_table_cell", "enhanced_table_header"):
            out.append(f"<p>{b.get('content', '')}</p>")
        elif t == "markdown":
            out.append(b.get("content_html", ""))
        elif t == "image":
            alt = b.get("alt_text") or b.get("caption") or ""
            out.append(f"<p><em>[image: {alt}]</em></p>" if alt else "")
            if b.get("caption") and b.get("caption") != alt:
                out.append(f"<p><em>{b['caption']}</em></p>")
        elif t == "callout":
            out.append(f"<blockquote><p><b>{(b.get('callout_type') or 'note').title()}:</b></p>{blocks_html(b.get('blocks'))}</blockquote>")
        elif t == "enhanced_list":
            tag = "ol" if b.get("style") == "ordered" else "ul"
            items = "".join(f"<li>{blocks_html(item)}</li>" for item in b.get("items") or [])
            out.append(f"<{tag}>{items}</{tag}>")
        elif t == "enhanced_table":
            rows = []
            for r in b.get("rows") or []:
                cells = []
                for cell in r:
                    tag = "th" if cell and cell[0].get("type") == "enhanced_table_header" else "td"
                    text = " ".join(BeautifulSoup(blocks_html(cell), "html.parser").get_text(" ", strip=True).split())
                    cells.append(f"<{tag}>{text}</{tag}>")
                rows.append(f"<tr>{''.join(cells)}</tr>")
            out.append(f"<table>{''.join(rows)}</table>")
        elif t == "code_snippet":
            # Only the preview is in the page; the full snippet sits behind a signed API URL.
            code = b.get("code_preview") or ""
            shown = code.count("\n") + 1
            note = f"<p><em>(first {shown} of {b['lines_of_code']} lines)</em></p>" if (b.get("lines_of_code") or 0) > shown else ""
            out.append(f"<pre><code>{html_escape(code)}</code></pre>{note}")
        elif t == "document_list":
            out.append(f"<ul>{doc_items(b.get('items'))}</ul>")
        elif t == "include":
            out.append(blocks_html(b.get("blocks")))
        elif t == "switch":
            for name, sub in (b.get("switchable_blocks") or {}).items():
                out.append(f"<p><b>{name.replace('_', ' ').title()}:</b></p>{blocks_html(sub)}")
        elif t in ("video", "external_video", "comparison_slider", "sequence_slider"):
            continue
        else:
            unknown_blocks.add(t)
            if isinstance(b.get("content"), str):
                out.append(f"<p>{b['content']}</p>")
            if isinstance(b.get("content_html"), str):
                out.append(b["content_html"])
            if isinstance(b.get("blocks"), list):
                out.append(blocks_html(b["blocks"]))
    return "\n".join(out)


def doc_items(items: list) -> str:
    """Child-page lists; grouped lists nest their pages under a group title."""
    out = []
    for it in items or []:
        nested = f"<ul>{doc_items(it['items'])}</ul>" if isinstance(it.get("items"), list) else ""
        desc = f": {it['description']}" if it.get("description") else ""
        name = f'<a href="{it["document_url"]}">{it.get("title", "")}</a>' if it.get("document_url") else it.get("title", "")
        out.append(f"<li>{name}{desc}{nested}</li>")
    return "".join(out)


def cards(html: str) -> str:
    """Topic cards (<block-dir-item-md>) become a link list markdownify keeps."""

    def item(m: re.Match) -> str:
        attrs = dict(re.findall(r'([\w-]+)="([^"]*)"', m.group(0)))
        desc = f": {attrs['description']}" if attrs.get("description") else ""
        return f'<li><a href="{attrs.get("href", "")}">{attrs.get("page-name", "")}</a>{desc}</li>'

    return re.sub(r"<block-dir-item-md\b[^>]*>(\s*</block-dir-item-md>)?", item, html)


def convert(slug: str, html: str) -> tuple[dict, str]:
    soup = BeautifulSoup(html, "html.parser")
    state = soup.select_one("#serverApp-state")
    docs = []
    if state and state.string:
        for v in json.loads(state.string).values():
            if isinstance(v, dict) and isinstance(v.get("b"), dict) and "blocks" in v["b"]:
                docs.append(v["b"])
    title = (soup.title.get_text(strip=True) if soup.title else slug).split(" | ")[0]
    # Links from the whole raw page: topic cards only exist inside the state JSON.
    raw = html.replace("\\/", "/")
    links = sorted({s for m in re.finditer(r"documentation/unreal-engine/([\w\-/]+)", raw) if (s := slug_of(m.group(1)))})
    if not docs:
        return {"slug": slug, "title": title, "links": links, "summary": ""}, ""
    doc = docs[0]
    title = doc.get("seo_title") or doc.get("title") or title
    # The page lists every release its text applies to; the oldest is the one it was written for.
    versions = [a["version"] for a in doc.get("applications") or [] if a.get("type") == "unreal_engine" and a.get("version")]
    version = min(versions, key=lambda v: tuple(int(x) for x in v.split(".") if x.isdigit())) if versions else "?"
    md = markdownify(cards(blocks_html(doc["blocks"])), heading_style="ATX", strip=["script", "style"])
    md = re.sub(r"^%[^%\n]+:Topic%$\n?", "", md, flags=re.M)  # card placeholders the JS fills in
    md = re.sub(r"^Copy full snippet$\n?", "", md, flags=re.M)  # code block button label
    md = re.sub(r"\n{3,}", "\n\n", md).strip()
    summary = doc.get("description") or next((p for p in md.split("\n\n") if len(p) > 40 and p[0] not in "#!|>"), "")
    entry = {"slug": slug, "title": title, "links": links, "summary": " ".join(summary.split())[:240], "version": version}
    head = f"# {title}\n\nSource: {BASE}{slug}\nWritten for: UE {version}{'' if version == '5.8' else ', unchanged through 5.8'} (updated {doc.get('updated_at', '?')[:10]})\n\n"
    return entry, head + md + "\n"


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", type=Path, default=Path(__file__).resolve().parent.parent / "docs")
    ap.add_argument("--workers", type=int, default=3)
    ap.add_argument("--delay", type=float, default=0.5, help="seconds each worker waits between requests")
    ap.add_argument("--limit", type=int, default=0, help="stop after N new pages (0: no limit)")
    ap.add_argument("--refresh", action="store_true", help="ignore the manifest and fetch everything again")
    args = ap.parse_args()

    pages = args.out / "pages"
    pages.mkdir(parents=True, exist_ok=True)
    manifest = args.out / "manifest.jsonl"
    done: dict[str, dict] = {}
    if manifest.exists() and not args.refresh:
        for line in manifest.read_text(encoding="utf-8").splitlines():
            e = json.loads(line)
            done[e["slug"]] = e
    elif args.refresh:
        manifest.unlink(missing_ok=True)

    seen = set(done) | {ROOT}
    frontier = [ROOT] if ROOT not in done else []
    for e in done.values():
        for s in e["links"]:
            if s not in seen:
                seen.add(s)
                frontier.append(s)

    lock = threading.Lock()
    new = 0

    def work(slug: str) -> list[str]:
        nonlocal new
        try:
            entry, text = convert(slug, fetch(slug))
        except urllib.error.HTTPError as e:
            print(f"  {e.code} {slug}", file=sys.stderr)
            entry, text = {"slug": slug, "title": "", "links": [], "summary": "", "error": e.code}, ""
        if text:
            (pages / (slug.replace("/", "__") + ".md")).write_text(text, encoding="utf-8")
        with lock:
            with manifest.open("a", encoding="utf-8") as f:
                f.write(json.dumps(entry) + "\n")
            done[slug] = entry
            new += 1
            if new % 50 == 0:
                print(f"{new} new pages, {len(done)} total", flush=True)
        time.sleep(args.delay)
        return entry["links"]

    with ThreadPoolExecutor(args.workers) as pool:
        while frontier and not (args.limit and new >= args.limit):
            batch, frontier = frontier, []
            if args.limit:
                batch = batch[: args.limit - new]
            for links in pool.map(work, batch):
                for s in links:
                    if s not in seen:
                        seen.add(s)
                        frontier.append(s)

    # index.tsv: one line per page, the file the skill greps first.
    rows = sorted((e for e in done.values() if e.get("version")), key=lambda e: e["slug"])
    with (args.out / "index.tsv").open("w", encoding="utf-8") as f:
        f.write("file\ttitle\tversion\tsummary\n")
        for e in rows:
            f.write(f"pages/{e['slug'].replace('/', '__')}.md\t{e['title']}\t{e['version']}\t{e['summary']}\n")
    print(f"done: {new} new, {len(rows)} pages indexed, {len(frontier)} left in frontier")
    if unknown_blocks:
        print(f"block types rendered by fallback: {sorted(unknown_blocks)}")


if __name__ == "__main__":
    main()
