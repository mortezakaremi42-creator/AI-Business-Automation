#!/usr/bin/env python3
"""Build: Mindful Life - 5 Powerful Habits - Persian motivational short"""

import subprocess
import os
import re

FFMPEG = "/home/user/AI-Business-Automation/shorts/node_modules/@ffmpeg-installer/linux-x64/ffmpeg"
OUTPUT_DIR = "/home/user/AI-Business-Automation/long-form/mindful-life"

def get_duration(filepath):
    result = subprocess.run([FFMPEG, "-i", filepath], capture_output=True, text=True)
    match = re.search(r'Duration: (\d+):(\d+):(\d+\.\d+)', result.stderr)
    if match:
        h, m, s = float(match.group(1)), float(match.group(2)), float(match.group(3))
        return h * 3600 + m * 60 + s
    return 10

narration_dur = get_duration(f"{OUTPUT_DIR}/audio/narration.mp3")
print(f"Narration: {narration_dur:.1f}s")

# Target: exactly 60 seconds
# 6 scenes: scenes 1-5 = 8s each (40s), scene 6 = 20s (sunset + ending text)
scenes_config = [
    ("scene01-sunrise.jpg",    8,  "zoom_in"),
    ("scene02-meditation.jpg", 8,  "zoom_out"),
    ("scene03-exercise.jpg",   8,  "pan_right"),
    ("scene04-reading.jpg",    8,  "zoom_in"),
    ("scene05-goals.jpg",      8,  "pan_right"),
    ("scene06-sunset.jpg",     20, "zoom_in_slow"),
]

total_duration = sum(s[1] for s in scenes_config)
print(f"Total: {total_duration}s\n")

os.makedirs(f"{OUTPUT_DIR}/temp", exist_ok=True)

# === Create ending text overlay image with PIL ===
print("🎨 Creating ending text overlay...")
try:
    from PIL import Image, ImageDraw, ImageFont
    import glob
    
    # Find an Arabic/Persian font
    font_paths = glob.glob("/usr/share/fonts/**/Noto*Arabic*.ttf", recursive=True) + \
                 glob.glob("/usr/share/fonts/**/Noto*Sans*Arabic*.ttf", recursive=True) + \
                 glob.glob("/usr/share/fonts/**/DejaVu*.ttf", recursive=True) + \
                 glob.glob("/usr/share/fonts/**/*.ttf", recursive=True)
    
    font_path = None
    for fp in font_paths:
        if "Arabic" in fp or "Noto" in fp:
            font_path = fp
            break
    if not font_path and font_paths:
        font_path = font_paths[0]
    
    print(f"  Font: {font_path}")
    
    # Create transparent overlay
    img = Image.new("RGBA", (1280, 720), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    
    # Semi-transparent dark background at bottom
    draw.rectangle([(0, 400), (1280, 720)], fill=(0, 0, 0, 160))
    
    if font_path:
        font_big = ImageFont.truetype(font_path, 42)
        font_small = ImageFont.truetype(font_path, 28)
    else:
        font_big = ImageFont.load_default()
        font_small = ImageFont.load_default()
    
    # Main text (centered)
    text1 = "امروز، شروع یک زندگی بهتر است 🌱"
    text2 = "زندگی آگاهانه | Mindful Life"
    
    # Center text
    bbox1 = draw.textbbox((0, 0), text1, font=font_big)
    x1 = (1280 - (bbox1[2] - bbox1[0])) // 2
    draw.text((x1, 480), text1, font=font_big, fill=(255, 255, 255, 255))
    
    bbox2 = draw.textbbox((0, 0), text2, font=font_small)
    x2 = (1280 - (bbox2[2] - bbox2[0])) // 2
    draw.text((x2, 560), text2, font=font_small, fill=(200, 200, 200, 255))
    
    img.save(f"{OUTPUT_DIR}/temp/ending_text.png")
    print("  ✅ Ending text overlay created")
except Exception as e:
    print(f"  ⚠️ PIL text creation failed: {e}")
    # Fallback: create a simple text image with FFmpeg
    subprocess.run([
        FFMPEG, "-y", "-f", "lavfi", "-i", "color=c=black@0.6:s=1280x320:d=1",
        "-vf", "drawtext=text='Mindful Life | زندگی آگاهانه':fontsize=36:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2",
        "-frames:v", "1", f"{OUTPUT_DIR}/temp/ending_text.png"
    ], capture_output=True)

# === Motion effects ===
motion_effects = {
    "zoom_in": {
        "z": "min(zoom+0.0015,1.30)",
        "x": "iw/2-(iw/zoom/2)",
        "y": "ih/2-(ih/zoom/2)"
    },
    "zoom_out": {
        "z": "1.30-(0.30*on/{frames})",
        "x": "iw/2-(iw/zoom/2)",
        "y": "ih/2-(ih/zoom/2)"
    },
    "pan_right": {
        "z": "1.20",
        "x": "(iw/zoom/2)*0.25*on/{frames}",
        "y": "ih/2-(ih/zoom/2)"
    },
    "pan_left": {
        "z": "1.20",
        "x": "iw/zoom-(iw/zoom/2)*0.25*on/{frames}",
        "y": "ih/2-(ih/zoom/2)"
    },
    "zoom_in_slow": {
        "z": "min(zoom+0.0008,1.15)",
        "x": "iw/2-(iw/zoom/2)",
        "y": "ih/2-(ih/zoom/2)"
    }
}

# === Build each scene ===
for i, (img, duration, effect) in enumerate(scenes_config, 1):
    print(f"Scene {i}: {duration}s - {img} ({effect})")
    frames = duration * 24
    
    motion = motion_effects[effect]
    z_expr = motion["z"].format(frames=frames)
    x_expr = motion["x"].format(frames=frames)
    y_expr = motion["y"].format(frames=frames)
    
    vf = (
        f"scale=1920:1080:force_original_aspect_ratio=decrease,"
        f"pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black,"
        f"zoompan=z='{z_expr}':x='{x_expr}':y='{y_expr}':d={frames}:s=1280x720:fps=24,"
        f"fade=in:0:12,fade=out:st={duration-1}:d=1,"
        f"format=yuv420p"
    )
    
    subprocess.run([
        FFMPEG, "-y", "-loop", "1", "-i", f"{OUTPUT_DIR}/{img}",
        "-vf", vf, "-t", str(duration),
        "-c:v", "libx264", "-r", "24", "-pix_fmt", "yuv420p",
        "-profile:v", "baseline", "-level", "3.0",
        f"{OUTPUT_DIR}/temp/scene{i:02d}.mp4"
    ], capture_output=True)

# === Add text overlay to scene 6 ===
print("\n📝 Adding ending text overlay to scene 6...")
# Overlay text on the last 8 seconds of scene 6
# Scene 6 is 20s. Text appears from second 12 to 20 (last 8 seconds)
subprocess.run([
    FFMPEG, "-y",
    "-i", f"{OUTPUT_DIR}/temp/scene06.mp4",
    "-i", f"{OUTPUT_DIR}/temp/ending_text.png",
    "-filter_complex",
    "[1:v]format=rgba,fade=in:st=0:d=2:alpha=1[text];"
    "[0:v][text]overlay=0:0:enable='between(t,12,20)'",
    "-c:v", "libx264", "-preset", "medium", "-crf", "20",
    "-r", "24", "-pix_fmt", "yuv420p",
    f"{OUTPUT_DIR}/temp/scene06_text.mp4"
], capture_output=True, text=True)

# Replace scene 6 with text version
os.replace(f"{OUTPUT_DIR}/temp/scene06_text.mp4", f"{OUTPUT_DIR}/temp/scene06.mp4")
print("  ✅ Text overlay added")

# === Concat all scenes ===
print("\n🔗 Concatenating scenes...")
with open(f"{OUTPUT_DIR}/temp/video_concat.txt", 'w') as f:
    for i in range(1, 7):
        f.write(f"file 'scene{i:02d}.mp4'\n")

subprocess.run([
    FFMPEG, "-y", "-f", "concat", "-safe", "0",
    "-i", f"{OUTPUT_DIR}/temp/video_concat.txt",
    "-c:v", "libx264", "-preset", "medium", "-crf", "20",
    f"{OUTPUT_DIR}/temp/video-only.mp4"
], capture_output=True, text=True)

# === Mix narration + music ===
print("🎵 Mixing narration + music...")
result = subprocess.run([
    FFMPEG, "-y",
    "-i", f"{OUTPUT_DIR}/temp/video-only.mp4",
    "-i", f"{OUTPUT_DIR}/audio/narration.mp3",
    "-stream_loop", "-1", "-i", f"{OUTPUT_DIR}/audio/music.mp3",
    "-filter_complex",
    f"[1:a]volume=1.3[narration];"
    f"[2:a]atrim=0:{total_duration},volume=0.25,afade=in:st=0:d=2,afade=out:st={total_duration-3}:d=3[music];"
    f"[narration][music]amix=inputs=2:duration=longest:dropout_transition=2[audio]",
    "-map", "0:v", "-map", "[audio]",
    "-c:v", "libx264", "-preset", "medium", "-crf", "20",
    "-c:a", "aac", "-b:a", "192k",
    "-t", str(total_duration),
    "-movflags", "+faststart",
    f"{OUTPUT_DIR}/mindful-life-final.mp4"
], capture_output=True, text=True)

if result.returncode == 0:
    print("✅ Video ready!\n")
    info = subprocess.run([FFMPEG, "-i", f"{OUTPUT_DIR}/mindful-life-final.mp4"], capture_output=True, text=True)
    for line in info.stderr.split('\n'):
        if 'Duration' in line or 'Stream' in line:
            print(line.strip())
    size = os.path.getsize(f"{OUTPUT_DIR}/mindful-life-final.mp4")
    print(f"\n💾 Size: {size / (1024*1024):.2f} MB")
else:
    print(f"❌ Error:\n{result.stderr[-2000:]}")

# Clean temp
subprocess.run(["rm", "-rf", f"{OUTPUT_DIR}/temp"])
print("\n✅ Done!")
