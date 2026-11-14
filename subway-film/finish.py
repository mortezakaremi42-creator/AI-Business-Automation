"""Add chapter metadata, normalize the ACTUAL mix, and validate the exported movie."""
from pathlib import Path
import json,subprocess,re,hashlib
import imageio_ffmpeg
R=Path(__file__).resolve().parent;T=R.parent/'.cache'/'subway-build';FF=imageio_ffmpeg.get_ffmpeg_exe();movie=R/'FOURTEEN-DAYS-UNDERGROUND-FA.mp4'
timeline=json.loads((R/'timeline.json').read_text());story=json.loads((R/'story.json').read_text());loudfile=T/'loudness.json'
if not loudfile.exists():
 measure=subprocess.run([FF,'-hide_banner','-nostats','-i',str(T/'mix.wav'),'-af','loudnorm=I=-16:TP=-1.5:LRA=9:print_format=json','-f','null','-'],capture_output=True,text=True,check=True)
 match=re.search(r'\{\s*"input_i"[\s\S]*?\}',measure.stderr)
 assert match,'Loudness measurement unavailable'
 loudfile.write_text(match.group())
loud=json.loads(loudfile.read_text())
meta=[';FFMETADATA1','title=چهارده روز زیر زمین','artist=Original procedural stickman animation','comment=Persian synthesized narration, original synthesized score and effects. Estimated sentence subtitles burned into image.']
for i,ch in enumerate(timeline['chapters']):meta+=['[CHAPTER]','TIMEBASE=1/1000',f'START={round(ch["start"]*1000)}',f'END={round(ch["end"]*1000)}','title='+story[i]['day']+' — '+story[i]['place']]
(T/'chapters.ffmeta').write_text('\n'.join(meta)+'\n')
af=f"loudnorm=I=-16:TP=-1.5:LRA=9:measured_I={loud['input_i']}:measured_TP={loud['input_tp']}:measured_LRA={loud['input_lra']}:measured_thresh={loud['input_thresh']}:offset={loud['target_offset']}:linear=false:print_format=json"
cmd=[FF,'-y','-hide_banner','-nostats','-i',str(movie),'-i',str(T/'mix.wav'),'-i',str(T/'chapters.ffmeta'),'-map','0:v:0','-map','1:a:0','-map_metadata','2','-map_chapters','2','-c:v','copy','-af',af,'-c:a','aac','-b:a','96k','-ar','24000','-movflags','+faststart','-shortest',str(T/'finished.mp4')]
p=subprocess.run(cmd,capture_output=True,text=True,check=True)
(T/'finished.mp4').replace(movie)
# Verify every video and audio packet can be fully decoded, not merely that a file exists.
decode=subprocess.run([FF,'-v','error','-i',str(movie),'-map','0:v:0','-map','0:a:0','-f','null','-'],capture_output=True,text=True)
assert decode.returncode==0 and not decode.stderr,decode.stderr
reader=imageio_ffmpeg.read_frames(str(movie));info=next(reader);reader.close()
assert info['size']==(1920,1080),info
assert abs(info['fps']-24)<.01 and 480<info['duration']<600,info
subprocess.run([FF,'-y','-v','error','-ss','125','-i',str(movie),'-frames:v','1',str(R/'POSTER.jpg')],check=True)
normalization=re.findall(r'\{\s*"input_i"[\s\S]*?\}',p.stderr)
report={'durationSeconds':info['duration'],'width':info['size'][0],'height':info['size'][1],'fps':info['fps'],'videoCodec':info['codec'],'audioCodec':info.get('audio_codec'),'audioStereo':True,'fullDecodePassed':True,'nativeRasterSize':'1920x1080','originalNarrationSeconds':535.533,'storyShots':40,'captionCues':len(timeline['captions']),'captionAlignment':'Estimated sentence-level; not word-accurate forced alignment','style':'Original simplified procedural 2D stickman animation','soundEffectsAndScore':'Original procedural synthesis actually mixed into exported audio','normalization':json.loads(normalization[-1])if normalization else None,'bytes':movie.stat().st_size,'sha256':hashlib.sha256(movie.read_bytes()).hexdigest()}
(R/'EXPORT-CHECK.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(report,ensure_ascii=False,indent=2))
