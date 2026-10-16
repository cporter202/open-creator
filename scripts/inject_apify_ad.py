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



def fix_badges(text):
    """Point the stars badge at OUR repo and drop upstream's award badges."""
    # Stars badge -> our repo, so it shows OUR real star count
    text = text.replace('badgen.net/github/stars/krillinai/OpenCreator',
                        'badgen.net/github/stars/cporter202/open-creator')
    text = text.replace('https://github.com/krillinai/OpenCreator/stargazers',
                        'https://github.com/cporter202/open-creator/stargazers')
    # TrendShift "#1 repo of the day" award badge -> theirs, not ours; drop it
    text = re.sub(r'<a href="https://trendshift\.io[^>]*>.*?</a>\s*\n?', '', text, flags=re.DOTALL)
    return text


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

    text = fix_badges(text)

    with open(README, "w", encoding="utf-8") as f:
        f.write(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
