"""Reads the Post-purchase page setting out of each store's checkout settings.

There is no Admin API for this radio button - App.isPostPurchaseAppInUse exists but is
only readable for the app that asks, and our upsell apps have no stored token. The
setting is the single point where the whole feature dies silently, so it is worth
reading the admin page directly rather than assuming.
"""
import sys
from playwright.sync_api import sync_playwright

PROFILE = "/Users/macbookpro/onitsuka_migration/playwright_profile"
STORES = {"SneakerStation": "j001wn-ec", "SneakerStudio": "pavzxa-eh"}


def main():
    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            PROFILE, headless=False, args=["--disable-blink-features=AutomationControlled"]
        )
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        for name, handle in STORES.items():
            url = f"https://admin.shopify.com/store/{handle}/settings/checkout"
            print(f"\n=== {name} ({handle}) ===")
            try:
                page.goto(url, wait_until="domcontentloaded", timeout=45000)
                page.wait_for_timeout(6000)
                print("url:", page.url)
                if "accounts.shopify.com" in page.url or "/login" in page.url:
                    print("RESULT: not logged in for this store")
                    page.screenshot(path=f"/Users/macbookpro/ss_upsell/scripts/pp_{handle}_login.png")
                    continue
                body = page.inner_text("body")
                idx = body.find("Post-purchase")
                print("--- around Post-purchase ---")
                print(body[max(0, idx - 200): idx + 600] if idx >= 0 else "STRING NOT FOUND")
                page.screenshot(
                    path=f"/Users/macbookpro/ss_upsell/scripts/pp_{handle}.png", full_page=True
                )
            except Exception as e:
                print("ERR", e)
        ctx.close()


if __name__ == "__main__":
    sys.exit(main())
