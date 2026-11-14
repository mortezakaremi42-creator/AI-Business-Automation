"""Original 2D procedural film: actual selected Persian voice, 40 distinct shots,
animated actors/props, sentence-level estimated captions, original synthesized sound.
No external footage. Build intermediates go to excluded .cache, not the deliverable.
"""
import os, json, math, random, re, wave, subprocess, bisect, sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageEnhance
import arabic_reshaper
from bidi.algorithm import get_display
import imageio_ffmpeg
ROOT=Path(__file__).resolve().parent
TMP=ROOT.parent/'.cache'/'subway-build';TMP.mkdir(parents=True,exist_ok=True)
FF=imageio_ffmpeg.get_ffmpeg_exe()
W,H=1920,1080;S=2;FPS=24;SR=24000
FONT='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
FONTS={n:ImageFont.truetype(FONT,n*S)for n in [11,13,15,17,18,20,24,28,32,40]}
story=json.loads((ROOT/'story.json').read_text())
markers=[['آخرین قطار','او از پله','روز اول','آرمان بطری'],['روز دوم','او نیمکت','کنار گیشه','آن شب'],['روز سوم','او در را','رها کف','رها جرعه'],['روز چهارم','آرمان یک قوطی','درِ انبار','چند کنسرو'],['روز ششم','آرمان می‌خواست','بعد، دریچه','درست وقتی'],['روز هفتم','آن‌ها میان','رها به دریچه','رها دریچه'],['روز هشتم','رها چراغ','آرمان باتری','صدای خش'],['روز نهم','روز دهم','رها روی نقشه','آرمان چراغ'],['روز یازدهم','روز دوازدهم','آن سوی پیچ','آن‌ها دویدند'],['روز چهاردهم','پشت در','درِ واگن','مرد سرش']]
def fa(s):return get_display(arabic_reshaper.reshape(s))
def read_audio(p):
 with wave.open(str(p))as w:
  a=np.frombuffer(w.readframes(w.getnframes()),dtype='<i2').astype(np.float32)/32768
  if w.getnchannels()>1:a=a.reshape(-1,w.getnchannels()).mean(axis=1)
  rate=w.getframerate()
  return np.interp(np.arange(round(len(a)*SR/rate))*rate/SR,np.arange(len(a)),a).astype(np.float32)
# Sentence boundaries estimated from text lengths, snapped to measured speech pauses.
chapters=[];captions=[];shots=[];cursor=0
for i,st in enumerate(story):
 a=read_audio(ROOT/'audio'/f'{i+1:02d}.wav');dur=len(a)/SR
 hop=480;rms=np.sqrt(np.mean(np.pad(a,(0,(-len(a))%hop)).reshape(-1,hop)**2,axis=1))
 silent=rms<max(.009,float(rms.max())*.025);pauses=[];start=None
 for j,v in enumerate(silent):
  if v and start is None:start=j
  if not v and start is not None:
   if j-start>=7:pauses.append((j+start)*hop/(2*SR))
   start=None
 matches=list(re.finditer(r'[^.؟؛]+[.؟؛]?',st['text']));bounds=[0.]
 for m in matches[:-1]:
  target=dur*m.end()/len(st['text'])
  choices=[p for p in pauses if bounds[-1]+.45<p<dur-.4 and abs(p-target)<1.6]
  bounds.append(min(choices,key=lambda p:abs(p-target))if choices else max(bounds[-1]+.2,target))
 bounds.append(dur)
 def char_time(c):
  for j,m in enumerate(matches):
   if c<m.end():return bounds[j]+(bounds[j+1]-bounds[j])*max(0,c-m.start())/max(1,m.end()-m.start())
  return dur
 for j,m in enumerate(matches):captions.append({'start':cursor+bounds[j],'end':cursor+bounds[j+1],'text':m.group().strip(),'chapter':i})
 cut=[char_time(st['text'].index(marker))for marker in markers[i]]+[dur+1.0]
 cut[0]=0
 for k,((env,act),lo,hi)in enumerate(zip(st['beats'],cut,cut[1:])):shots.append({'start':cursor+lo,'end':cursor+hi,'chapter':i,'shot':k,'env':env,'act':act})
 chapters.append({'start':cursor,'end':cursor+dur+1,'audioEnd':cursor+dur,'audio':a,'index':i})
 cursor+=dur+1
DURATION=cursor
print('Film duration',DURATION,'seconds; frames',round(DURATION*FPS),flush=True)
(ROOT/'timeline.json').write_text(json.dumps({'duration':DURATION,'fps':FPS,'chapters':[{k:v for k,v in ch.items()if k!='audio'}for ch in chapters],'shots':shots,'captions':captions,'caption_alignment':'estimated sentence timing snapped to acoustic pauses; not word-for-word forced alignment'},ensure_ascii=False,indent=2))
def stamp(t):
 ms=round(t*1000);return f'{ms//3600000:02d}:{ms//60000%60:02d}:{ms//1000%60:02d},{ms%1000:03d}'
(ROOT/'SUBTITLES-FA.srt').write_text('\n\n'.join(f'{j+1}\n{stamp(c["start"])} --> {stamp(c["end"])}\n{c["text"]}'for j,c in enumerate(captions))+'\n',encoding='utf-8')
# Audio at 24 kHz stereo; all intermediate PCM is kept outside deliverables.
N=round(DURATION*SR);mix=np.zeros((N,2),np.float32);voice=np.zeros(N,np.float32)
for ch in chapters:
 p=round(ch['start']*SR);voice[p:p+len(ch['audio'])]=ch['audio']*.87
rng=np.random.default_rng(14)
def add(t,x,gain=1,pan=0):
 p=round(t*SR)
 if p<0:x=x[-p:];p=0
 n=min(len(x),N-p)
 if n<=0:return
 mix[p:p+n,0]+=x[:n]*gain*math.sqrt((1-pan)*.5);mix[p:p+n,1]+=x[:n]*gain*math.sqrt((1+pan)*.5)
def effect(t,kind,amp=.18,pan=0):
 dur={'step':.16,'growl':1.5,'metal':1.2,'break':.7,'glass':1.2,'radio':1.8,'beep':.22,'knock':.23,'water':.6}[kind]
 q=np.arange(round(dur*SR),dtype=np.float32)/SR;noise=rng.standard_normal(len(q)).astype(np.float32)
 if kind=='step':x=(np.sin(2*np.pi*(90*q-100*q*q))+noise*.3)*np.exp(-q*35)
 elif kind=='growl':x=(np.sin(2*np.pi*(72*q+3*np.sin(q*6)))+.4*np.sin(2*np.pi*145*q)+noise*.2)*(np.sin(np.pi*q/dur)**.7)*(.6+.4*np.sin(2*np.pi*q*19))
 elif kind=='metal':x=sum(np.sin(2*np.pi*f*q)*np.exp(-q*r)for f,r in [(143,4),(381,6),(869,8),(1401,12)])/3
 elif kind=='break':x=(noise*.65+np.sin(2*np.pi*68*q))*np.exp(-q*8)
 elif kind=='glass':x=(noise*.5+np.sin(2*np.pi*2187*q)*np.sin(2*np.pi*1743*q))*np.exp(-q*7)
 elif kind=='radio':x=noise*(.3+.7*(np.sin(q*56)>0))*np.sin(np.pi*q/dur)**2*.4
 elif kind=='beep':x=np.sin(2*np.pi*680*q)*np.sin(np.pi*q/dur)**2
 elif kind=='water':x=np.sin(2*np.pi*(900*q+20*np.sin(q*24)))*np.exp(-q*5)*.6
 else:x=(np.sin(2*np.pi*180*q)+noise*.3)*np.exp(-q*28)
 add(t,x.astype(np.float32),amp,pan)
# Score: original minor-key drones, slow changing pads, low pulse under narration.
for ch in chapters:
 i=ch['index'];dur=ch['end']-ch['start'];q=np.arange(round(dur*SR),dtype=np.float32)/SR
 base=[55,49,58.27,51.91,49,46.25,55,58.27,49,55][i]
 pad=np.zeros(len(q),np.float32)
 for sem in [0,7,12,15]:
  f=base*2**(sem/12);pad+=(np.sin(q*2*np.pi*f)+.2*np.sin(q*2*np.pi*f*2.003))*.011
 pad*=np.minimum(1,q/2)*np.minimum(1,(dur-q)/2)
 add(ch['start'],pad,1,(-.15 if i%2 else .15))
 pulse=np.sin(q*2*np.pi*base/2)*np.maximum(0,np.sin(q*np.pi*(1.4 if i in [5,8,9]else .65)))**10*.025
 add(ch['start'],pulse)
 # Wind / ventilation is synthesized, not claimed as recorded Foley.
 air=rng.standard_normal(len(q)).astype(np.float32);air=np.convolve(air,np.ones(28,np.float32)/28,mode='same')*.025
 add(ch['start'],air,1,-.3)
for sh in shots:
 a,b,act=sh['start'],sh['end'],sh['act'];dur=b-a
 if act in ['outbreak','descend','walk','journey','white','arrival','ascend','chase','escape','shatter','distract']:
  interval=.29 if act in ['outbreak','chase','escape','shatter']else .53
  for t in np.arange(a+.2,b-.1,interval):effect(t,'step',.14 if interval<.4 else .09,math.sin(t)*.3)
 if act in ['outbreak','observe','rattle','crack','breach','chase','freeze','balance','cliffhanger']:
  for t in np.arange(a+1,b,4.7):effect(t,'growl',.08 if act not in ['breach','cliffhanger']else .16,.5)
 if act in ['rattle','knock']:
  for group in [a+1,a+dur*.6]:
   for j in range(3):effect(group+j*.55,'knock',.2,-.5)
 if act in ['open','unscrew','barricade','seal','van','escape']:effect(a+dur*.45,'metal',.22)
 if act=='breach':effect(a+.4,'break',.5);effect(a+1.1,'metal',.3)
 if act=='shatter':effect(a+dur*.38,'glass',.35)
 if act in ['connect','message','warning','van']:effect(a+1,'radio',.12);effect(a+dur*.6,'beep',.11)
 if act in ['meet','ration','supplies']:effect(a+dur*.6,'water',.08)
 if act=='balance':effect(a+dur*.68,'break',.2)
 if act=='cliffhanger':effect(b-3.8,'growl',.35);effect(b-1.2,'metal',.32)
# Duck designed soundtrack under measured voice RMS, then add intelligible narration.
hop=480;env=np.sqrt(np.mean(np.pad(voice,(0,(-N)%hop)).reshape(-1,hop)**2,axis=1));duck=np.interp(np.arange(N)/hop,np.arange(len(env)),np.clip(1-env*4,.36,1)).astype(np.float32)
mix*=duck[:,None];mix+=voice[:,None]*.90
peak=float(np.max(np.abs(mix)));mix*=min(1,.93/max(peak,1e-9))
with wave.open(str(TMP/'mix.wav'),'wb')as w:w.setnchannels(2);w.setsampwidth(2);w.setframerate(SR);w.writeframes((np.clip(mix,-1,1)*32767).astype('<i2').tobytes())
del mix,voice,duck
# Drawing utilities in logical 960x540 coordinates, native 1920x1080 output.
def xy(p):return tuple(int(v*S)for v in p)
def rect(d,b,fill,outline=None,width=1):d.rectangle(xy(b),fill=fill,outline=outline,width=max(1,int(width*S)))
def ellipse(d,b,fill,outline=None,width=1):d.ellipse(xy(b),fill=fill,outline=outline,width=max(1,int(width*S)))
def line(d,pts,fill,width=1):d.line([xy(p)for p in pts],fill=fill,width=max(1,int(width*S)),joint='curve')
def poly(d,pts,fill):d.polygon([xy(p)for p in pts],fill=fill)
def text(d,p,s,size=17,fill='#d7dedb',anchor='mm',rtl=True):d.text(xy(p),fa(s)if rtl else s,font=FONTS[size],fill=fill,anchor=anchor)
def rounded(d,b,fill,r=8,outline=None):d.rounded_rectangle(xy(b),radius=int(r*S),fill=fill,outline=outline,width=2*S)
BG={}
def background(env,ch,k):
 key=(env,ch,k)
 if key in BG:return BG[key].copy()
 im=Image.new('RGB',(W,H));d=ImageDraw.Draw(im)
 palettes=[('#142431','#263d46','#354650'),('#162327','#32494b','#3d4848'),('#18242c','#34434a','#3a464b'),('#162633','#2b424d','#38434b'),('#1c2129','#343d42','#3f4241'),('#271d29','#3f353e','#3a3e43'),('#12292c','#2c494b','#37494a'),('#202a31','#3e4748','#414749'),('#111d2c','#283744','#303d44'),('#675560','#bd967c','#5a6261')]
 sky,wall,floor=palettes[ch]
 for y in range(H):
  f=y/H;rgb=tuple(int(int(sky[j:j+2],16)*(1-f)+int(wall[j:j+2],16)*f)for j in [1,3,5]);d.line([(0,y),(W,y)],fill=rgb)
 if env=='city':
  rr=random.Random(4)
  for n in range(18):
   x=n*62-50;h=rr.randint(100,310);rect(d,(x,400-h,x+58,400),'#192431')
   for xx in range(x+6,x+50,14):
    for yy in range(420-h,390,28):rect(d,(xx,yy,xx+6,yy+12),'#685c4c'if rr.random()>.4 else '#202f3b')
  rect(d,(0,400,960,540),'#27343c');line(d,[(0,450),(960,450)],'#81918b',2)
  for x in [90,340,680,870]:rounded(d,(x,380,x+115,420),'#364d57',12);rect(d,(x+24,362,x+80,389),'#57747a');ellipse(d,(x+13,406,x+35,428),'#111a22');ellipse(d,(x+85,406,x+106,428),'#111a22')
  rounded(d,(570,345,850,388),'#153a42',5);text(d,(710,365),'مترو • ایستگاه آخر',20)
 elif env in ['tunnel','fork','gap','service','firedoor']:
  rect(d,(0,280,960,540),floor)
  for i in range(11):
   off=i*27;d.arc(xy((110-off,20-off,850+off,620+off)),180,360,fill='#3a5059',width=7*S)
  poly(d,[(270,360),(690,360),(960,540),(0,540)],'#1b252e')
  for x in [320,640]:line(d,[(480+(x-480)*.2,350),(x,540)],'#a0a7a6',4)
  for y in range(360,540,24):line(d,[(300-(y-360)*1.6,y),(660+(y-360)*1.6,y)],'#40515b',4)
  rect(d,(400,172,560,352),'#080f18')
  for x in [75,870]:line(d,[(x,100),(x,430)],'#75918b',7);line(d,[(x+12,100),(x+12,430)],'#293e49',3)
  if env=='fork':poly(d,[(0,320),(300,220),(420,350),(100,540)],'#0b131d');poly(d,[(600,350),(690,220),(960,320),(850,540)],'#162b35');ellipse(d,(217,176,243,202),'#eb4b42');ellipse(d,(707,176,733,202),'#dff7f3');text(d,(230,148),'مسیر برق',15);text(d,(720,148),'خروج شمالی',15)
  if env=='gap':poly(d,[(260,410),(620,390),(780,540),(180,540)],'#050a12');line(d,[(160,420),(750,395)],'#819da0',11);line(d,[(160,418),(750,393)],'#c2c9bd',2)
  if env=='firedoor':rect(d,(700,160,850,425),'#203f47','#98aaa5',4);text(d,(775,195),'خروج شمالی',15);rect(d,(718,285,785,294),'#bbbbb0')
 elif env=='stairs':
  poly(d,[(0,100),(960,100),(780,540),(180,540)],'#223b45');rect(d,(310,90,650,220),'#0b151e'if ch<9 else '#d4b894')
  for i in range(13):y=230+i*20;half=150+i*13;rect(d,(480-half,y,480+half,y+13),'#52636a');rect(d,(480-half,y+13,480+half,y+20),'#283e49')
  line(d,[(255,220),(70,510)],'#a3b4b4',7);line(d,[(705,220),(890,510)],'#a3b4b4',7)
 elif env=='rescue':
  rect(d,(0,310,960,540),floor)
  for x in range(0,960,70):line(d,[(x,310),(x-150,540)],'#717b7a',1)
  for x,h in [(30,230),(140,280),(780,260),(870,210)]:rect(d,(x,310-h,x+70,310),'#5d6067');rect(d,(x+10,330-h,x+20,350-h),'#a29686')
  rect(d,(35,240,170,430),'#213b46','#617780',5);text(d,(103,260),'تونل',15);rect(d,(62,334,110,342),'#a9b2ad')
  ellipse(d,(365,120,455,210),'#dbc1a0')
  rounded(d,(540,215,920,445),'#a8b7b2',16,'#435b62');rect(d,(553,243,910,285),'#4d7d7c');text(d,(725,263),'امداد',24,'#f1e8d2');ellipse(d,(574,419,630,475),'#192a35');ellipse(d,(839,419,895,475),'#192a35');rect(d,(672,285,810,442),'#0b1824','#526b70',4)
 else:
  rect(d,(0,60,960,360),wall);rect(d,(0,360,960,540),floor)
  for y in range(70,360,38):line(d,[(0,y),(960,y)],'#49616a',1)
  for x in range(-25,990,64):line(d,[(x,65),(x,359)],'#415861',1)
  rect(d,(0,280,960,293),'#426e74');rect(d,(0,293,960,298),'#b79a65')
  for x in range(0,960,90):line(d,[(x,360),(x-130,540)],'#2c3c45',1)
  for y in [385,423,480]:line(d,[(0,y),(960,y)],'#526068',1)
  if env in ['platform','entrance','hatch']:
   rect(d,(0,437,960,540),'#16212c');line(d,[(0,451),(960,451)],'#9d8456',6);line(d,[(0,505),(960,505)],'#91a4a6',4)
   for x in range(10,960,70):line(d,[(x,485),(x+20,540)],'#354853',5)
   for x in [120,825]:rect(d,(x,90,x+46,437),'#263d49','#5c7378',2);rect(d,(x,330,x+46,355),'#af915c')
   rounded(d,(312,83,640,145),'#143c46',3);text(d,(475,105),'ایستگاه آخر',20);text(d,(475,130),'همهٔ قطارها لغو شده‌اند',13,'#debd87')
  if env in ['staff','entrance']:rect(d,(650,180,825,433),'#18303c','#81918b',3);rect(d,(666,200,810,255),'#101b25');text(d,(739,224),'کارکنان'if env=='staff'else'ورودی',17);rect(d,(668,330,707,338),'#a7b1aa')
  if env in ['camp','map']:rect(d,(80,160,240,320),'#18313b','#7c8c8b',3);text(d,(160,187),'گیشه',17);rect(d,(90,290,230,302),'#81948b');rect(d,(330,360,650,378),'#7a6951');line(d,[(360,378),(350,450)],'#242b30',8);line(d,[(620,378),(630,450)],'#242b30',8);poly(d,[(125,415),(285,415),(310,447),(112,447)],'#8a7b61')
  if env=='storage':
   for x in [160,600]:
    for y in [180,260,340]:rect(d,(x,y,x+185,y+9),'#667b7c');line(d,[(x,140),(x,420)],'#536969',6);line(d,[(x+185,140),(x+185,420)],'#536969',6)
    for y in [150,230,310]:
     for dx in range(15,160,38):rounded(d,(x+dx,y,x+dx+25,y+30),'#9a8b65',3);rect(d,(x+dx,y+13,x+dx+25,y+20),'#426b6b')
   rect(d,(395,160,560,410),'#101a23','#596b70',4)
  if env in ['medical','radio']:
   rounded(d,(120,345,360,385),'#a2aba0',6);line(d,[(145,385),(140,433)],'#5a777c',7);line(d,[(340,385),(345,433)],'#5a777c',7);rounded(d,(125,318,183,345),'#ced2ba',9)
   rounded(d,(700,180,790,245),'#ced4be',3);rect(d,(734,192,750,232),'#986b63');rect(d,(720,204,765,220),'#986b63')
   rect(d,(410,355,700,373),'#726c58');line(d,[(435,373),(430,435)],'#293c43',8);line(d,[(675,373),(680,435)],'#293c43',8)
   rect(d,(120,120,240,220),'#243d46','#728983',3);text(d,(180,145),'برق اضطراری',11)
  # pipes, vents, posters, grime and scattered debris make each location detailed.
  line(d,[(0,57),(960,57)],'#587279',9);line(d,[(0,70),(960,70)],'#1e303e',4)
  for x in [270,875]:rounded(d,(x,170,x+48,230),'#20303b',2);[line(d,[(x+4,y),(x+43,y)],'#536b71',1)for y in range(177,225,6)]
 for n in range(24):
  rr=random.Random(ch*500+k*30+n);x=rr.randint(0,960);y=rr.randint(390,480);poly(d,[(x,y),(x+rr.randint(2,13),y-4),(x+20,y+3)],'#566269')
 if env not in ['city','rescue','stairs']:
  for x in [235,690]:rect(d,(x,50,x+95,57),'#bbc8b2');poly(d,[(x-30,60),(x+125,60),(x+190,400),(x-90,400)],'#40565a') if False else None
 # dark edge vignetting baked into backgrounds
 overlay=Image.new('RGBA',(W,H));od=ImageDraw.Draw(overlay)
 for j in range(22):od.rectangle((j*5,j*3,W-j*5,H-j*3),outline=(0,4,12,3),width=10)
 im=Image.alpha_composite(im.convert('RGBA'),overlay).convert('RGB');BG[key]=im
 return im.copy()

def joint(d,p,r,col):ellipse(d,(p[0]-r,p[1]-r,p[0]+r,p[1]+r),col)
def person(d,x,y,scale=1,kind='hero',motion='stand',phase=0,target=None,look=1,pack=True,reveal=False):
 moving=motion in ['walk','run','sneak','balance'];run=motion=='run';stride=(25 if run else 15)*scale if moving else 0
 bob=(abs(math.sin(phase*2))*2 if moving else math.sin(phase*.5)*.7)*scale
 crouch=28*scale if motion in ['crouch','crawl']else 0
 y+=bob;head=(x+(9*scale if run else 0),y-137*scale+crouch);hip=(x,y-62*scale+crouch*.45);shoulder=(head[0],head[1]+35*scale)
 col='#10141b'if kind!='zombie'else'#171724'
 ellipse(d,(x-35*scale,y-3,x+35*scale,y+9),'#1b2830')
 if pack and kind=='hero':rounded(d,(x-28*scale,head[1]+27*scale,x-4*scale,hip[1]+7*scale),'#737977',5*scale,'#252e33');line(d,[(x-22*scale,head[1]+38*scale),(x+8*scale,head[1]+68*scale)],'#c0bfb0',3*scale)
 for sign in [-1,1]:
  swing=math.sin(phase+(0 if sign==1 else math.pi))*stride;foot=(x+swing,y-max(0,math.cos(phase+(0 if sign==1 else math.pi)))*stride*.3)
  if motion=='crawl':foot=(x-40*scale+sign*14*scale,y)
  knee=((hip[0]+foot[0])/2+sign*6*scale,(hip[1]+foot[1])/2-abs(swing)*.12)
  line(d,[hip,knee,foot],col,9*scale);joint(d,knee,4*scale,col);line(d,[(foot[0]-6*scale,foot[1]),(foot[0]+8*scale,foot[1])],col,7*scale)
 line(d,[hip,shoulder],col,12*scale)
 line(d,[(head[0],head[1]+17*scale),shoulder],col,8*scale)
 for sign in [-1,1]:
  sh=(shoulder[0]+sign*4*scale,shoulder[1]+3*scale)
  if target is not None and sign==look:hand=target
  elif kind=='zombie':hand=(sh[0]+look*42*scale,sh[1]+8*scale+math.sin(phase+sign)*5*scale)
  elif motion=='balance':hand=(sh[0]+sign*48*scale,sh[1]-13*scale+math.sin(phase)*4*scale)
  elif motion=='handsup':hand=(sh[0]+sign*37*scale,sh[1]-30*scale)
  elif motion in ['crouch','crawl']:hand=(sh[0]+look*30*scale,sh[1]+35*scale)
  else:hand=(sh[0]+sign*17*scale+(math.sin(phase+sign)*stride*.7 if moving else 0),sh[1]+43*scale-(15*scale if run else 0))
  elbow=((sh[0]+hand[0])/2+sign*9*scale,(sh[1]+hand[1])/2+12*scale)
  line(d,[sh,elbow,hand],col,7*scale);joint(d,hand,4*scale,col)
  if kind=='raha'and sign==-1:line(d,[(sh[0]*.6+elbow[0]*.4,sh[1]*.6+elbow[1]*.4),(sh[0]*.4+elbow[0]*.6,sh[1]*.4+elbow[1]*.6)],'#ecefe0',10*scale)
 r=20*scale;face='#dedfd1'if kind!='zombie'else'#4e4c54';ellipse(d,(head[0]-r,head[1]-r,head[0]+r,head[1]+r),face,col,3*scale)
 if kind=='raha':poly(d,[(head[0]-r,head[1]),(head[0]-r,head[1]-r*.7),(head[0]+r*.2,head[1]-r*1.13),(head[0]+r,head[1]-r*.5),(head[0]+r*.9,head[1]+r*.4),(head[0]+r*.55,head[1]-r*.5),(head[0]-r*.4,head[1]-r*.7)],'#161c22')
 if kind=='rescuer':rect(d,(head[0]-24*scale,head[1]-23*scale,head[0]+24*scale,head[1]-12*scale),'#c5c9ba');rect(d,(head[0]-4*scale,head[1]-22*scale,head[0]+4*scale,head[1]-13*scale),'#8f625d');line(d,[(shoulder[0]-8*scale,shoulder[1]+14*scale),(hip[0]+8*scale,hip[1]-8*scale)],'#abb9ad',6*scale)
 for dx in [-7,7]:
  p=(head[0]+dx*scale+look*2*scale,head[1]-1*scale)
  if kind=='zombie'or reveal:
   ellipse(d,(p[0]-7*scale,p[1]-6*scale,p[0]+7*scale,p[1]+6*scale),'#743344');ellipse(d,(p[0]-3*scale,p[1]-3*scale,p[0]+3*scale,p[1]+3*scale),'#ff5f64')
  else:ellipse(d,(p[0]-2.5*scale,p[1]-4*scale,p[0]+2.5*scale,p[1]+3*scale),'#101923')
 if kind=='zombie'or reveal:poly(d,[(head[0]-9*scale,head[1]+8*scale),(head[0]+9*scale,head[1]+7*scale),(head[0]+5*scale,head[1]+14*scale),(head[0]-4*scale,head[1]+12*scale)],'#171320')
 else:line(d,[(head[0]-4*scale,head[1]+10*scale),(head[0]+5*scale,head[1]+9*scale)],'#47504e',1.5*scale)

def bottle(d,x,y,level=.6):rounded(d,(x-7,y-28,x+7,y),'#abbeb9',3);rect(d,(x-5,y-25*level,x+5,y-2),'#488c9e');rect(d,(x-5,y-33,x+5,y-28),'#64798b')
def can(d,x,y):rounded(d,(x-9,y-20,x+9,y),'#b0a181',3);rect(d,(x-9,y-14,x+9,y-5),'#5c7878')
def radio(d,x,y,blink=0):rounded(d,(x,y,x+100,y+56),'#877b60',6,'#232d35');rect(d,(x+8,y+9,x+56,y+46),'#283d43');[line(d,[(x+12,y+j),(x+50,y+j)],'#5d6a62',1)for j in range(14,44,5)];rect(d,(x+64,y+10,x+91,y+22),'#92b399'if blink else'#424f43');ellipse(d,(x+70,y+30,x+86,y+46),'#25383e');line(d,[(x+85,y),(x+108,y-63)],'#a8b7b4',3)
def map_prop(d,x,y,progress=0):
 poly(d,[(x,y),(x+160,y-4),(x+150,y+75),(x-5,y+65)],'#c5b899')
 line(d,[(x+15,y+50),(x+55,y+28),(x+85,y+35),(x+140,y+12)],'#356771',3);line(d,[(x+80,y+35),(x+130,y+60)],'#93665e',3)
 for xx,yy in [(15,50),(55,28),(85,35),(140,12)]:ellipse(d,(x+xx-3,y+yy-3,x+xx+3,y+yy+3),'#f2e3bb')
 if progress:ellipse(d,(x+133,y+5,x+147,y+19),'#e9e5ce')
def bag(d,x,y):rounded(d,(x,y-45,x+35,y),'#727b74',7,'#1e2933');rect(d,(x+6,y-23,x+29,y-5),'#4a5b5b');line(d,[(x+7,y-43),(x+7,y-52),(x+28,y-52),(x+28,y-43)],'#171f29',4)
def debris(d,t,cx,cy,count=15):
 for j in range(count):
  ang=j*2.39;v=25+j%5*14;x=cx+math.cos(ang)*v*t;y=cy+math.sin(ang)*v*t+70*t*t;poly(d,[(x,y),(x+8,y-4),(x+12,y+5)],'#84918d')

# Caption surfaces are pre-rendered with actual Persian shaping and bidi ordering.
CAPS=[]
for c in captions:
 words=c['text'].split();lines=[];buf=''
 for w in words:
  test=(buf+' '+w).strip()
  if ImageDraw.Draw(Image.new('RGB',(2,2))).textlength(fa(test),font=FONTS[18])>W-180 and buf:lines.append(buf);buf=w
  else:buf=test
 if buf:lines.append(buf)
 lines=lines[:3];h=len(lines)*48+28;lay=Image.new('RGBA',(W,h),(0,0,0,0));dd=ImageDraw.Draw(lay);dd.rounded_rectangle((40,0,W-40,h),radius=12,fill=(4,11,20,226))
 for j,l in enumerate(lines):dd.text((W/2,12+j*48),fa(l),font=FONTS[18],fill='#f1f1df',anchor='mt')
 CAPS.append((lay,h))

def frame(t):
 si=max(0,min(len(shots)-1,bisect.bisect_right([s['start']for s in shots],t)-1));sh=shots[si];ch=sh['chapter'];k=sh['shot'];act=sh['act'];u=(t-sh['start'])/max(.1,sh['end']-sh['start']);u=min(1,max(0,u));local=t-sh['start'];env=sh['env'];im=background(env,ch,k);d=ImageDraw.Draw(im)
 phase=t*(12 if act in ['chase','escape','outbreak','shatter']else 6)
 pack=ch<5 or(ch==5 and(k<2 or(k==2 and u<=.35)));hy=436 if env not in ['city','rescue','tunnel','fork','gap','firedoor','service']else 460
 hx=400;rx=570;motion='stand';target=None;raha=ch>=2 and not(ch==2 and k<2)
 # Atmosphere: floating dust, swinging lights, emergency flicker and action sparks.
 for j in range(13):
  x=(j*87+t*(2+j%3))%1000-20;y=105+(j*37)%280+math.sin(t*.4+j)*11;ellipse(d,(x,y,x+1,y+1),'#71817f')
 if env not in ['city','rescue']:
  for x in [235,690]:rect(d,(x,50,x+95,57),'#dce1c7'if math.sin(t*3.1+x)>.96 else'#a2b19d')
 if act=='outbreak':
  hx=650-u*130;motion='run'
  for j in range(7):person(d,110+j*64+u*80,450+(j%2)*12,.65+(j%3)*.08,'zombie','run',phase+j,look=1,pack=False)
  # Last train slides away in the distant station opening while smoke rises in city.
  rect(d,(850+u*300,310,1170+u*300,359),'#57707a')
  for j in range(6):x=160+j*128;h=17+12*math.sin(t*9+j);poly(d,[(x,390),(x+12,390-h),(x+20,372),(x+30,390)],'#c88b54')
 elif act in ['descend','ascend']:
  motion='walk';hx=410+u*120;hy=(300+u*160)if act=='descend'else(460-u*100);rx=hx-90
  if act=='descend'and u>.68:rect(d,(310,90,650,220),'#29424d','#7c8e8b',3)
 elif act=='phone':
  target=(hx+35,hy-101);rounded(d,(hx+31,hy-121,hx+51,hy-87),'#101a22',3,'#738a89');text(d,(hx+41,hy-105),'×',13,'#cf7c71',rtl=False)
 elif act=='search':
  motion='crouch';bag(d,475,430);bottle(d,520,372,.4);line(d,[(460,360),(600,330),(600,398)],'#687b72',2)
 elif act in ['observe','barricade','crack','breach']:
  for j in range(5):person(d,697+j*22,420-j%2*8,.65,'zombie','walk',phase+j,look=-1,pack=False)
  if act=='observe':hx=520;target=(555,320)
  if act=='barricade':hx=420+u*170;motion='walk';target=(hx+45,365)
  for j in range(3):
   bx=(490+u*110 if act=='barricade'else 610)+j*13;by=405-j*30
   if act=='breach':bx-=max(0,u-.05)*160;by+=max(0,u-.05)*70
   rect(d,(bx,by,bx+130,by+12),'#8b7454');line(d,[(bx+18,by),(bx+7,by+36)],'#586c6b',5)
  if act=='crack':line(d,[(653,300),(670,337),(655,380),(668,420)],'#cdb783',4);debris(d,u,655,360,5)
  if act=='breach':
   rect(d,(650,180,825,433),'#0c1521');debris(d,min(1,local),660,340,25);hx=420-u*90;motion='run'
   for j in range(6):person(d,690+j*46-u*145,435,.85,'zombie','run',phase+j,look=-1,pack=False)
 elif act in ['supplies','ration','pack','depart']:
  bottle(d,520,355,.6 if act=='supplies'else .15);can(d,580,355)
  if act=='supplies':bottle(d,555,355,.8);hx=450;target=(520,350)
  if act=='ration':raha=True;hx=375;rx=640;target=(515,343);line(d,[(515,340),(545,340)],'#c5b28c',6)
  if act=='pack':bag(d,510,355);bottle(d,565,355,.4);can(d,600,355);target=(520+20*math.sin(t),333);hx=430;rx=650
  if act=='depart':hx=370+u*150;rx=hx+125;motion='walk';bottle(d,600,350,.1)
  for j in range(14):line(d,[(340+j*12,205),(340+j*12,223)],'#c1b598'if j>ch else'#596665',2)
 elif act in ['rattle','knock','open']:
  hx=420+u*40;look=1
  if act=='knock':line(d,[(hx+25,370),(hx+40,297)],'#9caaa4',5);target=(hx+30,355)
  width=175*(1-u*.8)if act=='open'else 175
  rect(d,(650,180,650+width,433),'#1c3440','#859b94',3);rect(d,(665+math.sin(t*11)*2,330,700+math.sin(t*11)*2,338),'#a3b6ad')
  if act=='open':person(d,755,439,.8,'raha','crouch'if u<.6 else'handsup',phase,pack=False)
  if act=='rattle':ellipse(d,(625,325,640,342),'#84978d'if math.sin(t*8)>.5 else'#354950')
 elif act=='meet':
  hx=375;rx=615;target=(465+u*35,345);bottle(d,490+u*80,354,.5-u*.25);raha=True
 elif act in ['plan','choose']:
  hx=330;rx=665;target=(480+math.sin(t*.6)*40,344);map_prop(d,420,300,act=='choose');raha=True
  ellipse(d,(552,310,568,326),'#d9d8b9');ellipse(d,(541,349,557,365),'#ad5e59')
 elif act=='distract':
  hx=330+u*190;rx=hx+120;motion='sneak';tx=300+min(1,u*2)*430;ty=350-math.sin(min(1,u*2)*math.pi)*100;can(d,tx,ty)
  for j in range(4):person(d,780+j*22,420,.65,'zombie','walk',phase+j,look=1 if u>.3 else -1,pack=False)
 elif act=='crawl':
  rect(d,(395,160+u*175,560,410),'#4c5d61','#879897',3);hx=340+u*180;motion='crawl';hy=430;rx=620;line(d,[(590,330),(540,390)],'#9eaaa2',5)
 elif act=='shatter':
  hx=510-u*200;rx=hx+135;motion='run';bottle(d,445,300+max(0,u-.2)*290,.5)
  if u>.38:debris(d,(u-.38)*2,448,430,20)
 elif act in ['unscrew','freeze','caught','seal']:
  rect(d,(480,396,700,450),'#0a1521','#829797',5);poly(d,[(480,396),(700,396),(660,310 if act in ['unscrew','caught']else 384),(505,310 if act in ['unscrew','caught']else 384)],'#4e656c')
  if act=='unscrew':hx=390;rx=600;motion='crouch';target=(540,380);line(d,[(600,360),(570,375)],'#b6b9a8',3)
  if act=='freeze':hx=375;rx=600
  if act=='caught':
   hx=420;rx=660;target=(470,360);line(d,[(435,354),(510,338)],'#b9b8a5',3);line(d,[(510,300),(510,405)],'#667d83',5)
   if u>.35:bag(d,470,430);pack=False;hy=436+max(0,u-.6)*160
  if act=='seal':
   hx=410;rx=690;motion='crouch';target=(555,386);line(d,[(470,412),(655,375)],'#abb5aa',6)
   if u<.65:line(d,[(650,378),(620,394),(590,375)],'#312c3b',8)
   rect(d,(480,396,480+220*min(1,u*1.6),450),'#4f6266','#8b9a93',3)
 elif act=='chase':
  hx=430+u*200;rx=hx+125;motion='run'
  for j in range(7):person(d,85+j*44+u*130,435,.8,'zombie','run',phase+j,look=1,pack=False)
 elif act in ['walk','journey']:
  hx=350+u*150;rx=hx+140;motion='walk';look=-1 if act=='journey'and math.sin(t*.6)>.5 else 1
  line(d,[(hx+28,360),(hx+185,324),(hx+185,405)],'#78908b',2)
 elif act=='discover':
  hx=420+u*60;rx=625;motion='walk'if u<.5 else'stand';radio(d,530,299,int(t*2)%2);ellipse(d,(680,81,718,110),'#c8cd9d')
 elif act in ['connect','message','warning']:
  hx=350;rx=725;radio(d,500,300,int(t*3)%2);target=(500,320)
  if act=='connect':
   rounded(d,(620,325,657,352),'#69776c',3);line(d,[(620,331),(590,314),(600,304)],'#ac776c',2);line(d,[(620,345),(590,345),(590,339)],'#839a99',2);rect(d,(440,335,460,350),'#a9b8ab')
  else:
   for j in range(3):d.arc(xy((580-j*13,284-j*13,620+j*13,334+j*13)),-60,60,fill='#849d91',width=2*S)
   if act=='message':text(d,(545,230),'۱۴ • خروجی شمالی',20,'#d5c49c')
   if act=='warning':text(d,(545,230),'چراغ سفید',24,'#e4ebcd');ellipse(d,(770,285,791,306),'#c67b6a');ellipse(d,(805,285,826,306),'#dbe7d3')
 elif act=='bandage':
  hx=390;rx=735;target=(hx+37,360);line(d,[(hx+17,361),(hx+38,362)],'#dbe2ce',8);rect(d,(447,355,473,370),'#bfccbd');motion='stand'
 elif act=='white':
  hx=400+u*190;rx=hx+100;motion='walk';poly(d,[(665,250),(715,250),(715,240),(743,260),(715,280),(715,270),(665,270)],'#d6e6ce')
 elif act=='balance':
  hx=250+u*360;hy=414-u*17;rx=700;motion='balance';target=(700,330)if u>.8 else None
  if u>.65:debris(d,(u-.65)*2,525,440,6);person(d,795-(u-.65)*60,432,.78,'zombie','walk',phase,look=-1,pack=False)
 elif act=='escape':
  hx=360+min(u*2,1)*275;rx=hx+110;motion='run'if u<.55 else'stand'
  if u>.55:rect(d,(700,160,850,425),'#2b4b52','#8b9b94',4);hx=740;rx=840;motion='crouch'if u>.8 else'stand'
  else:person(d,180+u*180,450,.8,'zombie','run',phase,look=1,pack=False)
 elif act=='arrival':
  hx=260+u*170;rx=hx+150;motion='walk';ellipse(d,(850,193,880,212),'#cfe7cb'if math.sin(t*3)>.0 else'#6a8d88')
 elif act in ['van','cliffhanger']:
  hx=380;rx=620;motion='stand';raha=True
  opening=min(1,u*1.8)if act=='van'else 1;rect(d,(672,285,810-125*opening,442),'#677f83','#afbeb3',3)
  person(d,746,440,.85,'rescuer','stand',phase,pack=False,reveal=act=='cliffhanger'and u>.34)
  radio(d,766,350,int(t*3)%2)
  if act=='van':target=(hx+25,370)
  if act=='cliffhanger':
   # Visible trap: infected rescuer in front, turning handle behind, both survivors trapped.
   rect(d,(62,334+math.sin(t*9)*3,110,342+math.sin(t*9)*3),'#c1c2b0')
   if u>.7:line(d,[(170,305),(190,330),(205,310)],'#302838',7)
   if u>.88:text(d,(480,112),'ادامه دارد…',32,'#eee0bb')
 look=locals().get('look',1)
 person(d,hx,hy,1,'hero',motion,phase,target,look,pack=pack)
 if raha:person(d,rx,hy-4,.96,'raha',motion if motion not in ['crawl','balance']else'stand',phase+.65,target=((580+math.sin(t)*8,330)if act=='connect'else(580,380)if act=='unscrew'else None),look=-1 if act in ['meet','plan','choose','connect','bandage']else 1,pack=False)
 # Foreground occlusion and moving camera: native-resolution pan / slow dolly, not still-image zoom clips.
 if env in ['platform','entrance']:
  rect(d,(80,70,100,468),'#142733');rect(d,(880,70,900,468),'#142733')
 zoom=1.015+.018*u;cx=480+(math.sin(local*.12+si)*5);cy=270
 crop=(int((cx-480/zoom)*S),int((cy-270/zoom)*S),int((cx+480/zoom)*S),int((cy+270/zoom)*S))
 im=im.crop(crop).resize((W,H),Image.Resampling.BILINEAR)
 # Short fade-through-black transitions; every shot has its own choreography and layout.
 fade=min(1,local/.28,(sh['end']-t)/.28)
 if fade<1:im=ImageEnhance.Brightness(im).enhance(max(.12,fade))
 d=ImageDraw.Draw(im)
 rect(d,(0,0,960,36),'#08131c');text(d,(932,18),'چهارده روز زیر زمین',13,'#c5b78c',anchor='rm');text(d,(28,18),f'{int(t)//60:02d}:{int(t)%60:02d}',11,'#9caaa7',anchor='lm',rtl=False)
 if t-chapters[ch]['start']<4:
  rounded(d,(30,50,365,116),'#112530',5,'#788078');text(d,(340,72),story[ch]['day'],20,'#dfcca1',anchor='rm');text(d,(340,99),story[ch]['place'],13,'#bccbc7',anchor='rm')
 ci=bisect.bisect_right([c['start']for c in captions],t)-1
 if ci>=0 and t<captions[ci]['end']:
  lay,h=CAPS[ci];im.paste(lay,(0,H-h-18),lay)
 return im

if '--preview' in sys.argv:
 for j,t in enumerate([5,28,128,285,360,DURATION-9]):frame(t).save(ROOT/f'preview-{j+1}.jpg',quality=85)
 sys.exit(0)
# Rate-capped delivery keeps the full-length film within the workspace artifact budget.
cmd=[FF,'-y','-hide_banner','-loglevel','warning','-f','rawvideo','-vcodec','rawvideo','-pix_fmt','rgb24','-s',f'{W}x{H}','-r',str(FPS),'-i','pipe:0','-i',str(TMP/'mix.wav'),'-map','0:v:0','-map','1:a:0','-c:v','libx264','-preset','veryfast','-tune','animation','-b:v','780k','-maxrate','1000k','-bufsize','2000k','-pix_fmt','yuv420p','-c:a','aac','-b:a','96k','-ar','24000','-movflags','+faststart','-shortest',str(ROOT/'FOURTEEN-DAYS-UNDERGROUND-FA.mp4')]
p=subprocess.Popen(cmd,stdin=subprocess.PIPE)
try:
 count=math.ceil(DURATION*FPS)
 for n in range(count):
  p.stdin.write(frame(n/FPS).tobytes())
  if n%(FPS*15)==0:print(f'Render {n/FPS:.0f}/{DURATION:.1f} seconds ({n/count:.1%})',flush=True)
finally:p.stdin.close()
code=p.wait()
if code:raise SystemExit(code)
print('EXPORT COMPLETE',ROOT/'FOURTEEN-DAYS-UNDERGROUND-FA.mp4',flush=True)
