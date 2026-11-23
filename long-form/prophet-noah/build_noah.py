#!/usr/bin/env python3
"""Build: Prophet Noah Documentary - Persian narration + music, HORIZONTAL 16:9"""

import subprocess
import os
import re

FFMPEG = "/home/user/AI-Business-Automation/shorts/node_modules/@ffmpeg-installer/linux-x64/ffmpeg"
OUTPUT_DIR = "/home/user/AI-Business-Automation/long-form/prophet-noah"

def get_duration(filepath):
    result = subprocess.run([FFMPEG, "-i", filepath], capture_output=True, text=True)
    match = re.search(r'Duration: (\d+):(\d+):(\d+\.\d+)', result.stderr)
    if match:
        h, m, s = float(match.group(1)), float(match.group(2)), float(match.group(3))
        return h * 3600 + m * 60 + s
    return 20

scenes_data = [
    ("scene01-hook.jpg", "audio/scene01.mp3"),
    ("scene02-noah.jpg", "audio/scene02.mp3"),
    ("scene03-invitation.jpg", "audio/scene03.mp3"),
    ("scene04-rejection.jpg", "audio/scene04.mp3"),
    ("scene05-command.jpg", "audio/scene05.mp3"),
    ("scene06-building.jpg", "audio/scene06.mp3"),
    ("scene07-mockery.jpg", "audio/scene07.mp3"),
    ("scene08-storm.jpg", "audio/scene08.mp3"),
    ("scene09-boarding.jpg", "audio/scene09.mp3"),
    ("scene10-son.jpg", "audio/scene10.mp3"),
    ("scene11-flood.jpg", "audio/scene11.mp3"),
    ("scene12-ark-sailing.jpg", "audio/scene12.mp3"),
    ("scene13-calm.jpg", "audio/scene13.mp3"),
    ("scene14-mountain.jpg", "audio/scene14.mp3"),
    ("scene15-ending.jpg", "audio/scene15.mp3"),
]

scenes = []
for img, audio in scenes_data:
    audio_dur = get_duration(f"{OUTPUT_DIR}/{audio}")
    scene_dur = int(audio_dur) + 12
    scenes.append((img, audio, scene_dur))
    print(f"  {img}: narration={audio_dur:.1f}s -> scene={scene_dur}s")

total_duration = sum(s[2] for s in scenes)
print(f"\n🎬 Total duration: {total_duration}s ({total_duration//60}m {total_duration%60}s)\n")

os.makedirs(f"{OUTPUT_DIR}/temp", exist_ok=True)

for i, (img, audio, duration) in enumerate(scenes, 1):
    print(f"Scene {i}: {duration}s - {img}")
    # HORIZONTAL 16:9 format: 1280x720
    vf = f"scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=black,zoompan=z='min(zoom+0.0004,1.06)':d={duration*24}:s=1280x720:fps=24,format=yuv420p"
    subprocess.run([
        FFMPEG, "-y", "-loop", "1", "-i", f"{OUTPUT_DIR}/{img}",
        "-vf", vf, "-t", str(duration),
        "-c:v", "libx264", "-r", "24", "-pix_fmt", "yuv420p",
        "-profile:v", "baseline", "-level", "3.0",
        f"{OUTPUT_DIR}/temp/scene{i:02d}.mp4"
    ], capture_output=True)

print("\n✅ All scenes created")

with open(f"{OUTPUT_DIR}/temp/video_concat.txt", 'w') as f:
    for i in range(1, len(scenes) + 1):
        f.write(f"file 'scene{i:02d}.mp4'\n")

subprocess.run([
    FFMPEG, "-y", "-f", "concat", "-safe", "0",
    "-i", f"{OUTPUT_DIR}/temp/video_concat.txt",
    "-c:v", "libx264", "-preset", "medium", "-crf", "20",
    f"{OUTPUT_DIR}/temp/video-only.mp4"
], capture_output=True, text=True)

with open(f"{OUTPUT_DIR}/temp/audio_concat.txt", 'w') as f:
    for _, audio, _ in scenes:
        f.write(f"file '{OUTPUT_DIR}/{audio}'\n")

subprocess.run([
    FFMPEG, "-y", "-f", "concat", "-safe", "0",
    "-i", f"{OUTPUT_DIR}/temp/audio_concat.txt",
    "-c:a", "aac", "-b:a", "128k",
    f"{OUTPUT_DIR}/temp/narration.aac"
], capture_output=True, text=True)

print("🎵 Mixing narration + music...")

result = subprocess.run([
    FFMPEG, "-y",
    "-i", f"{OUTPUT_DIR}/temp/video-only.mp4",
    "-i", f"{OUTPUT_DIR}/temp/narration.aac",
    "-stream_loop", "-1", "-i", f"{OUTPUT_DIR}/audio/music.mp3",
    "-filter_complex", f"[1:a]volume=1.2[narration];[2:a]atrim=0:{total_duration},volume=0.18,afade=out:st={total_duration-3}:d=3[music];[narration][music]amix=inputs=2:duration=longest[audio]",
    "-map", "0:v", "-map", "[audio]",
    "-c:v", "libx264", "-preset", "medium", "-crf", "20",
    "-c:a", "aac", "-b:a", "192k",
    "-t", str(total_duration),
    "-movflags", "+faststart",
    f"{OUTPUT_DIR}/prophet-noah-final.mp4"
], capture_output=True, text=True)

if result.returncode == 0:
    print("✅ Video ready!\n")
    info = subprocess.run([FFMPEG, "-i", f"{OUTPUT_DIR}/prophet-noah-final.mp4"], capture_output=True, text=True)
    for line in info.stderr.split('\n'):
        if 'Duration' in line or 'Stream' in line:
            print(line.strip())
    size = os.path.getsize(f"{OUTPUT_DIR}/prophet-noah-final.mp4")
    print(f"\n💾 Size: {size / (1024*1024):.2f} MB")
else:
    print(f"❌ Error:\n{result.stderr[-2000:]}")

subprocess.run(["rm", "-rf", f"{OUTPUT_DIR}/temp"])
print("\n✅ Done!")
