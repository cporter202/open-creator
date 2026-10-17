#!/usr/bin/env python3
"""Idempotently inject the Apify promo block into OpenCreator's README.

Safe to run on every upstream sync: removes any existing promo block first,
then inserts a fresh one before the hero screenshot. If the anchor image is
gone (upstream redesign), falls back to after the header </div>, then to the
top of the file.
"""
import re
import sys

README = "README.md"

START = "<!-- APIFY-PROMO-START -->"
END = "<!-- APIFY-PROMO-END -->"

PROMO = f"""{START}
> ### 🚀 Need videos at scale? Scrape them with these APIs
>
> OpenCreator downloads and translates videos — but first you need the videos. [Apify's ready-made scrapers](https://apify.com?fpr=p2hrc6) pull thousands of videos from TikTok, YouTube, and Instagram with zero code:
>
> - [TikTok Scraper](https://apify.com/apify/tiktok-scraper?fpr=p2hrc6) — videos, comments, profiles, hashtags
> - [YouTube Scraper](https://apify.com/apify/youtube-scraper?fpr=p2hrc6) — videos, channels, comments, transcripts
> - [Instagram Scraper](https://apify.com/apify/instagram-scraper?fpr=p2hrc6) — reels, posts, profiles, comments
>
> Feed them straight into your OpenCreator workflow. [Try Apify free →](https://apify.com?fpr=p2hrc6)
>
> *Affiliate disclosure: links above are affiliate links — I may earn a commission at no extra cost to you.*
{END}
"""

ANCHORS = [
    "![OpenCreator Agent workspace]",  # hero screenshot (primary)
    "</div>",                          # close of centered header (fallback)
]




BANNER_START = "<!-- AIWITHCHRIS-BANNER-START -->"
BANNER_END = "<!-- AIWITHCHRIS-BANNER-END -->"

BANNER_BLOCK = """<!-- AIWITHCHRIS-BANNER-START -->
<p align="center">
  <a href="https://aiwithchris.com" target="_blank" rel="noopener">
    <img src=".github/assets/ai-toolkit-banner.png" alt="Hey, I'm Chris — Work Smarter, Create Faster, Earn More With AI. Join my AI Playbook at aiwithchris.com, $10/month" width="100%">
  </a>
</p>
<p align="center">
  <a href="https://aiwithchris.com"><strong>\U0001F680 Join my AI Playbook — aiwithchris.com</strong></a><br>
  $10/month \u00b7 3,600+ prompts \u00b7 agent workflows \u00b7 repo breakdowns \u00b7 money ideas
</p>
<!-- AIWITHCHRIS-BANNER-END -->
"""


def strip_block(text, start, end):
    out, skipping = [], False
    for line in text.split(chr(10)):
        if start in line:
            skipping = True
            continue
        if end in line:
            skipping = False
            continue
        if not skipping:
            out.append(line)
    return chr(10).join(out)


def inject_banner(text):
    text = strip_block(text, BANNER_START, BANNER_END)
    idx = text.find(START)  # right before the Apify promo block
    if idx != -1:
        return text[:idx] + BANNER_BLOCK + chr(10) + text[idx:]
    for anchor in ANCHORS:  # fallback: hero anchor like the promo
        i2 = text.find(anchor)
        if i2 != -1:
            return text[:i2] + BANNER_BLOCK + chr(10) + text[i2:]
    return BANNER_BLOCK + chr(10) + text

def fix_badges(text):
    """Drop the stars badge entirely and remove upstream's award badges."""
    # Remove the GitHub Stars badge line (no backslashes needed)
    lines = text.split(chr(10))
    lines = [l for l in lines if 'GitHub Stars' not in l]
    text = chr(10).join(lines)
    # TrendShift "#1 repo of the day" award badge -> theirs, not ours; drop it
    keep = []
    for l in text.split(chr(10)):
        if 'trendshift.io' in l:
            continue
        keep.append(l)
    return chr(10).join(keep)


def main():
    try:
        with open(README, encoding="utf-8") as f:
            text = f.read()
    except FileNotFoundError:
        print(f"{README} not found, skipping", file=sys.stderr)
        return 0

    # Strip any existing promo block (idempotency)
    text = re.sub(re.escape(START) + r".*?" + re.escape(END) + r"\n?",
                  "", text, flags=re.DOTALL)

    inserted = False
    for anchor in ANCHORS:
        idx = text.find(anchor)
        if idx != -1:
            text = text[:idx] + PROMO + "\n" + text[idx:]
            inserted = True
            print(f"promo inserted before anchor: {anchor[:40]}")
            break

    if not inserted:
        text = PROMO + "\n" + text
        print("promo inserted at top of file (no anchor found)")

    text = inject_banner(text)
    text = fix_badges(text)

    with open(README, "w", encoding="utf-8") as f:
        f.write(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
