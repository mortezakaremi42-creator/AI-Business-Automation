#!/usr/bin/env python3
"""Build: Prophet Noah Documentary - ENHANCED with motion effects"""

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
    ("scene01-hook.jpg", "audio/scene01.mp3", "zoom_in"),      # Hook - dramatic zoom in
    ("scene02-noah.jpg", "audio/scene02.mp3", "zoom_out"),     # Noah reveal - zoom out
    ("scene03-invitation.jpg", "audio/scene03.mp3", "pan_right"),  # Invitation - pan right
    ("scene04-rejection.jpg", "audio/scene04.mp3", "pan_left"),    # Rejection - pan left
    ("scene05-command.jpg", "audio/scene05.mp3", "zoom_in"),       # Divine command - zoom in
    ("scene06-building.jpg", "audio/scene06.mp3", "pan_right"),    # Building ark - pan right
    ("scene07-mockery.jpg", "audio/scene07.mp3", "zoom_out"),      # Mockery - zoom out
    ("scene08-storm.jpg", "audio/scene08.mp3", "zoom_in"),         # Storm - dramatic zoom in
    ("scene09-boarding.jpg", "audio/scene09.mp3", "pan_right"),    # Boarding - pan right
    ("scene10-son.jpg", "audio/scene10.mp3", "zoom_out"),          # Son refusal - zoom out
    ("scene11-flood.jpg", "audio/scene11.mp3", "zoom_in"),         # Flood - dramatic zoom in
    ("scene12-ark-sailing.jpg", "audio/scene12.mp3", "pan_left"),  # Ark sailing - pan left
    ("scene13-calm.jpg", "audio/scene13.mp3", "zoom_out"),         # Calm - zoom out
    ("scene14-mountain.jpg", "audio/scene14.mp3", "pan_right"),    # Mountain - pan right
    ("scene15-ending.jpg", "audio/scene15.mp3", "zoom_in"),        # Ending - zoom in
]

scenes = []
for img, audio, effect in scenes_data:
    audio_dur = get_duration(f"{OUTPUT_DIR}/{audio}")
    scene_dur = int(audio_dur) + 12
    scenes.append((img, audio, scene_dur, effect))
    print(f"  {img}: narration={audio_dur:.1f}s -> scene={scene_dur}s ({effect})")

total_duration = sum(s[2] for s in scenes)
print(f"\n🎬 Total duration: {total_duration}s ({total_duration//60}m {total_duration%60}s)\n")

os.makedirs(f"{OUTPUT_DIR}/temp", exist_ok=True)

# Motion effect parameters
motion_effects = {
    "zoom_in": {
        "z": "min(zoom+0.0015,1.30)",  # Zoom from 1.0 to 1.30
        "x": "iw/2-(iw/zoom/2)",
        "y": "ih/2-(ih/zoom/2)"
    },
    "zoom_out": {
        "z": "1.30-(0.30*on/{frames})",  # Zoom from 1.30 to 1.0
        "x": "iw/2-(iw/zoom/2)",
        "y": "ih/2-(ih/zoom/2)"
    },
    "pan_right": {
        "z": "1.20",  # Fixed zoom
        "x": "(iw/zoom/2)*0.25*on/{frames}",  # Pan left to right
        "y": "ih/2-(ih/zoom/2)"
    },
    "pan_left": {
        "z": "1.20",  # Fixed zoom
        "x": "iw/zoom-(iw/zoom/2)*0.25*on/{frames}",  # Pan right to left
        "y": "ih/2-(ih/zoom/2)"
    }
}

for i, (img, audio, duration, effect) in enumerate(scenes, 1):
    print(f"Scene {i}: {duration}s - {img} ({effect})")
    frames = duration * 24
    
    # Get motion parameters
    motion = motion_effects[effect]
    z_expr = motion["z"].format(frames=frames)
    x_expr = motion["x"].format(frames=frames)
    y_expr = motion["y"].format(frames=frames)
    
    # Build video filter with motion
    vf = (
        f"scale=1920:1080:force_original_aspect_ratio=decrease,"
        f"pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black,"
        f"zoompan=z='{z_expr}':x='{x_expr}':y='{y_expr}':d={frames}:s=1280x720:fps=24,"
        f"fade=in:0:15,fade=out:st={duration-1.5}:d=1.5,"
        f"format=yuv420p"
    )
    
    subprocess.run([
        FFMPEG, "-y", "-loop", "1", "-i", f"{OUTPUT_DIR}/{img}",
        "-vf", vf, "-t", str(duration),
        "-c:v", "libx264", "-r", "24", "-pix_fmt", "yuv420p",
        "-profile:v", "baseline", "-level", "3.0",
        f"{OUTPUT_DIR}/temp/scene{i:02d}.mp4"
    ], capture_output=True)

print("\n✅ All scenes created with enhanced motion")

# Concat scenes
with open(f"{OUTPUT_DIR}/temp/video_concat.txt", 'w') as f:
    for i in range(1, len(scenes) + 1):
        f.write(f"file 'scene{i:02d}.mp4'\n")

subprocess.run([
    FFMPEG, "-y", "-f", "concat", "-safe", "0",
    "-i", f"{OUTPUT_DIR}/temp/video_concat.txt",
    "-c:v", "libx264", "-preset", "medium", "-crf", "20",
    f"{OUTPUT_DIR}/temp/video-only.mp4"
], capture_output=True, text=True)

# Concat narration audio
with open(f"{OUTPUT_DIR}/temp/audio_concat.txt", 'w') as f:
    for _, audio, _, _ in scenes:
        f.write(f"file '{OUTPUT_DIR}/{audio}'\n")

subprocess.run([
    FFMPEG, "-y", "-f", "concat", "-safe", "0",
    "-i", f"{OUTPUT_DIR}/temp/audio_concat.txt",
    "-c:a", "aac", "-b:a", "128k",
    f"{OUTPUT_DIR}/temp/narration.aac"
], capture_output=True, text=True)

print("🎵 Mixing narration + music...")

# Mix narration + music
result = subprocess.run([
    FFMPEG, "-y",
    "-i", f"{OUTPUT_DIR}/temp/video-only.mp4",
    "-i", f"{OUTPUT_DIR}/temp/narration.aac",
    "-stream_loop", "-1", "-i", f"{OUTPUT_DIR}/audio/music.mp3",
    "-filter_complex",
    f"[1:a]volume=1.2[narration];"
    f"[2:a]atrim=0:{total_duration},volume=0.18,afade=in:st=0:d=2,afade=out:st={total_duration-3}:d=3[music];"
    f"[narration][music]amix=inputs=2:duration=longest:dropout_transition=2[audio]",
    "-map", "0:v", "-map", "[audio]",
    "-c:v", "libx264", "-preset", "medium", "-crf", "20",
    "-c:a", "aac", "-b:a", "192k",
    "-t", str(total_duration),
    "-movflags", "+faststart",
    f"{OUTPUT_DIR}/prophet-noah-enhanced.mp4"
], capture_output=True, text=True)

if result.returncode == 0:
    print("✅ Enhanced video ready!\n")
    info = subprocess.run([FFMPEG, "-i", f"{OUTPUT_DIR}/prophet-noah-enhanced.mp4"], capture_output=True, text=True)
    for line in info.stderr.split('\n'):
        if 'Duration' in line or 'Stream' in line:
            print(line.strip())
    size = os.path.getsize(f"{OUTPUT_DIR}/prophet-noah-enhanced.mp4")
    print(f"\n💾 Size: {size / (1024*1024):.2f} MB")
else:
    print(f"❌ Error:\n{result.stderr[-2000:]}")

# Clean temp
subprocess.run(["rm", "-rf", f"{OUTPUT_DIR}/temp"])
print("\n✅ Done!")
