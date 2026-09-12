#!/usr/bin/env python3
"""Build GitHub social-preview for PaperLab (1280x640)."""
from PIL import Image, ImageDraw, ImageFont
import os

OUT = os.path.join(os.path.dirname(__file__), "social-preview.png")
LOGO = os.path.join(os.path.dirname(__file__), "logo.png")

W, H = 1280, 640
BG = (15, 23, 42)        # deep navy
INK = (255, 255, 255)
GOLD = (212, 161, 58)
MUTED = (180, 190, 200)

img = Image.new("RGB", (W, H), BG)
draw = ImageDraw.Draw(img)

# Embed logo on the left, scaled to ~280px tall.
logo = Image.open(LOGO).convert("RGBA")
target_h = 280
scale = target_h / logo.height
logo = logo.resize((int(logo.width * scale), target_h), Image.LANCZOS)
img.paste(logo, (60, (H - target_h) // 2 - 40), logo)

# Headline text on the right.
def font(size):
    paths = [
        "/System/Library/Fonts/Helvetica.ttc",
        "/System/Library/Fonts/HelveticaNeue.ttc",
        "/Library/Fonts/Helvetica.ttc",
        "/Library/Fonts/Arial.ttf",
    ]
    for p in paths:
        if os.path.exists(p):
            try: return ImageFont.truetype(p, size)
            except Exception: pass
    return ImageFont.load_default()

# Adjust the right text block to start after the logo (which ends ~360px).
TEXT_X = 380
title_font = font(96)
sub_font = font(36)
tag_font = font(22)

draw.text((TEXT_X, 120), "PaperLab", font=title_font, fill=INK)
draw.text((TEXT_X, 240), "Write scientific papers", font=sub_font, fill=GOLD)
draw.text((TEXT_X, 290), "with an agent that keeps the receipts.", font=sub_font, fill=INK)

# Tagline chips along the bottom (5 chips, wrapped to 2 rows if needed).
chips = [
    "claim-evidence ledger",
    "citation verification",
    "BFTS branches",
    "skill marketplace",
    "5-stage human gates",
]
x = 60
y = 470
row_h = 50
gap = 10
chip_w = 220
for i, label in enumerate(chips):
    row = i // 3
    col = i % 3
    cx = 60 + col * (chip_w + 12)
    cy = 470 + row * (row_h + 8)
    draw.rounded_rectangle([cx, cy, cx + chip_w, cy + row_h], radius=row_h // 2, fill=GOLD)
    # Center the label horizontally inside the chip
    bbox = draw.textbbox((0, 0), label, font=tag_font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    draw.text((cx + (chip_w - tw) // 2, cy + (row_h - th) // 2 - 2), label, font=tag_font, fill=BG)

img.save(OUT, "PNG")
print(f"wrote {OUT}")
