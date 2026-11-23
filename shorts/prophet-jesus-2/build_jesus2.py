#!/usr/bin/env python3
"""Build: Prophet Jesus Part 2 - Persian, VERTICAL 9:16"""

import subprocess
import os
import re

FFMPEG = "/home/user/AI-Business-Automation/shorts/node_modules/@ffmpeg-installer/linux-x64/ffmpeg"
OUTPUT_DIR = "/home/user/AI-Business-Automation/shorts/prophet-jesus-2"

def get_duration(filepath):
    result = subprocess.run([FFMPEG, "-i", filepath], capture_output=True, text=True)
    match = re.search(r'Duration: (\d+):(\d+):(\d+\.\d+)', result.stderr)
    if match:
        h, m, s = float(match.group(1)), float(match.group(2)), float(match.group(3))
        return h * 3600 + m * 60 + s
    return 10

narration_dur = get_duration(f"{OUTPUT_DIR}/audio/narration.mp3")
print(f"Narration: {narration_dur:.1f}s")

# 7 scenes, each gets narration/7 + 6s padding
per_scene_narration = narration_dur / 7
scene_dur = int(per_scene_narration) + 6
total_duration = scene_dur * 7
print(f"Per scene: {scene_dur}s | Total: {total_duration}s ({total_duration//60}m {total_duration%60}s)\n")

scenes_config = [
    ("scene01-cradle.jpg",      "zoom_in"),
    ("scene02-bird.jpg",        "zoom_out"),
    ("scene03-blind.jpg",       "pan_right"),
    ("scene04-resurrection.jpg","zoom_in"),
    ("scene05-feast.jpg",       "pan_left"),
    ("scene06-apostles.jpg",    "zoom_in"),
    ("scene07-power.jpg",       "zoom_out"),
]

os.makedirs(f"{OUTPUT_DIR}/temp", exist_ok=True)

# Motion effects for VERTICAL 9:16 (540x960)
motion_effects = {
    "zoom_in": {
        "z": "min(zoom+0.002,1.35)",
        "x": "iw/2-(iw/zoom/2)",
        "y": "ih/2-(ih/zoom/2)"
    },
    "zoom_out": {
        "z": "1.35-(0.35*on/{frames})",
        "x": "iw/2-(iw/zoom/2)",
        "y": "ih/2-(ih/zoom/2)"
    },
    "pan_right": {
        "z": "1.25",
        "x": "(iw/zoom/2)*0.3*on/{frames}",
        "y": "ih/2-(ih/zoom/2)"
    },
    "pan_left": {
        "z": "1.25",
        "x": "iw/zoom-(iw/zoom/2)*0.3*on/{frames}",
        "y": "ih/2-(ih/zoom/2)"
    }
}

for i, (img, effect) in enumerate(scenes_config, 1):
    print(f"Scene {i}: {scene_dur}s - {img} ({effect})")
    frames = scene_dur * 24

    motion = motion_effects[effect]
    z_expr = motion["z"].format(frames=frames)
    x_expr = motion["x"].format(frames=frames)
    y_expr = motion["y"].format(frames=frames)

    # VERTICAL 9:16: 540x960
    vf = (
        f"scale=1080:1920:force_original_aspect_ratio=decrease,"
        f"pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black,"
        f"zoompan=z='{z_expr}':x='{x_expr}':y='{y_expr}':d={frames}:s=540x960:fps=24,"
        f"fade=in:0:12,fade=out:st={scene_dur-1}:d=1,"
        f"format=yuv420p"
    )

    subprocess.run([
        FFMPEG, "-y", "-loop", "1", "-i", f"{OUTPUT_DIR}/{img}",
        "-vf", vf, "-t", str(scene_dur),
        "-c:v", "libx264", "-r", "24", "-pix_fmt", "yuv420p",
        "-profile:v", "baseline", "-level", "3.0",
        f"{OUTPUT_DIR}/temp/scene{i:02d}.mp4"
    ], capture_output=True)

print("\n✅ All scenes created")

# Concat scenes
with open(f"{OUTPUT_DIR}/temp/video_concat.txt", 'w') as f:
    for i in range(1, 8):
        f.write(f"file 'scene{i:02d}.mp4'\n")

subprocess.run([
    FFMPEG, "-y", "-f", "concat", "-safe", "0",
    "-i", f"{OUTPUT_DIR}/temp/video_concat.txt",
    "-c:v", "libx264", "-preset", "medium", "-crf", "20",
    f"{OUTPUT_DIR}/temp/video-only.mp4"
], capture_output=True, text=True)

# Mix narration + music
print("🎵 Mixing narration + music...")
result = subprocess.run([
    FFMPEG, "-y",
    "-i", f"{OUTPUT_DIR}/temp/video-only.mp4",
    "-i", f"{OUTPUT_DIR}/audio/narration.mp3",
    "-stream_loop", "-1", "-i", f"{OUTPUT_DIR}/audio/music.mp3",
    "-filter_complex",
    f"[1:a]volume=1.3[narration];"
    f"[2:a]atrim=0:{total_duration},volume=0.22,afade=in:st=0:d=2,afade=out:st={total_duration-3}:d=3[music];"
    f"[narration][music]amix=inputs=2:duration=longest:dropout_transition=2[audio]",
    "-map", "0:v", "-map", "[audio]",
    "-c:v", "libx264", "-preset", "medium", "-crf", "20",
    "-c:a", "aac", "-b:a", "192k",
    "-t", str(total_duration),
    "-movflags", "+faststart",
    f"{OUTPUT_DIR}/prophet-jesus-2-final.mp4"
], capture_output=True, text=True)

if result.returncode == 0:
    print("✅ Video ready!\n")
    info = subprocess.run([FFMPEG, "-i", f"{OUTPUT_DIR}/prophet-jesus-2-final.mp4"], capture_output=True, text=True)
    for line in info.stderr.split('\n'):
        if 'Duration' in line or 'Stream' in line:
            print(line.strip())
    size = os.path.getsize(f"{OUTPUT_DIR}/prophet-jesus-2-final.mp4")
    print(f"\n💾 Size: {size / (1024*1024):.2f} MB")
else:
    print(f"❌ Error:\n{result.stderr[-2000:]}")

# Clean temp
subprocess.run(["rm", "-rf", f"{OUTPUT_DIR}/temp"])
print("\n✅ Done!")
