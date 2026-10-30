#!/bin/bash
# ساخت ویدیو تبلیغاتی NFT - PixelRoyals (2 دقیقه)

FFMPEG="/home/user/AI-Business-Automation/shorts/node_modules/@ffmpeg-installer/linux-x64/ffmpeg"
OUTPUT_DIR="/home/user/AI-Business-Automation/shorts/nft-ad"
OUTPUT_FILE="$OUTPUT_DIR/nft-ad-video.mp4"
TEMP_DIR="$OUTPUT_DIR/temp_nft"

echo "🎨 ساخت ویدیو تبلیغاتی NFT: PixelRoyals..."

mkdir -p "$TEMP_DIR"

# Convert images to videos (timings for 2-minute video)
echo "📸 تبدیل تصاویر..."

# Scene 1: Hook (15 sec)
$FFMPEG -y -loop 1 -i "$OUTPUT_DIR/scene1-hook.jpg" \
  -c:v libx264 -t 15 -pix_fmt yuv420p \
  -vf "scale=540:960:force_original_aspect_ratio=decrease,pad=540:960:(ow-iw)/2:(oh-ih)/2" \
  -r 24 "$TEMP_DIR/scene1.mp4" 2>/dev/null
echo "  ✅ صحنه 1 (Hook - 15s)"

# Scene 2: Intro (20 sec)
$FFMPEG -y -loop 1 -i "$OUTPUT_DIR/scene2-intro.jpg" \
  -c:v libx264 -t 20 -pix_fmt yuv420p \
  -vf "scale=540:960:force_original_aspect_ratio=decrease,pad=540:960:(ow-iw)/2:(oh-ih)/2" \
  -r 24 "$TEMP_DIR/scene2.mp4" 2>/dev/null
echo "  ✅ صحنه 2 (معرفی - 20s)"

# Scene 3: King (15 sec)
$FFMPEG -y -loop 1 -i "$OUTPUT_DIR/scene3-king.jpg" \
  -c:v libx264 -t 15 -pix_fmt yuv420p \
  -vf "scale=540:960:force_original_aspect_ratio=decrease,pad=540:960:(ow-iw)/2:(oh-ih)/2" \
  -r 24 "$TEMP_DIR/scene3.mp4" 2>/dev/null
echo "  ✅ صحنه 3 (King - 15s)"

# Scene 4: Queen (15 sec)
$FFMPEG -y -loop 1 -i "$OUTPUT_DIR/scene4-queen.jpg" \
  -c:v libx264 -t 15 -pix_fmt yuv420p \
  -vf "scale=540:960:force_original_aspect_ratio=decrease,pad=540:960:(ow-iw)/2:(oh-ih)/2" \
  -r 24 "$TEMP_DIR/scene4.mp4" 2>/dev/null
echo "  ✅ صحنه 4 (Queen - 15s)"

# Scene 5: Sakura (15 sec)
$FFMPEG -y -loop 1 -i "$OUTPUT_DIR/scene5-sakura.jpg" \
  -c:v libx264 -t 15 -pix_fmt yuv420p \
  -vf "scale=540:960:force_original_aspect_ratio=decrease,pad=540:960:(ow-iw)/2:(oh-ih)/2" \
  -r 24 "$TEMP_DIR/scene5.mp4" 2>/dev/null
echo "  ✅ صحنه 5 (Sakura - 15s)"

# Scene 6: Penguin (10 sec)
$FFMPEG -y -loop 1 -i "$OUTPUT_DIR/scene6-penguin.jpg" \
  -c:v libx264 -t 10 -pix_fmt yuv420p \
  -vf "scale=540:960:force_original_aspect_ratio=decrease,pad=540:960:(ow-iw)/2:(oh-ih)/2" \
  -r 24 "$TEMP_DIR/scene6.mp4" 2>/dev/null
echo "  ✅ صحنه 6 (Penguin - 10s)"

# Scene 7: Collection (20 sec)
$FFMPEG -y -loop 1 -i "$OUTPUT_DIR/scene7-collection.jpg" \
  -c:v libx264 -t 20 -pix_fmt yuv420p \
  -vf "scale=540:960:force_original_aspect_ratio=decrease,pad=540:960:(ow-iw)/2:(oh-ih)/2" \
  -r 24 "$TEMP_DIR/scene7.mp4" 2>/dev/null
echo "  ✅ صحنه 7 (Collection - 20s)"

# Scene 8: CTA (10 sec)
$FFMPEG -y -loop 1 -i "$OUTPUT_DIR/scene8-cta.jpg" \
  -c:v libx264 -t 10 -pix_fmt yuv420p \
  -vf "scale=540:960:force_original_aspect_ratio=decrease,pad=540:960:(ow-iw)/2:(oh-ih)/2" \
  -r 24 "$TEMP_DIR/scene8.mp4" 2>/dev/null
echo "  ✅ صحنه 8 (CTA - 10s)"

# Concat videos
echo "🎞️ ترکیب ویدیوها..."
cat > "$TEMP_DIR/concat.txt" << EOF
file 'scene1.mp4'
file 'scene2.mp4'
file 'scene3.mp4'
file 'scene4.mp4'
file 'scene5.mp4'
file 'scene6.mp4'
file 'scene7.mp4'
file 'scene8.mp4'
EOF

$FFMPEG -y -f concat -safe 0 -i "$TEMP_DIR/concat.txt" \
  -c copy "$OUTPUT_FILE" 2>/dev/null

# Concat audio
echo "🔊 ترکیب صداها..."
cat > "$TEMP_DIR/audio-concat.txt" << EOF
file '$OUTPUT_DIR/audio/scene1.mp3'
file '$OUTPUT_DIR/audio/scene2.mp3'
file '$OUTPUT_DIR/audio/scene3.mp3'
file '$OUTPUT_DIR/audio/scene4.mp3'
file '$OUTPUT_DIR/audio/scene5.mp3'
file '$OUTPUT_DIR/audio/scene6.mp3'
file '$OUTPUT_DIR/audio/scene7.mp3'
file '$OUTPUT_DIR/audio/scene8.mp3'
EOF

$FFMPEG -y -f concat -safe 0 -i "$TEMP_DIR/audio-concat.txt" \
  -c copy "$TEMP_DIR/combined.mp3" 2>/dev/null

# Merge video + audio with web-compatible settings
echo "🎬 اضافه کردن صدا..."
$FFMPEG -y \
  -i "$OUTPUT_FILE" \
  -i "$TEMP_DIR/combined.mp3" \
  -c:v libx264 -profile:v baseline -level 3.0 \
  -pix_fmt yuv420p \
  -movflags +faststart \
  -c:a aac -b:a 128k -ar 44100 \
  -preset fast -crf 23 \
  -shortest \
  "$OUTPUT_DIR/nft-ad-final.mp4" 2>/dev/null

# Cleanup
rm -rf "$TEMP_DIR"
rm -f "$OUTPUT_FILE"

if [ -f "$OUTPUT_DIR/nft-ad-final.mp4" ]; then
  echo ""
  echo "✅ ویدیو تبلیغاتی NFT ساخته شد!"
  echo "📁 فایل: $OUTPUT_DIR/nft-ad-final.mp4"
  ls -lh "$OUTPUT_DIR/nft-ad-final.mp4"
  echo ""
  echo "📊 مشخصات:"
  echo "  مدت: ۲ دقیقه"
  echo "  کیفیت: HD 540x960 (9:16)"
  echo "  فرمت: MP4 (سازگار با Twitter/X)"
  echo "  مناسب برای: Twitter/X, Instagram, TikTok"
else
  echo "❌ خطا!"
  exit 1
fi
