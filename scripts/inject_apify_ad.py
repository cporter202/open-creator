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
    # Subtle placement: bottom of the README, just above the License section.
    text = strip_block(text, BANNER_START, BANNER_END)
    lines = text.split(chr(10))
    lic = [i for i, l in enumerate(lines)
           if re.match(r'^#{1,3}\s+licen[sc]e\b', l.strip(), re.I)]
    if lic:
        i = lic[-1]
        while i > 0 and lines[i-1].strip() == '':
            i -= 1
        lines[i:i] = ['', BANNER_BLOCK, '']
    else:
        while lines and lines[-1].strip() == '':
            lines.pop()
        lines.extend(['', BANNER_BLOCK])
    return chr(10).join(lines) + chr(10)

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
