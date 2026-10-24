"""Fetch a public calendar or render a public schedule page."""

from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urlparse

import httpx


class IngestError(Exception):
    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


def assert_public_http_url(url: str) -> None:
    parsed = urlparse(url.strip())
    host = (parsed.hostname or "").strip("[]").lower()
    if parsed.scheme not in {"http", "https"} or not host:
        raise ValueError("url must be an http or https address")
    if host in {"localhost", "localhost.localdomain"} or host.endswith(".local") or host.endswith(".internal"):
        raise ValueError("url host is not public")
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    try:
        addresses = _addresses(host, port)
    except socket.gaierror as exc:
        raise ValueError("Could not resolve the url host") from exc
    if not addresses or any(not ip.is_global for ip in addresses):
        raise ValueError("url host is not public")


def _addresses(host: str, port: int) -> list[ipaddress.IPv4Address | ipaddress.IPv6Address]:
    try:
        return [ipaddress.ip_address(host)]
    except ValueError:
        infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    return [ipaddress.ip_address(info[4][0]) for info in infos]


async def fetch_calendar(url: str) -> str:
    current = url.strip()
    try:
        async with httpx.AsyncClient(timeout=20.0, follow_redirects=False) as client:
            for _ in range(5):
                assert_public_http_url(current)
                response = await client.get(
                    current,
                    headers={
                        "User-Agent": "ecnl-schedule-pilot",
                        "Accept": "text/calendar, text/plain, */*",
                    },
                )
                if response.status_code in {301, 302, 303, 307, 308}:
                    location = response.headers.get("location")
                    if not location:
                        raise IngestError(502, "Calendar redirect was missing a location")
                    current = str(httpx.URL(current).join(location))
                    continue
                if response.status_code >= 400:
                    raise IngestError(502, f"Calendar host returned {response.status_code}")
                text = response.text
                if len(text) > 2_000_000:
                    raise IngestError(400, "Calendar is too large")
                return text
    except IngestError:
        raise
    except ValueError:
        raise
    except httpx.HTTPError as exc:
        raise IngestError(502, "Could not fetch the calendar") from exc
    raise IngestError(502, "Calendar redirected too many times")


async def fetch_rendered_html(url: str) -> str:
    assert_public_http_url(url)
    try:
        from playwright.async_api import Error as PlaywrightError
        from playwright.async_api import async_playwright
    except ImportError as exc:
        raise IngestError(503, "Playwright is not installed") from exc

    try:
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(headless=True)
            try:
                page = await browser.new_page()

                async def guard(route: object) -> None:
                    request_url = route.request.url  # type: ignore[attr-defined]
                    if urlparse(request_url).scheme in {"http", "https", "ws", "wss"}:
                        try:
                            assert_public_http_url(request_url)
                        except ValueError:
                            await route.abort()  # type: ignore[attr-defined]
                            return
                    await route.continue_()  # type: ignore[attr-defined]

                await page.route("**/*", guard)
                await page.goto(url, wait_until="domcontentloaded", timeout=30_000)
                try:
                    await page.wait_for_selector("table, [role='table']", timeout=8_000)
                except PlaywrightError:
                    pass
                html = await page.content()
            finally:
                await browser.close()
    except IngestError:
        raise
    except ValueError:
        raise
    except Exception as exc:
        message = str(exc)
        if "Executable doesn't exist" in message or "playwright install" in message.lower():
            raise IngestError(503, "Playwright Chromium is not installed") from exc
        raise IngestError(502, "Could not render the schedule page") from exc
    if len(html) > 5_000_000:
        raise IngestError(400, "Schedule page is too large")
    return html
