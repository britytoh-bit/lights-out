// 라이츠 아웃 3D - the engine sound. The game only calls EngineSound.update() and setLite().
// It plays loops cut from a recording of the five 2026 power units (engine-pu0..4.bin, 16-bit; chosen by ear, three versions made purely in code did not pass). Third-party audio, rights not cleared: replace before any store release.
// Each loop is the recording laid out by crank angle, so one engine cycle (720 degrees) is always CY samples: at any rev all the loops are in step and a crossfade keeps the firing note.
// The file holds, for each rev, the engine's average cycle and then what was left of the recording once that was taken away (roar, air), its slow level changes evened out. Revs one recording lacks came from its nearest rev or, a real low rev, from another power unit.
// On loading, the rest is dealt in random order into a long loop and the average cycle added: the two need different joins (the cycle adds in phase, the rest does not), and the cycle never has one (a loop of the whole sound swelled or dipped at every join, heard as thumps). 울림 줄이기 is the level of the rest.
// The game's revs almost never fall under 7700, where the recording's firing pulses alternate big and small (the 1.5-order family: a note an octave under the firing note, rough: the 그르릉). So the low gears play sound-only revs: lowPitch for the note and lowTimbre for the crossfade (저단 그르릉 is how much). The low loops' level also swings a little once per cycle.
// Off the throttle (braking, downshifting) it is another sound. The recording's firing goes irregular there (a cycle hardly repeats the last: of what repeats, 33-76 % of the sound on the throttle, as little as 4-19 % is left on three of the units), and it gains 5-12 dB under 400 Hz: the 그르르릉 of a downshift. So the off loops are those stretches as they are, only laid out by crank angle: nothing evened out but the biggest bangs. 감속 그르릉 is how much.
// Chain: loops -> EQ -> low-pass (closes off the throttle) -> ceiling -> out. No compressor: nothing touches the level below the ceiling (11-05: 칼칼하고 미세하게 깨진다, the recording itself stays under it).
// 11-05 윤택님 「고속에서 시소 철 삐걱, 바람, 김새는 소리」: at a steady high rev the sound was the deliberate pitch wobble (0.7 s and 1.7 s, heard as a see-saw once the revs stop moving, gone), rest pieces that changed every 0.1-0.3 s (now 0.3-0.6 s), and above 2 kHz almost nothing but the rest, which is hiss (고역 잡음 줄이기 lowers the rest only, from 2.5 kHz; the +2 dB at the top is gone).
// 11-05: the revs of the sound stop where each recording's own revs stop (TOP): the game's 10 600-12 500 sat above nearly all of the recording, thin (the 250-500 Hz band 11 dB down) and high. Tuning panel: T key, or 그래픽과 기타 > 소리 > 소리 튜닝.
const EngineSound=(()=>{
  // [rpm, cycles] of each loop, in file order: on the throttle, then off it
  const LOOPS=[{"on":[[5000,40],[6000,96],[7500,96],[9000,96],[10500,96],[12000,40]],"off":[[8100,117],[10100,128]]},{"on":[[5000,17],[6000,30],[7500,59],[9000,47],[10500,47],[12000,47]],"off":[[6500,82],[8800,48]]},{"on":[[5000,32],[6000,96],[7500,96],[9000,39],[10500,39],[12000,39]],"off":[[7000,55],[9000,97]]},{"on":[[5000,40],[6000,59],[7500,96],[9000,91],[10500,31],[12000,31]],"off":[[7000,29],[10500,73]]},{"on":[[5000,40],[6000,96],[7500,96],[9000,96],[10500,33],[12000,33]],"off":[[7000,66],[9000,73]]}];
  // TEMP: 이전 소리(113e101) A/B. Goes once the player has decided, with engine-old-pu*.bin, tidy(), deal's lin, the etO button and the wind line in index.html
  const OLD=[{"on":[[5000,64],[6000,64],[7500,64],[9000,64],[10500,64],[12000,16]]},{"on":[[5000,32],[6000,32],[7500,32],[9000,32],[10500,32],[12000,32]]},{"on":[[5000,32],[6000,32],[7500,32],[9000,64],[10500,32],[12000,16]]},{"on":[[5000,16],[6000,16],[7500,16],[9000,64],[10500,64],[12000,64]]},{"on":[[5000,16],[6000,16],[7500,16],[9000,64],[10500,32],[12000,32]]}];
  const CY=512,LONG=384,LS='lightsout3d-engsnd4',DEF={mode:'2025',master:1,clean:0.25,hiss:-6,growl:1,brk:1,aero:1,vox:1,tyre:1,lowmid:0,high:0,gridLo:11600,gridHi:12000,old:false};
  const pct=v=>Math.round(v*100)+'%',db=v=>(v>0?'+':'')+v+' dB',num=v=>Math.round(v).toLocaleString('en-US');
  // key(s), name, min, max, step, how it reads
  const SLIDERS=[['master','마스터 볼륨',0,1.5,0.05,pct],['clean','울림 줄이기',0,1,0.05,pct],['hiss','고역 잡음 줄이기',-12,0,1,db],['growl','저단 그르릉',0,1.5,0.05,pct],['brk','감속 그르릉',0,1.5,0.05,pct],['aero','직선 모드 날개 소리',0,1,0.05,pct],['vox','다른 차 소리',0,1.5,0.05,pct],['tyre','타이어 끼익',0,1,0.05,pct],['lowmid','250~700Hz',-6,6,0.5,db],['high','1~2.5kHz',-6,6,0.5,db],[['gridLo','gridHi'],'출발 대기 RPM',6000,12000,100,v=>num(v)+' rpm']];
  // 2025: even and smooth. 2026: a big change off the throttle, revs held on the grid, a sharper downshift.
  // offLP, offVol: low-pass and volume with the throttle closed. blip: pitch (cents), the level it reaches (2026 1.5 x 2025 as heard, whatever the volume before it), how far the low-pass opens, then its time constants
  const MODES={'2025':{offLP:5000,offVol:0.7,grid:false,tc:0.03,blip:{c:68,abs:0.77,lp:6000,up:0.015,hold:0.045,dn:0.09}},
    '2026':{offLP:2500,offVol:0.4,grid:true,tc:0.02,blip:{c:102,abs:1.25,lp:6000,up:0.006,hold:0.018,dn:0.035}}};
  const OUTK=1.9,LP_OPEN=12000,OFFK=1,SWING=0.3,KEEP=[0,0.35,0.35,0.2,0.55];   // OUTK: the level at 100 %. OFFK: makes the closed-throttle volume come out as asked once the low-pass has taken its part. SWING: how far the low loops' level swings at 저단 그르릉 100 %. KEEP: how much of the on loops stays under the off loops, by power unit: dealt in pieces the off loops' firing note breaks up, and it is what carries the revs through a downshift (set so that the note is as strong as on the recording)
  const clamp=(x,a,b)=>Math.max(a,Math.min(b,x)),lerp=(a,b,f)=>a+(b-a)*f;
  // the game's revs run to 12 700 and its gears shift up at up to 12 500. Only the sound is scaled: 8000 and below as they are, then a straight line so that 12 500 lands on TOP, where that power unit's recording really ends (its revs on the throttle at the 95th percentile, measured)
  const TOP=[10900,12000,11800,11300,10500],mapRpm=(r,pu)=>{r=Math.max(4000,Math.min(12700,r));const T=TOP[pu]||12000;return r<=8000?r:8000+(r-8000)*(T-8000)/4500;};
  const levelAt=r=>Math.min(1,0.55+0.45*r/7500)*(0.72+0.28*clamp((r-7000)/4000,0,1));   // the low gears a little quieter, idle quieter still
  // the low gears: the note comes down towards where the recording really has its alternating pulses (at most 12 %, nothing at the top of a gear, nothing at idle, where a slowed loop sounded like a cave), and from 7500 to 8900 the 7500 loop plays on; then a quick rise to the top loop. LOWG: how much of it in each gear
  const lowPitch=(r,T)=>r*(1-0.12*clamp((r-6500)/2000,0,1)*clamp((T-r)/2000,0,1)),lowTimbre=p=>p<=7500?p:p<=8900?7500:Math.min(12000,7500+(p-8900)*4500/3100),LOWG={N:1,R:1,1:1,2:0.9,3:0.7,4:0.3};

  const P=(()=>{const o=Object.assign({},DEF);let s=null;try{s=JSON.parse(localStorage.getItem(LS));}catch(e){}
    if(s&&typeof s==='object'){if(MODES[s.mode])o.mode=s.mode;if(s.old===true)o.old=true;for(const q of SLIDERS)for(const k of [].concat(q[0]))if(Number.isFinite(s[k]))o[k]=clamp(s[k],q[2],q[3]);}
    if(o.gridLo>o.gridHi)o.gridLo=o.gridHi;return o;})();
  const save=()=>{try{localStorage.setItem(LS,JSON.stringify(P));}catch(e){}};
  const live=new Set();
  const applyP=v=>{const t=v.ctx.currentTime;v.pkMid.gain.setTargetAtTime(P.lowmid,t,0.02);v.pkHigh.gain.setTargetAtTime(P.high,t,0.02);v.master.gain.setTargetAtTime(OUTK*P.master,t,0.02);};

  // the output never goes over -1 dBFS (0.891); only peaks over 0.8 are rounded, oversampled so that it adds no grit of its own
  const ceilCurve=(()=>{const n=4097,c=new Float32Array(n);for(let i=0;i<n;i++){const x=i/(n-1)*2-1,a=Math.abs(x);c[i]=a<=0.8?x:Math.sign(x)*(0.8+0.091*Math.tanh((a-0.8)/0.091));}return c;})();

  // ---- the loops ----
  const FILES={};
  function puLoad(pu){const old=P.old,f=(old?'engine-old-pu':'engine-pu')+pu;return FILES[f]||(FILES[f]=(function get(){return fetch(f+'.bin').then(r=>{if(!r.ok)throw 0;return r.arrayBuffer();}).then(b=>{const a=new Int16Array(b);a.old=old;return a;}).catch(()=>new Promise(w=>setTimeout(w,3000)).then(get));})());}   // the file is in the offline cache; if the net is down it keeps trying, the engine stays quiet until then
  // the rest: stretches of 24-48 cycles in random order, over two cycles and at equal power (they are not in phase)
  function deal(x,nc,rnd,lin){const n=x.length,X=CY*2,L=LONG*CY,tmp=new Float32Array(L+X),q=Math.PI/2,A=f=>lin?1-f:Math.cos(f*q),B=f=>lin?f:Math.sin(f*q);let pos=0,last=-1;
    while(pos<L){let c=(rnd()*nc)|0;if(c===last)c=(c+1)%nc;last=c;const seg=Math.min(nc,24+((rnd()*25)|0))*CY,st=c*CY;
      for(let i=0;i<seg+X&&pos+i<L+X;i++){const v=x[(st+i)%n];if(i<X&&pos>0){const f=i/X;tmp[pos+i]=tmp[pos+i]*A(f)+v*B(f);}else tmp[pos+i]=v;}pos+=seg;}
    for(let i=0;i<X;i++){const f=i/X;tmp[i]=tmp[i]*B(f)+tmp[L+i]*A(f);}
    return tmp.subarray(0,L);}
  // TEMP (이전 소리): 113e101's take-down of what lies between the orders, at its default strength
  function fft(re,im,sign){const n=re.length;for(let i=1,j=0;i<n;i++){let b=n>>1;for(;j&b;b>>=1)j^=b;j^=b;if(i<j){let t=re[i];re[i]=re[j];re[j]=t;t=im[i];im[i]=im[j];im[j]=t;}}
    for(let l=2;l<=n;l<<=1){const a=sign*2*Math.PI/l,wr=Math.cos(a),wi=Math.sin(a);for(let i=0;i<n;i+=l){let cr=1,ci=0;for(let j=0,h=l>>1;j<h;j++){const p=i+j,q=p+h,xr=re[q]*cr-im[q]*ci,xi=re[q]*ci+im[q]*cr;re[q]=re[p]-xr;im[q]=im[p]-xi;re[p]+=xr;im[p]+=xi;const t=cr*wr-ci*wi;ci=cr*wi+ci*wr;cr=t;}}}}
  function tidy(x,nc,rpm){const n=x.length,re=Float64Array.from(x),im=new Float64Array(n),H=n>>1;fft(re,im,-1);
    for(let k=1;k<=H;k++){const m=k%nc;let u=(Math.min(m,nc-m)/nc-0.12)/0.18;u=u<0?0:u>1?1:u;u=u*u*(3-2*u);const g=Math.pow(10,(k/nc/2*rpm/60<400?-10:-6)*0.5*u/20);re[k]*=g;im[k]*=g;if(k<H){re[n-k]*=g;im[n-k]*=g;}}
    fft(re,im,1);const o=new Float32Array(n);for(let i=0;i<n;i++)o[i]=re[i]/n;return o;}
  // the rest only, from 2.5 kHz up: its hiss goes, the firing notes in the average cycle stay. rpm: this loop's own, a loop is laid out by crank angle
  const hiss=(y,rpm)=>{if(P.hiss>=0)return y;const a=Math.exp(-2*Math.PI*2500/(rpm/120*CY)),g=1-Math.pow(10,P.hiss/20),n=y.length,o=new Float32Array(n);let l=0;for(let i=Math.max(0,n-4096);i<n;i++)l=a*l+(1-a)*y[i];for(let i=0;i<n;i++){l=a*l+(1-a)*y[i];o[i]=y[i]-g*(y[i]-l);}return o;};
  let BANK=null;   // the one set kept in memory: the power unit in use
  function bank(ctx,pu,D){const key=(D.old?'old':'')+pu+'|'+P.clean+'|'+P.hiss+'|'+P.growl+'|'+ctx.sampleRate;if(BANK&&BANK.key===key)return BANK;let sd=4242+pu,o=0;const rnd=()=>{sd=(sd*16807)%2147483647;return sd/2147483647;};
    if(D.old)return BANK={key,on:OLD[pu].on.map(q=>{const nc=q[1],n=nc*CY,x=new Float32Array(n);for(let i=0;i<n;i++)x[i]=D[o+i]/32768;o+=n;const y=deal(tidy(x,nc,q[0]),nc,rnd,true),buf=ctx.createBuffer(1,y.length,ctx.sampleRate);buf.getChannelData(0).set(y);return {rpm:q[0],buf};})};
    const gR=Math.pow(10,-12*P.clean/20),on=LOOPS[pu].on.map(q=>{const nc=q[1],n=nc*CY,x=new Float32Array(n);for(let i=0;i<n;i++)x[i]=D[o+CY+i]/32768;const y=hiss(deal(x,nc,rnd),q[0]),buf=ctx.createBuffer(1,y.length,ctx.sampleRate),d=buf.getChannelData(0);
      const lo=q[0]<=7500,s=o+CY+n,m=lo?SWING*P.growl/32768:0,W=new Float32Array(LONG+1);for(let i=0;i<LONG;i++)W[i]=0.8+0.4*rnd();W[LONG]=W[0];   // the low loops' file ends with the shape of that swing: the level, cylinder by cylinder, once per cycle. W: its size wanders from cycle to cycle like real combustion (fixed, it is a machine's tremolo)
      for(let i=0;i<y.length;i++){const j=i%CY,c=(i-j)/CY;d[i]=(y[i]*gR+D[o+j]/32768)*(lo?1+m*(W[c]+(W[c+1]-W[c])*j/CY)*D[s+j]:1);}o=s+(lo?CY:0);return {rpm:q[0],buf};});
    const F=LOOPS[pu].off||[],off=(o+F.reduce((a,q)=>a+CY+q[1]*CY,0)<=D.length?F:[]).map(q=>{const nc=q[1],n=nc*CY,x=new Float32Array(n);for(let i=0;i<n;i++)x[i]=D[o+CY+i]/32768;const y=hiss(deal(x,nc,rnd),q[0]),buf=ctx.createBuffer(1,y.length,ctx.sampleRate),d=buf.getChannelData(0);for(let i=0;i<y.length;i++)d[i]=y[i]+D[o+i%CY]/32768;o+=CY+n;return {rpm:q[0],buf};});
    return BANK={key,on,off};}

  // ---- the player's engine ----
  function attach(v,bk){const ctx=v.ctx,G=x=>{const g=ctx.createGain();g.gain.value=x;return g;},t0=ctx.currentTime+0.01,k=CY/120/ctx.sampleRate;for(const a of v.on.concat(v.off)){try{a.s.stop();}catch(e){}try{a.g.disconnect();}catch(e){}}
    const mk=q=>{const s=ctx.createBufferSource();s.buffer=q.buf;s.loop=true;s.playbackRate.value=(v.R||9000)*k;const g=G(0);s.connect(g);g.connect(v.mix);s.start(t0);return {rpm:q.rpm,s,g,k};};v.on=bk.on.map(mk);v.off=(bk.off||[]).map(mk);}   // all at the same moment: in step
  function create(ctx,dest,pu){
    const G=x=>{const g=ctx.createGain();g.gain.value=x;return g;},F=(ty,f,q,gn)=>{const b=ctx.createBiquadFilter();b.type=ty;b.frequency.value=f;if(q!=null)b.Q.value=q;if(gn!=null)b.gain.value=gn;return b;};
    const chain=(...n)=>{for(let i=1;i<n.length;i++)n[i-1].connect(n[i]);};
    const mix=G(1),hp=F('highpass',40,-3),pk200=F('peaking',200,1.2,1.5),pk500=F('peaking',500,1.5,-1),pkMid=F('peaking',418,0.93,P.lowmid),pkHigh=F('peaking',1581,1.05,P.high),top=F('highshelf',2500,null,0),lp=F('lowpass',LP_OPEN,-3),shLow=F('lowshelf',160,null,0),shTop=F('highshelf',3000,null,0);   // (for high-pass and low-pass Q is in dB: -3 is no resonance. pk200, pk500, top: a little closer to onboard. Game values)
    const master=G(OUTK*P.master),ceil=ctx.createWaveShaper();ceil.curve=ceilCurve;ceil.oversample='4x';
    const shift=G(1),limG=G(1),vol=G(0.5),out=G(1);
    // the rev limiter cuts in and out 15 times a second, whatever the frame rate
    const limO=ctx.createOscillator(),lf=F('lowpass',200,-3),limD=G(0);limO.type='square';limO.frequency.value=15;limO.connect(lf);lf.connect(limD);limD.connect(limG.gain);limO.start();
    const v={v6:true,ctx,pu,mix,limO,lp,pkMid,pkHigh,shLow,shTop,master,shift,limG,limD,vol,out,on:[],off:[],eq:[hp,pk200,pk500,pkMid,pkHigh,top,lp,shLow,shTop],S:{gear:'N',thr:0,low:1,onGrid:false,gT:0,gTg:11800,gR:11800,inCar:null}};
    chain(mix,hp,pk200,pk500,pkMid,pkHigh,top,lp,shLow,shTop,master,ceil,shift,limG,vol,out);
    if(ctx.createStereoPanner){v.pan=ctx.createStereoPanner();out.connect(v.pan);v.pan.connect(dest);}else out.connect(dest);
    live.add(v);v.ready=puLoad(pu).then(D=>{if(v.dead)return;v.D=D;attach(v,bank(ctx,pu,D));});return v;}
  function stop(v){v.dead=true;live.delete(v);for(const a of v.on.concat(v.off))try{a.s.stop();}catch(e){}try{v.limO.stop();}catch(e){}try{v.out.disconnect();if(v.pan)v.pan.disconnect();}catch(e){}}
  // a new race: nothing of the last one's start lights carries over (left during the countdown, the first frame read as lights out)
  function reset(v){v.S.onGrid=false;v.S.gear='N';}

  // an upshift: a short, slight dip (measured on the recording about 1 dB; the revs themselves drop with the game's gear ratios)
  function upshift(v,t){const g=v.shift.gain;g.cancelScheduledValues(t);g.setTargetAtTime(0.85,t,0.006);g.setTargetAtTime(1,t+0.05,0.03);}
  // a downshift: a blip of the revs, louder and brighter for a moment. Scheduled, so that it is as short at 30 fps as at 60
  function downshift(v,t,M,thr,lv){const B=M.blip,go=(p,peak,rest)=>{p.cancelScheduledValues(t);p.setTargetAtTime(peak,t,B.up);p.setTargetAtTime(rest,t+B.hold,B.dn);};
    for(const a of v.on.concat(v.off))if(a.s.detune)go(a.s.detune,B.c,0);go(v.shift.gain,Math.max(1.1,B.abs/(lv*lerp(M.offVol*OFFK,1,Math.pow(thr,0.7)))),1);
    go(v.lp.detune,Math.max(0,1200*Math.log2(B.lp/(M.offLP*Math.pow(LP_OPEN/M.offLP,thr)))),0);}

  // o: {t, dt, rpm (the game's), thr 0..1, gear, inCar, dop (doppler), grid (on the start lights), pitLim}
  function update(v,o){const S=v.S,M=MODES[P.mode],t=o.t,dt=o.dt;
    const T0=TOP[v.pu]||12000;let r=mapRpm(o.rpm,v.pu),th=o.thr;
    if(M.grid&&o.grid){   // 2026: the revs held high on the grid, wandering; they do not wait for the pedal
      if(!S.onGrid){S.onGrid=true;S.gT=0;S.gR=lerp(P.gridLo,P.gridHi,Math.random());}
      S.gT-=dt;if(S.gT<=0){S.gT=0.3+Math.random()*0.5;S.gTg=lerp(P.gridLo,P.gridHi,Math.random());}
      S.gR+=(S.gTg-S.gR)*Math.min(1,dt*9);r=mapRpm(S.gR,v.pu);th=Math.max(th,0.65);}
    else if(S.onGrid)S.onGrid=false;   // lights out: the game's revs (the launch: down to 8000 as the clutch bites, then up through first) take over
    S.thr+=(th-S.thr)*Math.min(1,dt*14);const T=S.thr,lv=levelAt(r);
    if(o.gear!==S.gear){const a=+S.gear,b=+o.gear;if(a&&b){if(b>a)upshift(v,t);else downshift(v,t,M,T,lv);}S.gear=o.gear;}
    S.low+=((LOWG[o.gear]||0)-S.low)*Math.min(1,dt*12);const old=v.D&&v.D.old,Lw=old?0:S.low*Math.min(1,P.growl),rp=lowPitch(r,T0);   // smooth across a shift
    const R=lerp(r,rp,Lw)*(o.dop||1),Rt=old?R:lerp(r,lowTimbre(rp),Lw),l=v.on;v.R=R;
    const play=(l,p,G)=>{if(!l.length)return;let i=0;while(i<l.length-2&&l[i+1].rpm<=p)i++;const f=l.length<2?0:clamp(Math.log(p/l[i].rpm)/Math.log(l[i+1].rpm/l[i].rpm),0,1);
      for(let j=0;j<l.length;j++){l[j].s.playbackRate.setTargetAtTime(R*l[j].k,t,M.tc);l[j].g.gain.setTargetAtTime(G*(j===i?Math.pow(1-f,0.75):j===i+1?Math.pow(f,0.75):0),t,0.03);}};   // between equal-power and straight: the orders add in phase, the air does not
    // off the throttle the off loops take over, in the two tenths the pedal takes to come up. Not on the grid, in neutral or at idle, where a slowed loop sounds like a cave. Full throttle stays full throttle while the speed falls
    const b=Math.min(1,P.brk)*clamp((0.45-T)/0.4,0,1)*clamp((r-4300)/500,0,1)*(o.grid||o.gear==='N'?0:1);play(l,Rt,v.off.length?1-b*(1-KEEP[v.pu]):1);play(v.off,R,b*Math.sqrt(1-KEEP[v.pu]*KEEP[v.pu])*Math.max(1,P.brk));
    // and a little quieter and darker than on the throttle
    v.vol.gain.setTargetAtTime(lv*lerp(M.offVol*OFFK,1,Math.pow(T,0.7)),t,0.012);v.lp.frequency.setTargetAtTime(M.offLP*Math.pow(LP_OPEN/M.offLP,T),t,0.04);
    if(S.inCar!==o.inCar){S.inCar=o.inCar;v.shLow.gain.setTargetAtTime(o.inCar?2:0,t,0.1);v.shTop.gain.setTargetAtTime(o.inCar?0:2,t,0.1);}   // the cockpit a little more low end, outside a little more top
    const d=o.thr>=0.99&&o.rpm>12650&&!o.grid?0.9:o.pitLim?0.3:0;v.limD.gain.setTargetAtTime(d/2,t,0.005);v.limG.gain.setTargetAtTime(1-d/2,t,0.005);}

  // ---- other cars: one loop of the same set, a low-pass and a level (distance, doppler and the choice of three cars are the game's) ----
  function createLite(ctx,dest,pu){const lp=ctx.createBiquadFilter();lp.type='lowpass';lp.frequency.value=1500;lp.Q.value=-3;const out=ctx.createGain();out.gain.value=0;const v={lite:true,pu,lp,out,s:null,k:CY/120/ctx.sampleRate};lp.connect(out);
    if(ctx.createStereoPanner){v.pan=ctx.createStereoPanner();out.connect(v.pan);v.pan.connect(dest);}else out.connect(dest);
    v.ready=puLoad(pu).then(D=>{const on=bank(ctx,pu,D).on,q=on.find(a=>a.rpm===10500)||on[on.length-1],s=ctx.createBufferSource();s.buffer=q.buf;s.loop=true;s.playbackRate.value=10000*v.k;s.connect(lp);s.start(ctx.currentTime,Math.random()*q.buf.duration);v.s=s;});return v;}
  function setLite(v,t,rpm,dop,level,cut,tc){if(v.s)v.s.playbackRate.setTargetAtTime(mapRpm(rpm,v.pu)*dop*v.k,t,tc||0.03);v.lp.frequency.setTargetAtTime(cut,t,0.03);v.out.gain.setTargetAtTime(level,t,0.008);}

  // ---- hear it without a race: the grid, a launch, three upshifts, a lift, three downshifts, idle, then a steady pull at high speed. Runs on a timer, so the sliders are heard as they move ----
  function preview(ctx,dest,pu,onEnd){const v=create(ctx,dest,pu),END=9.6;let t0=0,r=4000,last=0,done=false,fade=false,iv=0;v.out.gain.value=0;
    const stopIt=()=>{if(done)return;done=true;clearInterval(iv);stop(v);};
    const tick=()=>{const now=ctx.currentTime,T=now-t0,dt=Math.max(0.001,now-last);last=now;if(T>=END){stopIt();if(onEnd)onEnd();return;}if(T>=END-0.12&&!fade){fade=true;v.out.gain.setTargetAtTime(0,now,0.03);}
      let tg=4000,thr=0,g='N',grid=false;
      if(T<1.2){grid=true;tg=12000;thr=1;}
      else if(T<4.2){const n=T<2.7?0:T<3.6?1:2,u=T-[1.2,2.7,3.6][n],a=[8000,9860,10250][n];thr=1;g=String(n+1);tg=a+(12350-a)*u/[1.5,0.9,0.6][n];}   // the first gear long enough to hear its growl
      else if(T<4.7){g='4';tg=10600-(T-4.2)*900;}
      else if(T<5.5){const n=Math.floor((T-4.7)/0.26);g=String(Math.max(1,3-n));tg=11000-((T-4.7)%0.26)*3800;}
      else if(T<6.6)g='1';
      else{g='8';thr=1;tg=10900+(T-6.6)*230;}   // a steady pull at high speed
      r+=(tg-r)*Math.min(1,dt*(tg<r-250?38:18));update(v,{t:now,dt,rpm:r,thr,gear:g,inCar:true,dop:1,grid});};
    v.ready.then(()=>{if(done)return;t0=last=ctx.currentTime;v.out.gain.setTargetAtTime(1,t0,0.02);iv=setInterval(tick,20);tick();});
    return {stop:stopIt};}

  // ---- the tuning panel ----
  let box=null,hooks={};
  const CSS=`#engTune{position:fixed;inset:0;z-index:200;display:flex;align-items:center;justify-content:center;padding:max(8px,env(safe-area-inset-top)) max(10px,env(safe-area-inset-right)) max(8px,env(safe-area-inset-bottom)) max(10px,env(safe-area-inset-left));background:rgba(0,0,0,.6);color:#f2f3f5;font-size:14px;touch-action:none;user-select:none;-webkit-user-select:none}
#engTune[hidden]{display:none}
#engTune .etC{display:flex;flex-direction:column;width:min(780px,100%);max-height:100%;padding:12px 18px;border-radius:14px;background:#1c1d22;box-shadow:0 10px 40px rgba(0,0,0,.5)}
#engTune .etH{display:flex;align-items:center;gap:12px;margin-bottom:4px}
#engTune .etH b{flex:none;font-size:16px;font-weight:700}
#engTune button{font:inherit;min-height:38px;padding:0 14px;border:0;border-radius:9px;background:#2d2f36;color:#f2f3f5;font-weight:600}
#engTune button:active{background:#3a3d46}
#engTune .etSeg{flex:1;display:flex;gap:4px;padding:3px;border-radius:11px;background:#26282e}
#engTune .etSeg button{flex:1;min-height:34px;padding:0 8px;background:none;color:#b3b7c0;font-weight:500;white-space:nowrap}
#engTune .etSeg button[aria-pressed="true"]{background:#474b56;color:#fff;font-weight:700}
#engTune .etB{display:grid;grid-template-columns:1fr 1fr;gap:0 26px;min-height:0;overflow-y:auto}
#engTune .etR{padding:5px 0 0}
#engTune .etL{display:flex;justify-content:space-between;gap:10px;font-size:13px;color:#b3b7c0}
#engTune .etL span{color:#f2f3f5;font-weight:600;white-space:nowrap;font-variant-numeric:tabular-nums}
#engTune .etS{position:relative;height:30px;touch-action:none;cursor:pointer}
#engTune .etT,#engTune .etF{position:absolute;top:13px;height:4px;border-radius:2px}
#engTune .etT{left:0;right:0;background:#3a3d46}
#engTune .etF{background:#f5c518}
#engTune .etK{position:absolute;top:4px;width:22px;height:22px;margin-left:-11px;border-radius:50%;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.5)}
#engTune .etA{display:flex;gap:8px;margin-top:6px}
#engTune .etA button{flex:1}
#engTune .etA .etGo{background:#f5c518;color:#15161a}
#engTune .etA .etGo:active{background:#dcb015}
#engTune .etA .etO[aria-pressed="true"]{background:#474b56;color:#fff;font-weight:700}
@media (max-width:540px){#engTune .etB{grid-template-columns:1fr}#engTune .etH{flex-wrap:wrap}#engTune .etSeg{order:3;flex-basis:100%}#engTune .etX{margin-left:auto}}`;
  function slider(host,q,onMove,onEnd){const keys=[].concat(q[0]),[,,lo,hi,step,fmt]=q,el=document.createElement('div');el.className='etR';
    el.innerHTML=`<div class="etL">${q[1]}<span></span></div><div class="etS"><div class="etT"></div><div class="etF"></div>${keys.map(()=>'<div class="etK"></div>').join('')}</div>`;host.appendChild(el);
    const S=el.querySelector('.etS'),Fl=el.querySelector('.etF'),Ks=[...el.querySelectorAll('.etK')],R=el.querySelector('.etL span');
    const inset=11,pos=v=>`calc(${inset}px + (100% - ${2*inset}px) * ${(v-lo)/(hi-lo)})`;
    const draw=()=>{keys.forEach((k,i)=>{Ks[i].style.left=pos(P[k]);});Fl.style.left=keys.length>1?pos(P[keys[0]]):pos(lo);Fl.style.width=`calc((100% - ${2*inset}px) * ${(P[keys[keys.length-1]]-(keys.length>1?P[keys[0]]:lo))/(hi-lo)})`;R.textContent=keys.length>1?fmt(P[keys[0]]).replace(/ .*/,'')+'~'+fmt(P[keys[1]]):fmt(P[keys[0]]);};
    let act=null;const at=e=>{const b=S.getBoundingClientRect();return lo+clamp((e.clientX-b.left-inset)/(b.width-2*inset),0,1)*(hi-lo);};
    const set=(k,x)=>{x=Math.round(x/step)*step;x=+x.toFixed(4);if(k===keys[0]&&keys.length>1)x=Math.min(x,P[keys[1]]);if(k===keys[1])x=Math.max(x,P[keys[0]]);P[k]=clamp(x,lo,hi);draw();onMove();};
    let pid=null,tid=null,pick=null;
    const begin=x=>{if(keys.length>1&&P[keys[0]]===P[keys[1]]){act=null;pick=x;return;}   // the two handles on top of each other: the first move decides which one
        act=keys.reduce((a,k)=>Math.abs(P[k]-x)<Math.abs(P[a]-x)?k:a,keys[0]);set(act,x);},
      drag=x=>{if(pick!=null){if(Math.abs(x-pick)<step/2)return;act=x<pick?keys[0]:keys[1];pick=null;}if(act)set(act,x);},done=()=>{act=null;pick=null;save();onEnd();};
    // a finger goes by touch events, as the pedals do: an iPhone can cancel a pointer as soon as it moves (a tap set the value, a drag did nothing). A new finger always takes over: one slid off the screen may never send its end
    S.addEventListener('touchstart',e=>{e.preventDefault();e.stopPropagation();const t=e.changedTouches[0];tid=t.identifier;begin(at(t));},{passive:false});
    S.addEventListener('touchmove',e=>{e.preventDefault();for(const t of e.changedTouches)if(t.identifier===tid)drag(at(t));},{passive:false});
    const tEnd=e=>{for(const t of e.changedTouches)if(t.identifier===tid){tid=null;done();}};S.addEventListener('touchend',tEnd);S.addEventListener('touchcancel',tEnd);
    S.addEventListener('pointerdown',e=>{if(e.pointerType==='touch')return;e.preventDefault();e.stopPropagation();pid=e.pointerId;try{S.setPointerCapture(pid);}catch(er){}begin(at(e));});
    S.addEventListener('pointermove',e=>{if(e.pointerId===pid)drag(at(e));});
    const end=e=>{if(e.pointerId!==pid)return;pid=null;done();};S.addEventListener('pointerup',end);S.addEventListener('pointercancel',end);S.addEventListener('lostpointercapture',end);
    return draw;}
  // 울림 줄이기 changes the loops themselves: they are made again when the finger lifts, not while it moves
  const rebuild=()=>{for(const v of live)if(v.D&&!v.dead)puLoad(v.pu).then(D=>{if(v.dead)return;v.D=D;attach(v,bank(v.ctx,v.pu,D));});};
  function build(){const st=document.createElement('style');st.textContent=CSS;document.head.appendChild(st);box=document.createElement('div');box.id='engTune';box.hidden=true;
    box.innerHTML=`<div class="etC"><div class="etH"><b>엔진 소리 튜닝</b><div class="etSeg"><button type="button" data-m="2025">2025 스타일</button><button type="button" data-m="2026">2026 실제 스타일</button></div><button type="button" class="etX">닫기</button></div><div class="etB"></div><div class="etA"><button type="button" class="etGo">소리 듣기</button><button type="button" class="etO"></button><button type="button" class="etD">기본값으로</button></div></div>`;document.body.appendChild(box);
    const body=box.querySelector('.etB'),apply=()=>{for(const v of live)applyP(v);},draws=SLIDERS.map(q=>slider(body,q,apply,rebuild)),seg=[...box.querySelectorAll('.etSeg button')],drawSeg=()=>seg.forEach(b=>b.setAttribute('aria-pressed',b.dataset.m===P.mode?'true':'false'));
    const etO=box.querySelector('.etO'),drawO=()=>{etO.textContent='이전 소리(113e101) '+(P.old?'켜짐':'꺼짐');etO.setAttribute('aria-pressed',P.old?'true':'false');};etO.addEventListener('click',()=>{P.old=!P.old;save();drawO();rebuild();});
    const redraw=()=>{draws.forEach(d=>d());drawSeg();drawO();};box._redraw=redraw;
    seg.forEach(b=>b.addEventListener('click',()=>{P.mode=b.dataset.m;save();drawSeg();}));
    box.querySelector('.etX').addEventListener('click',()=>{box.hidden=true;});
    box.querySelector('.etGo').addEventListener('click',()=>{if(hooks.preview)hooks.preview();});
    box.querySelector('.etD').addEventListener('click',()=>{Object.assign(P,DEF);save();apply();rebuild();redraw();});
    box.addEventListener('click',e=>{if(e.target===box)box.hidden=true;});}
  function openPanel(){if(!box)build();box._redraw();box.hidden=false;}
  // hooks: {preview, ctx (the AudioContext, once there is one), mayResume}
  function setup(h){hooks=h;
    addEventListener('keydown',e=>{if(e.code!=='KeyT'||e.repeat||/^(INPUT|TEXTAREA)$/.test(e.target.tagName||''))return;if(box&&!box.hidden)box.hidden=true;else openPanel();});
    // phones hold an AudioContext until a touch starts it, and a call leaves it interrupted
    const wake=()=>{const c=h.ctx&&h.ctx();if(c&&c.state!=='running'&&c.state!=='closed'&&(!h.mayResume||h.mayResume()))c.resume();};
    for(const ty of['touchend','pointerdown','keydown'])addEventListener(ty,wake,{capture:true,passive:true});}
  return {P,MODES,mapRpm,create,update,stop,reset,createLite,setLite,preview,setup,openPanel};
})();
