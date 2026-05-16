#!/usr/bin/env python3
"""
Claris Online Help Crawler — downloads a complete language set of the Claris
FileMaker Pro online help (help.claris.com) to a local mirror directory.

Crawls BFS starting from <root>/content/index.html, follows all internal links
to .html pages within the same /content/ scope, and downloads referenced
assets (CSS, JS, images) from /Skins/, /Resources/ and /assets/.

Usage:
    claris_crawler.py --lang=<code> --output=<dir> [--max-workers=N] [--dry-run]

Exit codes:
    0  Success
    1  Invalid arguments
    2  Network/setup error before any download
    3  Crawl completed but with significant errors (>5% pages failed)
"""

import argparse
import json
import os
import re
import sys
import time
import threading
from collections import deque
from concurrent.futures import ThreadPoolExecutor, as_completed
from html import unescape
from urllib.parse import urljoin, urlparse, urlunparse
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError


# -------------------- Configuration --------------------

BASE = 'https://help.claris.com'
USER_AGENT = 'Mozilla/5.0 (compatible; fm-lab-claris-installer/1.0; +https://github.com/anthropics/Codex-code)'
TIMEOUT = 30
RETRIES = 3
RETRY_BACKOFF = 2.0

# Reasonable safety cap — actual help is ~1000-1500 pages
MAX_PAGES = 5000

# Asset path prefixes we follow (relative to <root>/<lang>/pro-help/)
ASSET_PREFIXES = ('Skins/', 'Resources/', 'resources/', 'content/resources/')

# Global asset path (language-independent)
GLOBAL_ASSETS_PREFIX = '/assets/'


# -------------------- Regex --------------------

HREF_RE = re.compile(r'(?:href|src)\s*=\s*["\']([^"\']+)["\']', re.IGNORECASE)
CSS_URL_RE = re.compile(r'url\(\s*["\']?([^)"\']+)["\']?\s*\)')
CSS_IMPORT_RE = re.compile(r'@import\s+(?:url\()?["\']([^"\')]+)["\']', re.IGNORECASE)


# -------------------- Worker --------------------

class CrawlStats:
    def __init__(self):
        self.lock = threading.Lock()
        self.html_pages = 0
        self.assets = 0
        self.html_failures = []   # critical: pages we couldn't download
        self.asset_failures = []  # less critical: missing icons / fonts
        self.skipped_existing = 0
        self.bytes_downloaded = 0
        self.start_ts = time.time()

    def add_html(self, n=1, bytes_=0):
        with self.lock:
            self.html_pages += n
            self.bytes_downloaded += bytes_

    def add_asset(self, n=1, bytes_=0):
        with self.lock:
            self.assets += n
            self.bytes_downloaded += bytes_

    def add_html_failure(self, url, reason):
        with self.lock:
            self.html_failures.append((url, reason))

    def add_asset_failure(self, url, reason):
        with self.lock:
            self.asset_failures.append((url, reason))

    def add_skipped(self):
        with self.lock:
            self.skipped_existing += 1


def http_get(url, retries=RETRIES):
    """Fetch URL with retries; returns (bytes, last_modified_header) or raises."""
    last_err = None
    for attempt in range(retries):
        try:
            req = Request(url, headers={'User-Agent': USER_AGENT})
            with urlopen(req, timeout=TIMEOUT) as r:
                data = r.read()
                last_mod = r.headers.get('Last-Modified', '')
                return data, last_mod
        except HTTPError as e:
            if e.code in (404, 410):
                # Don't retry permanent errors
                raise
            last_err = e
        except URLError as e:
            last_err = e
        except Exception as e:
            last_err = e
        if attempt < retries - 1:
            time.sleep(RETRY_BACKOFF * (attempt + 1))
    raise last_err if last_err else RuntimeError(f"failed: {url}")


def http_head(url):
    """HEAD request → last-modified header or empty string."""
    try:
        req = Request(url, headers={'User-Agent': USER_AGENT}, method='HEAD')
        with urlopen(req, timeout=TIMEOUT) as r:
            return r.headers.get('Last-Modified', '')
    except Exception:
        return ''


def url_to_local_path(url, lang, output_root):
    """Map a Claris-help URL to a local filesystem path.

    URL forms:
      https://help.claris.com/<lang>/pro-help/content/foo.html  → <out>/<lang>/content/foo.html
      https://help.claris.com/<lang>/pro-help/Skins/x.css       → <out>/<lang>/Skins/x.css
      https://help.claris.com/<lang>/pro-help/Resources/x.js    → <out>/<lang>/Resources/x.js
      https://help.claris.com/assets/css/x.css                  → <out>/<lang>/assets/css/x.css
    """
    p = urlparse(url)
    path = p.path
    lang_root = f'/{lang}/pro-help/'

    if path.startswith(lang_root):
        rel = path[len(lang_root):]
        return os.path.join(output_root, lang, rel)
    if path.startswith('/assets/'):
        rel = path[1:]  # strip leading /
        return os.path.join(output_root, lang, rel)
    # Other paths: skip (external)
    return None


def normalize_url(base_url, ref):
    """Resolve a possibly-relative ref against base_url. Strip fragments and queries."""
    if not ref or ref.startswith(('javascript:', 'mailto:', '#')):
        return None
    abs_url = urljoin(base_url, ref)
    parts = urlparse(abs_url)
    # Strip fragment and query
    abs_url = urlunparse(parts._replace(fragment='', query=''))
    return abs_url


def is_in_scope(url, lang):
    """Only crawl URLs within our language's pro-help tree or global /assets/."""
    p = urlparse(url)
    if p.netloc not in ('', 'help.claris.com'):
        return False
    if p.path.startswith(f'/{lang}/pro-help/'):
        return True
    if p.path.startswith('/assets/'):
        return True
    return False


def is_html_page(url, lang):
    """Is this a content HTML page that we should parse for further links?"""
    p = urlparse(url)
    if not p.path.startswith(f'/{lang}/pro-help/content/'):
        return False
    if not p.path.endswith('.html'):
        return False
    return True


def extract_links_html(html_bytes, base_url):
    """Extract all hrefs and srcs from an HTML page."""
    try:
        html = html_bytes.decode('utf-8', errors='replace')
    except Exception:
        return []
    refs = HREF_RE.findall(html)
    return [normalize_url(base_url, r) for r in refs if r]


def extract_links_css(css_bytes, base_url):
    """Extract all url(...) and @import targets from a CSS file."""
    try:
        css = css_bytes.decode('utf-8', errors='replace')
    except Exception:
        return []
    refs = []
    refs.extend(CSS_URL_RE.findall(css))
    refs.extend(CSS_IMPORT_RE.findall(css))
    return [normalize_url(base_url, r) for r in refs if r]


def save_atomic(local_path, data):
    """Write data to local_path atomically (via .tmp + rename)."""
    os.makedirs(os.path.dirname(local_path), exist_ok=True)
    tmp = local_path + '.tmp'
    with open(tmp, 'wb') as f:
        f.write(data)
    os.replace(tmp, local_path)


# -------------------- Crawl --------------------

def discover_initial_assets():
    """Common assets that may be referenced indirectly from skin CSS/JS but not
    discovered through pure href-parsing. Returns a list of absolute URLs to
    speculatively try (failures are silently ignored)."""
    return []


def crawl_language(lang, output_root, max_workers=8, dry_run=False, verbose=True):
    """Crawl a single language. Returns stats dict."""
    stats = CrawlStats()
    start_url = f'{BASE}/{lang}/pro-help/content/index.html'

    # State
    queue = deque([start_url])
    seen = set([start_url])
    failed_html = set()  # URLs that failed during HTML phase (don't retry as asset)

    # Phase 1: BFS crawl all HTML pages, collecting asset refs
    asset_urls = set()

    def fetch_and_parse_html(url):
        """Returns (url, html_links, data) or (url, None, None) on failure."""
        try:
            data, _ = http_get(url)
            # Save
            local = url_to_local_path(url, lang, output_root)
            if local and not dry_run:
                save_atomic(local, data)
            stats.add_html(1, len(data))
            # Parse links
            html_links = extract_links_html(data, url)
            return url, [l for l in html_links if l], data
        except HTTPError as e:
            stats.add_html_failure(url, f'HTTP {e.code}')
            return url, None, None
        except Exception as e:
            stats.add_html_failure(url, f'{type(e).__name__}: {e}')
            return url, None, None

    if verbose:
        print(f'[{lang}] Discovering pages from index.html...', flush=True)

    pages_processed = 0
    with ThreadPoolExecutor(max_workers=max_workers) as ex:
        in_flight = {}

        def submit(url):
            in_flight[ex.submit(fetch_and_parse_html, url)] = url

        # Seed
        while queue:
            submit(queue.popleft())

        while in_flight:
            done_set = []
            for fut in as_completed(list(in_flight.keys()), timeout=None):
                done_set.append(fut)
                break  # process one at a time so we can keep submitting
            for fut in done_set:
                url = in_flight.pop(fut)
                src_url, links, _data = fut.result()
                pages_processed += 1
                if pages_processed % 50 == 0 and verbose:
                    print(f'[{lang}] {pages_processed} pages crawled, '
                          f'{stats.html_pages} HTML, {len(asset_urls)} assets discovered',
                          flush=True)

                if pages_processed >= MAX_PAGES:
                    if verbose:
                        print(f'[{lang}] WARN: MAX_PAGES ({MAX_PAGES}) reached',
                              flush=True)
                    break

                if not links:
                    failed_html.add(src_url)
                    continue

                for link in links:
                    if not link or not is_in_scope(link, lang):
                        continue
                    if is_html_page(link, lang):
                        if link not in seen:
                            seen.add(link)
                            submit(link)
                    else:
                        # Treat as asset (CSS, JS, image, font)
                        asset_urls.add(link)

            if pages_processed >= MAX_PAGES:
                break

    if verbose:
        print(f'[{lang}] HTML phase done: {stats.html_pages} pages, '
              f'{len(stats.html_failures)} failures, {len(asset_urls)} assets queued',
              flush=True)

    # Phase 2: Download all assets (no parsing for further references except CSS)
    # CSS may reference more assets (fonts, images) so we do one more level
    css_queue = []

    def fetch_asset(url):
        try:
            local = url_to_local_path(url, lang, output_root)
            if not local:
                return url, b'', False
            data, _ = http_get(url)
            if not dry_run:
                save_atomic(local, data)
            stats.add_asset(1, len(data))
            return url, data, True
        except HTTPError as e:
            stats.add_asset_failure(url, f'HTTP {e.code}')
            return url, None, False
        except Exception as e:
            stats.add_asset_failure(url, f'{type(e).__name__}: {e}')
            return url, None, False

    if verbose:
        print(f'[{lang}] Downloading {len(asset_urls)} assets ({max_workers} workers)...',
              flush=True)

    with ThreadPoolExecutor(max_workers=max_workers) as ex:
        futures = {ex.submit(fetch_asset, u): u for u in asset_urls}
        done_count = 0
        for fut in as_completed(futures):
            done_count += 1
            url, data, ok = fut.result()
            if ok and url.lower().endswith('.css') and data:
                # Parse CSS for further references
                for ref in extract_links_css(data, url):
                    if ref and is_in_scope(ref, lang) and ref not in asset_urls:
                        css_queue.append(ref)
            if done_count % 25 == 0 and verbose:
                print(f'[{lang}]   asset {done_count}/{len(asset_urls)}', flush=True)

    # Phase 2b: download CSS-referenced assets
    if css_queue:
        if verbose:
            print(f'[{lang}] Downloading {len(css_queue)} CSS-referenced assets...',
                  flush=True)
        with ThreadPoolExecutor(max_workers=max_workers) as ex:
            for fut in as_completed({ex.submit(fetch_asset, u): u for u in css_queue}):
                fut.result()

    duration = time.time() - stats.start_ts
    mb = stats.bytes_downloaded / 1024 / 1024

    # Dedupe failure URLs (same URL may be referenced from many pages)
    html_failures_unique = list({u: r for u, r in stats.html_failures}.items())
    asset_failures_unique = list({u: r for u, r in stats.asset_failures}.items())

    # "Incomplete" = HTML pages failed at >5%. Asset 404s are non-critical
    # (often broken CSS references to icons/fonts that don't affect content).
    incomplete = (
        stats.html_pages == 0
        or len(html_failures_unique) > max(5, stats.html_pages * 0.05)
    )

    if verbose:
        print(f'[{lang}] Done: {stats.html_pages} HTML + {stats.assets} assets, '
              f'{mb:.1f} MB, {duration:.1f}s, '
              f'{len(html_failures_unique)} HTML failures, '
              f'{len(asset_failures_unique)} asset failures',
              flush=True)

    return {
        'lang': lang,
        'html_pages': stats.html_pages,
        'asset_files': stats.assets,
        'total_size_bytes': stats.bytes_downloaded,
        'duration_seconds': round(duration, 1),
        'html_failures': html_failures_unique,
        'asset_failures_count': len(asset_failures_unique),
        'incomplete': incomplete,
    }


# -------------------- Main --------------------

def main():
    ap = argparse.ArgumentParser(
        description='Crawl one language of the Claris FileMaker online help.'
    )
    ap.add_argument('--lang', required=True,
                    help='Language code (e.g. en, de, es, fr, it, nl, pt, sv, ja, ko, zh)')
    ap.add_argument('--output', required=True,
                    help='Output directory root (will create <output>/<lang>/...)')
    ap.add_argument('--max-workers', type=int, default=8,
                    help='Parallel download workers (default: 8)')
    ap.add_argument('--dry-run', action='store_true',
                    help='Discover only, do not write files')
    ap.add_argument('--quiet', action='store_true',
                    help='Suppress progress output')
    args = ap.parse_args()

    result = crawl_language(
        lang=args.lang,
        output_root=args.output,
        max_workers=args.max_workers,
        dry_run=args.dry_run,
        verbose=not args.quiet,
    )

    # Print JSON result on last line (for parent script to consume)
    print('---CRAWL-RESULT---')
    print(json.dumps(result, default=str))

    if result.get('incomplete'):
        sys.exit(3)
    if result['html_pages'] == 0:
        sys.exit(2)
    sys.exit(0)


if __name__ == '__main__':
    main()

