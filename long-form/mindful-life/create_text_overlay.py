#!/usr/bin/env python3
"""Create Persian text overlay for ending"""

from PIL import Image, ImageDraw, ImageFont
import arabic_reshaper
from bidi.algorithm import get_display

# Create transparent overlay
img = Image.new("RGBA", (1280, 720), (0, 0, 0, 0))
draw = ImageDraw.Draw(img)

# Semi-transparent dark background at bottom
draw.rectangle([(0, 450), (1280, 720)], fill=(0, 0, 0, 180))

# Load font
font_path = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
font_big = ImageFont.truetype(font_path, 44)
font_small = ImageFont.truetype(font_path, 30)

# Persian text (reshaped for proper rendering)
text1_raw = "امروز، شروع یک زندگی بهتر است 🌱"
text2_raw = "زندگی آگاهانه | Mindful Life"

# Reshape and apply bidi
text1_reshaped = arabic_reshaper.reshape(text1_raw)
text1 = get_display(text1_reshaped)

text2_reshaped = arabic_reshaper.reshape(text2_raw)
text2 = get_display(text2_reshaped)

# Center and draw text
bbox1 = draw.textbbox((0, 0), text1, font=font_big)
x1 = (1280 - (bbox1[2] - bbox1[0])) // 2
draw.text((x1, 500), text1, font=font_big, fill=(255, 255, 255, 255))

bbox2 = draw.textbbox((0, 0), text2, font=font_small)
x2 = (1280 - (bbox2[2] - bbox2[0])) // 2
draw.text((x2, 580), text2, font=font_small, fill=(220, 220, 220, 255))

# Save
img.save("/home/user/AI-Business-Automation/long-form/mindful-life/temp/ending_text_proper.png")
print("✅ Persian text overlay created!")
