#!/usr/bin/env python3
"""Build: Animation Test - Enhanced motion effects, 1 minute, Persian"""

import subprocess
import os
import re

FFMPEG = "/home/user/AI-Business-Automation/shorts/node_modules/@ffmpeg-installer/linux-x64/ffmpeg"
OUTPUT_DIR = "/home/user/AI-Business-Automation/test-animation"

def get_duration(filepath):
    result = subprocess.run([FFMPEG, "-i", filepath], capture_output=True, text=True)
    match = re.search(r'Duration: (\d+):(\d+):(\d+\.\d+)', result.stderr)
    if match:
        h, m, s = float(match.group(1)), float(match.group(2)), float(match.group(3))
        return h * 3600 + m * 60 + s
    return 20

narration_dur = get_duration(f"{OUTPUT_DIR}/audio/narration.mp3")
print(f"Narration: {narration_dur:.1f}s")

# Total = narration + 15s padding (5s per scene extra)
total_duration = int(narration_dur) + 15
scene_duration = total_duration // 3
print(f"Total: {total_duration}s ({scene_duration}s per scene)\n")

os.makedirs(f"{OUTPUT_DIR}/temp", exist_ok=True)

# Scene 1 (Car): Zoom IN from 1.0 to 1.25 + slight pan RIGHT
# Simulates camera approaching the car
print("Scene 1: Car - Zoom IN + Pan Right")
frames1 = scene_duration * 24
vf1 = (
    f"scale=1920:1080:force_original_aspect_ratio=decrease,"
    f"pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black,"
    f"zoompan=z='min(zoom+0.001,1.25)':x='iw/2-(iw/zoom/2)+((iw/zoom/2)*0.15*on/{frames1})':y='ih/2-(ih/zoom/2)':d={frames1}:s=1280x720:fps=24,"
    f"fade=in:0:12,fade=out:st={scene_duration-1}:d=1,"
    f"format=yuv420p"
)
subprocess.run([
    FFMPEG, "-y", "-loop", "1", "-i", f"{OUTPUT_DIR}/scene01-car.jpg",
    "-vf", vf1, "-t", str(scene_duration),
    "-c:v", "libx264", "-r", "24", "-pix_fmt", "yuv420p",
    "-profile:v", "baseline", "-level", "3.0",
    f"{OUTPUT_DIR}/temp/scene01.mp4"
], capture_output=True)

# Scene 2 (Bird): Zoom OUT from 1.25 to 1.0 + pan UP
# Simulates camera pulling back to reveal the ocean
print("Scene 2: Bird - Zoom OUT + Pan Up")
frames2 = scene_duration * 24
vf2 = (
    f"scale=1920:1080:force_original_aspect_ratio=decrease,"
    f"pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black,"
    f"zoompan=z='1.25-(0.25*on/{frames2})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)-(ih/zoom/2)*0.1*on/{frames2}':d={frames2}:s=1280x720:fps=24,"
    f"fade=in:0:12,fade=out:st={scene_duration-1}:d=1,"
    f"format=yuv420p"
)
subprocess.run([
    FFMPEG, "-y", "-loop", "1", "-i", f"{OUTPUT_DIR}/scene02-bird.jpg",
    "-vf", vf2, "-t", str(scene_duration),
    "-c:v", "libx264", "-r", "24", "-pix_fmt", "yuv420p",
    "-profile:v", "baseline", "-level", "3.0",
    f"{OUTPUT_DIR}/temp/scene02.mp4"
], capture_output=True)

# Scene 3 (Horse): Pan LEFT to RIGHT (no zoom)
# Simulates camera following the horse across the field
print("Scene 3: Horse - Pan LEFT to RIGHT")
frames3 = scene_duration * 24
vf3 = (
    f"scale=1920:1080:force_original_aspect_ratio=decrease,"
    f"pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black,"
    f"zoompan=z='1.15':x='(iw/zoom/2)*0.2*on/{frames3}':y='ih/2-(ih/zoom/2)':d={frames3}:s=1280x720:fps=24,"
    f"fade=in:0:12,fade=out:st={scene_duration-1}:d=1,"
    f"format=yuv420p"
)
subprocess.run([
    FFMPEG, "-y", "-loop", "1", "-i", f"{OUTPUT_DIR}/scene03-horse.jpg",
    "-vf", vf3, "-t", str(scene_duration),
    "-c:v", "libx264", "-r", "24", "-pix_fmt", "yuv420p",
    "-profile:v", "baseline", "-level", "3.0",
    f"{OUTPUT_DIR}/temp/scene03.mp4"
], capture_output=True)

print("\n✅ All scenes created")

# Concat scenes
with open(f"{OUTPUT_DIR}/temp/video_concat.txt", 'w') as f:
    f.write("file 'scene01.mp4'\n")
    f.write("file 'scene02.mp4'\n")
    f.write("file 'scene03.mp4'\n")

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
    f"{OUTPUT_DIR}/test-animation-final.mp4"
], capture_output=True, text=True)

if result.returncode == 0:
    print("✅ Video ready!\n")
    info = subprocess.run([FFMPEG, "-i", f"{OUTPUT_DIR}/test-animation-final.mp4"], capture_output=True, text=True)
    for line in info.stderr.split('\n'):
        if 'Duration' in line or 'Stream' in line:
            print(line.strip())
    size = os.path.getsize(f"{OUTPUT_DIR}/test-animation-final.mp4")
    print(f"\n💾 Size: {size / (1024*1024):.2f} MB")
else:
    print(f"❌ Error:\n{result.stderr[-2000:]}")

# Clean temp
subprocess.run(["rm", "-rf", f"{OUTPUT_DIR}/temp"])
print("\n✅ Done!")
