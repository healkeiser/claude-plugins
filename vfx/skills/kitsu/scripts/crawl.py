# /// script
# requires-python = ">=3.10"
# dependencies = ["beautifulsoup4", "markdownify"]
# ///
"""Mirror the Kitsu developer docs and the Zou REST API reference to local Markdown.

Sources:
  dev  https://dev.kitsu.cloud/                  VitePress site; page list from the sidebar in
                                                 __VP_SITE_DATA__, plus internal links found while crawling
  api  https://api-docs.kitsu.cloud/source.json  Zou OpenAPI spec; one page per tag + schemas.md

The Kitsu docs are not versioned: they track the current release. The crawl records what that was
(Zou API version from the spec, latest gazu and zou on PyPI, crawl date) in docs/VERSIONS.md and in
the first line of docs/index.tsv.

Every run fetches everything again (about a hundred requests, a minute or two) and rewrites docs/.

    uv run scripts/crawl.py [--out DIR] [--workers 3] [--delay 0.3] [--only dev|api]
"""

import argparse
import datetime
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from bs4 import BeautifulSoup
from markdownify import markdownify

DEV = "https://dev.kitsu.cloud/"
API_SPEC = "https://api-docs.kitsu.cloud/source.json"
API_SITE = "https://api-docs.kitsu.cloud/"
UA = "Mozilla/5.0 (kitsu skill docs mirror; personal offline reference)"
METHODS = ("get", "post", "put", "patch", "delete")


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


def summarize(md: str) -> str:
    para = next((p for p in md.split("\n\n") if len(p) > 40 and p[0] not in "#![|>`*-" and not p.startswith("Source:")), "")
    return " ".join(para.split())[:240]


# ---------------------------------------------------------------- dev.kitsu.cloud


def page_path(href: str, base: str = DEV) -> str | None:
    """'/guides/async#x' -> 'guides/async'; None for external links and assets."""
    url = urllib.parse.urljoin(base, href)
    if not url.startswith(DEV):
        return None
    path = urllib.parse.urlsplit(url).path.strip("/")
    path = path.removesuffix(".html")
    if re.search(r"\.\w{2,4}$", path):  # images, pdfs, zips
        return None
    return path or "index"


def dev_pages() -> list[str]:
    html = fetch(DEV).decode("utf-8")
    m = re.search(r'__VP_SITE_DATA__\s*=\s*JSON\.parse\((".*?")\)', html, re.S)
    site = json.loads(json.loads(m.group(1)))
    links: list[str] = []

    def walk(x):
        if isinstance(x, dict):
            if isinstance(x.get("link"), str):
                links.append(x["link"])
            for v in x.values():
                walk(v)
        elif isinstance(x, list):
            for v in x:
                walk(v)

    walk(site["themeConfig"]["sidebar"])
    return sorted({p for p in map(page_path, links) if p})


def dev_markdown(node, url: str) -> str:
    for tag in node.select("a.header-anchor, button.copy, span.lang, .vp-code-group .tabs, .cta, script, style"):
        tag.decompose()
    for a in node.select("a[href]"):
        a["href"] = urllib.parse.urljoin(url, a["href"])
    for img in node.select("img"):
        alt = img.get("alt") or ""
        img.replace_with(f"[image: {alt}]" if alt else "")
    # Headings as plain text: gazu signatures are <h3><strong><code>, which would come out as **`...`**.
    for h in node.select("h1, h2, h3, h4, h5, h6"):
        h.string = h.get_text(" ", strip=True).replace("​", "").strip()
    # VitePress code: <div class="language-py"><pre><code><span class="line">...
    for div in node.select('div[class*="language-"]'):
        lang = next((c[len("language-"):] for c in div["class"] if c.startswith("language-")), "")
        lang = {"py": "python", "sh": "bash", "shell": "bash", "js": "javascript", "ts": "typescript"}.get(lang, lang)
        pre = div.find("pre")
        if pre is None:
            continue
        new = BeautifulSoup("", "html.parser").new_tag("pre")
        new.string = f"\x00{lang}\x00{pre.get_text()}"
        div.replace_with(new)
    md = markdownify(str(node), heading_style="ATX", escape_underscores=False, escape_asterisks=False, code_language_callback=lambda el: "")
    md = re.sub(r"```\n([ \t]*)\x00([\w+-]*)\x00", lambda m: f"```{m.group(2)}\n{m.group(1)}", md)
    md = md.replace("\x00", "").replace("​", "")
    return re.sub(r"\n{3,}", "\n\n", md).strip()


def dev_convert(path: str) -> tuple[str, str, set[str]]:
    """Return (title, markdown page, internal page paths linked from it)."""
    url = DEV + ("" if path == "index" else path)
    soup = BeautifulSoup(fetch(url + ("" if path == "index" else ".html")), "html.parser")
    title = soup.title.get_text(strip=True).removesuffix(" | Kitsu Developer") if soup.title else path
    node = soup.select_one(".vp-doc") or soup.select_one("main")
    if node is None:
        return title, "", set()
    links = {p for a in node.select("a[href]") if (p := page_path(a["href"], url))}
    md = dev_markdown(node, url)
    if not md:
        return title, "", links
    if not md.startswith("# "):
        h2 = re.match(r"## (.+)", md)  # pages without an h1 get the bare site name as <title>
        md = f"# {h2[1] if h2 and title == 'Kitsu Developer' else title}\n\n{md}"
    first, _, rest = md.partition("\n")
    title = first[2:].strip() or title
    return title, f"# {title}\n\nSource: {url}\n\n{rest.strip()}\n", links


def crawl_dev(out: Path, workers: int, delay: float) -> list[tuple[str, str, str]]:
    queue = dev_pages()
    seen = set(queue)
    rows = []

    def work(path):
        try:
            title, text, links = dev_convert(path)
        except Exception as e:  # one bad page must not stop the mirror
            print(f"  failed dev/{path}: {e}", file=sys.stderr)
            return None, set()
        time.sleep(delay)
        if not text:
            print(f"  no body dev/{path}", file=sys.stderr)
            return None, links
        rel = f"dev/{path}.md"
        (out / rel).parent.mkdir(parents=True, exist_ok=True)
        (out / rel).write_text(text, encoding="utf-8")
        return (rel, title, summarize(text.split("\n\n", 2)[-1])), links

    with ThreadPoolExecutor(workers) as pool:
        while queue:  # waves: sidebar pages first, then pages they link to that the sidebar lacks
            print(f"dev: {len(queue)} pages", flush=True)
            found = set()
            for row, links in pool.map(work, queue):
                if row:
                    rows.append(row)
                found |= links
            queue = sorted(found - seen)
            seen |= found
    return rows


# ---------------------------------------------------------------- Zou OpenAPI spec


def op_anchor(method: str, path: str) -> str:
    """bump.sh operation id, e.g. operation-get-data-tasks-parameter (checked against all 808 ops)."""
    p = re.sub(r"\{[^}]+\}", "parameter", path.lower())
    return f"operation-{method}-" + re.sub(r"[^a-z0-9_]+", "-", p).strip("-")


def tag_slug(tag: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", tag.lower()).strip("-")


def typ(s: dict) -> str:
    if not s:
        return ""
    if "$ref" in s:
        return s["$ref"].rsplit("/", 1)[-1]
    for k in ("oneOf", "anyOf", "allOf"):
        if k in s:
            return (" & " if k == "allOf" else " | ").join(typ(x) for x in s[k])
    t = s.get("type", "object" if "properties" in s else "")
    if t == "array":
        t = f"array of {typ(s.get('items', {})) or 'any'}"
    if s.get("format"):
        t += f" ({s['format']})"
    if s.get("enum"):
        t += " one of " + ", ".join(f"`{v}`" for v in s["enum"])
    if "default" in s:
        t += f", default `{json.dumps(s['default'])}`"
    return t


def one_line(text) -> str:
    return " ".join(str(text or "").split())


def fields(schema: dict, schemas: dict, indent: str = "") -> list[str]:
    """One-level field list of an object schema; a $ref is named and its fields listed."""
    lines = []
    if "$ref" in schema:
        name = typ(schema)
        lines.append(f"{indent}Schema `{name}` (see schemas.md#{name.lower()})")
        schema = schemas.get(name, {})
    if schema.get("type") == "array" and isinstance(schema.get("items"), dict):
        lines.append(f"{indent}Array of {typ(schema['items']) or 'objects'}")
        items = schema["items"]
        if "$ref" not in items:
            schema = items
    req = set(schema.get("required", []))
    for name, p in (schema.get("properties") or {}).items():
        flag = ", required" if name in req else ""
        desc = one_line(p.get("description"))
        ex = f" (example `{json.dumps(p['example'])}`)" if "example" in p and len(json.dumps(p["example"])) < 80 else ""
        lines.append(f"{indent}- `{name}` ({typ(p)}{flag}){': ' + desc if desc else ''}{ex}")
    return lines


def operation_md(method: str, path: str, op: dict, path_params: list, schemas: dict) -> str:
    out = [f"## {method.upper()} {path}", ""]
    if op.get("summary"):
        out += [f"**{one_line(op['summary'])}**", ""]
    if op.get("description"):
        out += [op["description"].strip(), ""]
    if op.get("deprecated"):
        out += ["Deprecated.", ""]
    if op.get("security") == []:
        out += ["Authentication: none.", ""]
    out += [f"Docs: {API_SITE}operation/{op_anchor(method, path)}", ""]
    params = {(p.get("in"), p.get("name")): p for p in path_params}
    params.update({(p.get("in"), p.get("name")): p for p in op.get("parameters", [])})
    if params:
        out += ["Parameters:", "", "| name | in | type | required | description |", "|---|---|---|---|---|"]
        for p in params.values():
            desc = one_line(p.get("description")).replace("|", "\\|")
            if "example" in p:
                desc += f" (example `{p['example']}`)"
            t = typ(p.get("schema", {})).replace("|", "\\|")
            out.append(f"| `{p.get('name')}` | {p.get('in')} | {t} | {'yes' if p.get('required') else 'no'} | {desc} |")
        out.append("")
    body = op.get("requestBody")
    if body:
        for ctype, c in body.get("content", {}).items():
            out += [f"Request body ({ctype}{', required' if body.get('required') else ''}):", ""]
            out += fields(c.get("schema", {}), schemas) or [typ(c.get("schema", {})) or "(no schema)"]
            out.append("")
    out += ["Responses:", ""]
    for code, r in op.get("responses", {}).items():
        out.append(f"- `{code}`: {one_line(r.get('description'))}")
        for ctype, c in (r.get("content") or {}).items():
            if ctype != "application/json":
                out.append(f"  - `{ctype}`")
                continue
            sub = fields(c.get("schema", {}), schemas, "  ")
            if sub:
                out += sub
    out.append("")
    return "\n".join(out)


def crawl_api(out: Path) -> tuple[list[tuple[str, str, str]], str]:
    spec = json.loads(fetch(API_SPEC))
    schemas = spec.get("components", {}).get("schemas", {})
    tag_desc = {t["name"]: t.get("description", "") for t in spec.get("tags", [])}
    by_tag: dict[str, list[str]] = {}
    for path, item in spec["paths"].items():
        for method in METHODS:
            op = item.get(method)
            if op is None:
                continue
            md = operation_md(method, path, op, item.get("parameters", []), schemas)
            for tag in op.get("tags") or ["Untagged"]:
                by_tag.setdefault(tag, []).append(md)
    (out / "api").mkdir(parents=True, exist_ok=True)
    rows = []
    servers = ", ".join(s["url"] for s in spec.get("servers", []))
    for tag, ops in sorted(by_tag.items()):
        url = f"{API_SITE}group/endpoint-{tag_slug(tag)}"
        title = f"Zou REST API: {tag}"
        intro = f"{tag_desc.get(tag, '')} {len(ops)} operations.".strip()
        prefix = f"Paths are relative to the API root (server URL `{servers}`, i.e. `https://<kitsu-host>{servers}`)." if servers else ""
        text = f"# {title}\n\nSource: {url}\n\n{intro}\n\n{prefix}\n\n" + "\n".join(ops)
        rel = f"api/{tag_slug(tag)}.md"
        (out / rel).write_text(text, encoding="utf-8")
        first = one_line(tag_desc.get(tag, "").strip().split("\n")[0])
        rows.append((rel, title, f"{first} {len(ops)} operations. Paths: " +", ".join(sorted({o.split(chr(10))[0][3:] for o in ops}))[:180]))
    lines = ["# Zou REST API: schemas", "", f"Source: {API_SITE}", "",
             "Data model schemas from components/schemas of the OpenAPI spec.", ""]
    for name, s in sorted(schemas.items()):
        lines += [f"## {name}", ""]
        if s.get("description"):
            lines += [one_line(s["description"]), ""]
        lines += fields(s, schemas) + [""]
    (out / "api/schemas.md").write_text("\n".join(lines), encoding="utf-8")
    rows.append(("api/schemas.md", "Zou REST API: schemas", "Data model schemas: " + ", ".join(sorted(schemas))[:220]))
    info = spec.get("info", {})
    overview = markdownify(info.get("description", ""), heading_style="ATX", escape_underscores=False).strip()
    (out / "api/overview.md").write_text(
        f"# Zou REST API: overview\n\nSource: {API_SITE}\n\nOpenAPI {spec.get('openapi')}, API version {info.get('version')}. "
        f"Server URL: `{servers}`. Security schemes:\n\n"
        + "\n".join(f"- {k}: {one_line(v.get('description'))}" for k, v in spec.get("components", {}).get("securitySchemes", {}).items())
        + f"\n\n{overview}\n",
        encoding="utf-8",
    )
    rows.append(("api/overview.md", "Zou REST API: overview", "API intro, authentication (JWT bearer token), server URL and version."))
    n_ops = sum(len(v) for v in by_tag.values())
    print(f"api: {len(spec['paths'])} paths, {n_ops} operation entries, {len(by_tag)} tags, {len(schemas)} schemas", flush=True)
    return rows, info.get("version", "?")


# ---------------------------------------------------------------- versions + index


def pypi_version(name: str) -> str:
    try:
        return json.loads(fetch(f"https://pypi.org/pypi/{name}/json"))["info"]["version"]
    except Exception as e:
        print(f"  failed pypi {name}: {e}", file=sys.stderr)
        return "?"


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", type=Path, default=Path(__file__).resolve().parent.parent / "docs")
    ap.add_argument("--workers", type=int, default=3)
    ap.add_argument("--delay", type=float, default=0.3)
    ap.add_argument("--only", choices=["dev", "api"])
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)

    rows = []
    api_version = None
    if args.only in (None, "dev"):
        rows += crawl_dev(args.out, args.workers, args.delay)
    if args.only in (None, "api"):
        try:
            api_rows, api_version = crawl_api(args.out)
            rows += api_rows
        except Exception as e:
            print(f"  failed api: {e}", file=sys.stderr)

    versions = args.out / "VERSIONS.md"
    old = versions.read_text(encoding="utf-8") if versions.exists() else ""
    if api_version is None:  # dev-only run: keep the recorded API version
        m = re.search(r"Zou REST API \(OpenAPI info\.version\): (\S+)", old)
        api_version = m.group(1) if m else "?"
    gazu, zou = pypi_version("gazu"), pypi_version("zou")
    today = datetime.date.today().isoformat()
    versions.write_text(
        "# Kitsu docs mirror: versions\n\n"
        "The Kitsu docs are unversioned and describe the current release. At crawl time that was:\n\n"
        f"- Crawl date: {today}\n"
        f"- Zou REST API (OpenAPI info.version): {api_version}\n"
        f"- Latest gazu on PyPI: {gazu}\n"
        f"- Latest zou on PyPI: {zou}\n\n"
        f"Sources: {DEV} and {API_SPEC}\n",
        encoding="utf-8",
    )

    index = args.out / "index.tsv"
    keep = []
    if args.only and index.exists():  # partial run: keep the other source's rows
        keep = [l for l in index.read_text(encoding="utf-8").splitlines()[2:] if not l.startswith(args.only + "/")]
    lines = keep + [f"{rel}\t{one_line(title)}\t{one_line(summary)}" for rel, title, summary in rows]
    header = f"# kitsu docs crawled {today}; Zou API {api_version}; gazu {gazu}; zou {zou}\nfile\ttitle\tsummary\n"
    index.write_text(header + "\n".join(sorted(lines)) + "\n", encoding="utf-8")
    print(f"done: {len(rows)} pages written, {len(lines)} indexed; Zou API {api_version}, gazu {gazu}, zou {zou}")


if __name__ == "__main__":
    main()
