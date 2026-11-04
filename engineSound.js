// 라이츠 아웃 3D - the engine sound, made in code with Web Audio (no audio files). The game only calls EngineSound.update() and setLite().
// Layers, all following the revs (f = rpm / 20, the firing frequency of a 4-stroke V6):
//   A sawtooth f (1.0), B 2f (0.5), C 3f (0.3), D 4f-6f (0.15, grows with the throttle), E rpm/120 Hz shaking A by +-10 %,
//   F exhaust noise band-passed at 2f, Q 1.5, G the turbo whistle (a sine, follows a lagging turbo value).
// Chain: layers -> soft distortion (harder with the throttle) -> EQ -> compressor -> limiter -> out.
// The values are 윤택님's specification (11-04); the whistle range has no measured basis, so it and the tone are on the tuning panel (T key; on a phone: 그래픽과 기타 > 소리, tap the words 「엔진 소리」 5 times).
const EngineSound=(()=>{
  const LS='lightsout3d-engsnd',DEF={mode:'2025',master:1,lowmid:4,high:3,dist:1,whistle:1,noise:1,whLo:4000,whHi:8000,gridLo:8000,gridHi:11000};
  const pct=v=>Math.round(v*100)+'%',db=v=>(v>0?'+':'')+v+' dB',num=v=>Math.round(v).toLocaleString('en-US');
  // key(s), name, min, max, step, how it reads
  const SLIDERS=[['master','마스터 볼륨',0,1.5,0.05,pct],['lowmid','250~700Hz 증폭',0,10,0.5,db],['high','1~2.5kHz 증폭',0,8,0.5,db],['dist','디스토션 강도',0,2,0.05,pct],
    ['whistle','터보 휘슬 볼륨',0,3,0.05,pct],['noise','배기 노이즈 볼륨',0,3,0.05,pct],[['whLo','whHi'],'터보 휘슬 주파수',2000,12000,100,v=>num(v)+' Hz'],[['gridLo','gridHi'],'출발 대기 RPM',6000,12000,100,v=>num(v)+' rpm']];
  // 2025: as with the MGU-H, even and smooth. 2026: turbo lag, a big change off the throttle, revs held on the grid, a sharper downshift.
  // up, dn: seconds for the turbo value to rise / fall across its range. offLP, offVol: low-pass and volume with the throttle closed. blip: pitch (cents), the level it reaches (2026 1.5 x 2025 as heard, whatever the volume before it), drive, then its time constants
  const MODES={'2025':{up:0.1,dn:0.3,offLP:5000,offVol:0.7,noise:0.12,grid:false,tc:0.03,blip:{c:68,abs:1.35,dr:1.3,up:0.012,hold:0.036,dn:0.06}},
    '2026':{up:0.4,dn:0.8,offLP:2500,offVol:0.4,noise:0.2,grid:true,tc:0.02,blip:{c:102,abs:2.45,dr:1.45,up:0.005,hold:0.015,dn:0.03}}};
  const OUTK=0.5,LP_OPEN=12000,OFFK=1.38;   // OUTK: the level at 100 % (RMS about 0.2 flat out). OFFK: the softer drive and the closed low-pass already take this much off, so that the closed-throttle volume comes out as asked
  const clamp=(x,a,b)=>Math.max(a,Math.min(b,x)),lerp=(a,b,f)=>a+(b-a)*f;
  // the game's revs run to 12 700 and its gears shift up at up to 12 500. Only the sound is scaled: 11 500 and below as they are, the top squeezed so that the limiter sits at 12 000
  const mapRpm=r=>{r=Math.max(4000,r);return r<=11500?r:Math.min(12000,11500+(r-11500)*500/1200);};

  const P=(()=>{const o=Object.assign({},DEF);let s=null;try{s=JSON.parse(localStorage.getItem(LS));}catch(e){}
    if(s&&typeof s==='object'){if(MODES[s.mode])o.mode=s.mode;for(const q of SLIDERS)for(const k of [].concat(q[0]))if(Number.isFinite(s[k]))o[k]=clamp(s[k],q[2],q[3]);}
    if(o.whLo>o.whHi)o.whLo=o.whHi;if(o.gridLo>o.gridHi)o.gridLo=o.gridHi;return o;})();
  const save=()=>{try{localStorage.setItem(LS,JSON.stringify(P));}catch(e){}};
  const live=new Set();
  const applyP=v=>{const t=v.ctx.currentTime;v.pkMid.gain.setTargetAtTime(P.lowmid,t,0.02);v.pkHigh.gain.setTargetAtTime(P.high,t,0.02);v.master.gain.setTargetAtTime(OUTK*P.master,t,0.02);};

  // ---- curves ----
  // the input's -1..1 stands for -4..4: the drive is a gain in front, up to where it flattens
  const softCurve=(()=>{const n=4097,c=new Float32Array(n);for(let i=0;i<n;i++)c[i]=Math.tanh(4*(i/(n-1)*2-1));return c;})();
  // the output never goes over -1 dBFS (0.891); the compressor-limiter before it lets the fastest edges through
  const ceilCurve=(()=>{const n=4097,c=new Float32Array(n);for(let i=0;i<n;i++){const x=i/(n-1)*2-1,a=Math.abs(x);c[i]=a<=0.8?x:Math.sign(x)*(0.8+0.091*Math.tanh((a-0.8)/0.091));}return c;})();
  // The layers are locked in frequency, so their phases never drift: started together, a sawtooth at 2f cancels the even harmonics of the one at f (its second harmonic has the opposite sign), and what is left depends on the start.
  // So the phases are set: A and C are plain sawtooths, B the same shifted half a period, and all the layers add. D is one wave holding harmonics 4, 5, 6 with the signs that add to the others.
  const WAVES=ctx=>ctx._esV||(ctx._esV=(()=>{const n=128,mk=f=>{const re=new Float32Array(n),im=new Float32Array(n);for(let k=1;k<n;k++)im[k]=f(k);return ctx.createPeriodicWave(re,im);};
    return {saw:mk(k=>(k%2?1:-1)/k),sawB:mk(k=>-1/k),d:mk(k=>k===4||k===6?-1:k===5?1:0)};})());
  const DK=(()=>{let pk=0;for(let i=0;i<2048;i++){const x=i/2048*2*Math.PI;pk=Math.max(pk,Math.abs(Math.sin(5*x)-Math.sin(4*x)-Math.sin(6*x)));}return 0.0866*pk;})();   // the wave comes normalised to 1: this gives 0.0866 each (three together weigh as one sine at 0.15)
  const noiseBuf=ctx=>ctx._esN||(ctx._esN=(()=>{const b=ctx.createBuffer(1,ctx.sampleRate*2,ctx.sampleRate),d=b.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=Math.random()*2-1;return b;})());

  // ---- the player's engine ----
  function create(ctx,dest){
    const G=x=>{const g=ctx.createGain();g.gain.value=x;return g;},F=(ty,f,q,gn)=>{const b=ctx.createBiquadFilter();b.type=ty;b.frequency.value=f;if(q!=null)b.Q.value=q;if(gn!=null)b.gain.value=gn;return b;};
    const W=WAVES(ctx),osc=(ty,to)=>{const o=ctx.createOscillator();if(typeof ty==='string')o.type=ty;else o.setPeriodicWave(ty);o.connect(to);o.start();return o;},chain=(...n)=>{for(let i=1;i<n.length;i++)n[i-1].connect(n[i]);return n[n.length-1];};
    const mix=G(1),gA=G(1),gB=G(0.5),gC=G(0.3),gD=G(0),gF=G(0),gG=G(0),lfoG=G(0.1);
    gA.connect(mix);gB.connect(mix);gC.connect(mix);gD.connect(mix);gF.connect(mix);
    const oA=osc(W.saw,gA),oB=osc(W.sawB,gB),oC=osc(W.saw,gC),oD=osc(W.d,gD),oE=osc('sine',lfoG),oG=osc('sine',gG);lfoG.connect(gA.gain);
    oA.frequency.value=200;oB.frequency.value=400;oC.frequency.value=600;oD.frequency.value=200;oE.frequency.value=33;   // idle, until the first update
    const ns=ctx.createBufferSource();ns.buffer=noiseBuf(ctx);ns.loop=true;const bp=F('bandpass',1000,1.5);ns.connect(bp);bp.connect(gF);ns.start();
    const drive=G(0.1),bark=G(1),sh=ctx.createWaveShaper();sh.curve=softCurve;sh.oversample='2x';
    const hp=F('highpass',40,-3),pkLow=F('peaking',110,1.57,2),pkMid=F('peaking',418,0.93,P.lowmid),pkHigh=F('peaking',1581,1.05,P.high),pkHarsh=F('peaking',3873,1.94,-3),lp=F('lowpass',LP_OPEN,-3),shLow=F('lowshelf',160,null,0),shTop=F('highshelf',8000,null,0);   // (for high-pass and low-pass Q is in dB: -3 is no resonance. pkHarsh -3: the 1-2.5 kHz bell's skirt gives some back, so 3-5 kHz comes out at about -2)
    const comp=ctx.createDynamicsCompressor();comp.threshold.value=-18;comp.knee.value=6;comp.ratio.value=4;comp.attack.value=0.005;comp.release.value=0.1;
    const lim=ctx.createDynamicsCompressor();lim.threshold.value=-1;lim.knee.value=0;lim.ratio.value=20;lim.attack.value=0.001;lim.release.value=0.05;
    const master=G(OUTK*P.master),ceil=ctx.createWaveShaper();ceil.curve=ceilCurve;
    const shift=G(1),limG=G(1),vol=G(0.5),out=G(1);
    // the rev limiter cuts in and out 15 times a second, whatever the frame rate
    const lf=F('lowpass',200,-3),limO=osc('square',lf),limD=G(0);limO.frequency.value=15;lf.connect(limD);limD.connect(limG.gain);
    const v={v6:true,ctx,oA,oB,oC,oD,oE,oG,ns,limO,bp,gD,gF,gG,drive,bark,pkMid,pkHigh,lp,shLow,shTop,master,shift,limG,limD,vol,out,eq:[hp,pkLow,pkMid,pkHigh,pkHarsh,lp,shLow,shTop],S:{gear:'N',thr:0,tv:0,onGrid:false,gT:0,gTg:9500,gR:9500,go:-1,go0:0,inCar:null}};
    chain(mix,drive,bark,sh,hp,pkLow,pkMid,pkHigh,pkHarsh,lp,shLow,shTop,comp,master,lim,ceil,shift,limG,vol,out);
    gG.connect(comp);   // the whistle joins behind the low-pass and the distortion: otherwise a closed throttle would cut it at once (it should fade), and it would ring against the sawtooth
    if(ctx.createStereoPanner){v.pan=ctx.createStereoPanner();out.connect(v.pan);v.pan.connect(dest);}else out.connect(dest);
    live.add(v);return v;}

  function stop(v){v.dead=true;live.delete(v);for(const o of [v.oA,v.oB,v.oC,v.oD,v.oE,v.oG,v.ns,v.limO])try{o.stop();}catch(e){}try{v.out.disconnect();if(v.pan)v.pan.disconnect();}catch(e){}}
  // a new race: nothing of the last one's start lights carries over (left during the countdown, the first frame read as lights out)
  function reset(v){v.S.onGrid=false;v.S.go=-1;v.S.gear='N';}

  // a 50 ms dip at an upshift (the revs themselves drop with the game's gear ratios)
  function upshift(v,t){const g=v.shift.gain;g.cancelScheduledValues(t);g.setTargetAtTime(0.5,t,0.004);g.setTargetAtTime(1,t+0.05,0.012);}
  // a downshift: a blip of the revs, louder, harder and brighter for a moment. Scheduled, so that it is as short at 30 fps as at 60
  function downshift(v,t,M,thr){const B=M.blip,go=(p,peak,rest)=>{p.cancelScheduledValues(t);p.setTargetAtTime(peak,t,B.up);p.setTargetAtTime(rest,t+B.hold,B.dn);};
    for(const o of [v.oA,v.oB,v.oC,v.oD])go(o.detune,B.c,0);go(v.bp.detune,B.c,0);go(v.shift.gain,Math.max(1.1,B.abs/lerp(M.offVol*OFFK,1,Math.pow(thr,0.7))),1);go(v.bark.gain,B.dr,1);
    go(v.lp.detune,1200*Math.log2(LP_OPEN/(M.offLP*Math.pow(LP_OPEN/M.offLP,thr))),0);}

  // o: {t, dt, rpm (the game's), thr 0..1, gear, inCar, dop (doppler), grid (on the start lights), pitLim}. Returns 1 at an upshift, 2 at a downshift.
  function update(v,o){const S=v.S,M=MODES[P.mode],t=o.t,dt=o.dt;let shifted=0;
    if(o.gear!==S.gear){const a=+S.gear,b=+o.gear;if(a&&b){if(b>a){shifted=1;upshift(v,t);}else{shifted=2;downshift(v,t,M,S.thr);}}S.gear=o.gear;}
    let r=mapRpm(o.rpm),th=o.thr;
    if(M.grid&&o.grid){   // 2026: the revs held high on the grid, wandering; they do not wait for the pedal
      if(!S.onGrid){S.onGrid=true;S.gT=0;S.gR=lerp(P.gridLo,P.gridHi,Math.random());S.go=-1;}
      S.gT-=dt;if(S.gT<=0){S.gT=0.3+Math.random()*0.5;S.gTg=lerp(P.gridLo,P.gridHi,Math.random());}
      S.gR+=(S.gTg-S.gR)*Math.min(1,dt*9);r=S.gR;th=Math.max(th,0.65);}
    else if(S.onGrid){S.onGrid=false;S.go=0;S.go0=S.gR;}   // lights out
    if(S.go>=0){   // the revs fall a little as the clutch bites, then the game's revs (the launch) take over
      S.go+=dt;const u=S.go,low=S.go0-900;if(u>=0.42)S.go=-1;else if(u<0.12)r=lerp(S.go0,low,u/0.12);else{const f=(u-0.12)/0.3;r=lerp(low,r,f*f*(3-2*f));}}
    S.thr+=(th-S.thr)*Math.min(1,dt*14);const T=S.thr;
    // the turbo value: its target rises with the throttle and the revs, and it takes its time (no MGU-H in 2026)
    {const tg=th*(0.35+0.65*clamp((r-4000)/7500,0,1));S.tv=tg>S.tv?Math.min(tg,S.tv+dt/M.up):Math.max(tg,S.tv-dt/M.dn);}
    const f=r*(o.dop||1)/20,k=M.tc;
    v.oA.frequency.setTargetAtTime(f,t,k);v.oB.frequency.setTargetAtTime(2*f,t,k);v.oC.frequency.setTargetAtTime(3*f,t,k);v.oD.frequency.setTargetAtTime(f,t,k);
    v.oE.frequency.setTargetAtTime(r/120,t,k);v.bp.frequency.setTargetAtTime(2*f,t,k);
    v.gD.gain.setTargetAtTime(DK*(0.15+0.85*T),t,0.03);
    v.gF.gain.setTargetAtTime(M.noise*P.noise,t,0.05);
    v.drive.gain.setTargetAtTime((0.4+P.dist*(0.1+T))/4,t,0.03);   // (/4: softCurve)
    v.lp.frequency.setTargetAtTime(M.offLP*Math.pow(LP_OPEN/M.offLP,T),t,0.03);
    v.vol.gain.setTargetAtTime(lerp(M.offVol*OFFK,1,Math.pow(T,0.7)),t,0.02);
    v.oG.frequency.setTargetAtTime(lerp(P.whLo,P.whHi,S.tv),t,0.05);v.gG.gain.setTargetAtTime(P.whistle*lerp(0.05,0.08,S.tv)*Math.min(1,S.tv/0.25),t,0.05);
    if(S.inCar!==o.inCar){S.inCar=o.inCar;v.shLow.gain.setTargetAtTime(o.inCar?2:0,t,0.1);v.shTop.gain.setTargetAtTime(o.inCar?0:2,t,0.1);}   // the cockpit a little more low end, outside a little more top
    const d=o.thr>=0.99&&o.rpm>12650&&!o.grid?0.9:o.pitLim?0.3:0;v.limD.gain.setTargetAtTime(d/2,t,0.005);v.limG.gain.setTargetAtTime(1-d/2,t,0.005);
    return shifted;}

  // ---- other cars: one oscillator holding layers A-C, a low-pass and a level (distance, doppler and the choice of three cars are the game's) ----
  function createLite(ctx,dest){const G=x=>{const g=ctx.createGain();g.gain.value=x;return g;};
    const w=ctx._esW||(ctx._esW=(()=>{const n=40,re=new Float32Array(n),im=new Float32Array(n);for(let i=1;i<n;i++){im[i]=1/i;if(i%2===0)im[i]+=0.5/(i/2);if(i%3===0)im[i]+=0.3/(i/3);}return ctx.createPeriodicWave(re,im);})());
    const o=ctx.createOscillator();o.setPeriodicWave(w);const lp=ctx.createBiquadFilter();lp.type='lowpass';lp.frequency.value=1500;lp.Q.value=-3;const out=G(0),v={lite:true,o,lp,out};o.connect(lp);lp.connect(out);o.start();
    if(ctx.createStereoPanner){v.pan=ctx.createStereoPanner();out.connect(v.pan);v.pan.connect(dest);}else out.connect(dest);return v;}
  function setLite(v,t,rpm,dop,level,cut,tc){v.o.frequency.setTargetAtTime(mapRpm(rpm)*dop/20,t,tc||0.03);v.lp.frequency.setTargetAtTime(cut,t,0.03);v.out.gain.setTargetAtTime(level,t,0.008);}

  // ---- hear it without a race: the grid, a launch, three upshifts, a lift, three downshifts, idle. Runs on a timer, so the sliders are heard as they move ----
  function preview(ctx,dest,onShift,onEnd){const v=create(ctx,dest),t0=ctx.currentTime,PULL=0.72,END=6.6;let r=4000,last=t0,done=false,fade=false;v.out.gain.value=0;v.out.gain.setTargetAtTime(1,t0,0.02);
    const stopIt=()=>{if(done)return;done=true;clearInterval(iv);stop(v);};
    const tick=()=>{const now=ctx.currentTime,T=now-t0,dt=Math.max(0.001,now-last);last=now;if(T>=END){stopIt();if(onEnd)onEnd();return;}if(T>=END-0.12&&!fade){fade=true;v.out.gain.setTargetAtTime(0,now,0.03);}
      let tg=4000,thr=0,g='N',grid=false;
      if(T<1.5)grid=true;
      else if(T<1.5+3*PULL){const u=T-1.5,n=Math.floor(u/PULL),a=[8200,9860,10250][n];thr=1;g=String(n+1);tg=a+(12350-a)*(u-n*PULL)/PULL;}
      else if(T<4.2){g='4';tg=10600-(T-3.66)*900;}
      else if(T<5.0){const n=Math.floor((T-4.2)/0.26);g=String(Math.max(1,3-n));tg=11000-((T-4.2)%0.26)*3800;}
      else g='1';
      r+=(tg-r)*Math.min(1,dt*(tg<r-250?38:18));const sh=update(v,{t:now,dt,rpm:r,thr,gear:g,inCar:true,dop:1,grid});if(sh&&onShift)onShift(sh,now);};
    const iv=setInterval(tick,20);tick();
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
@media (max-width:540px){#engTune .etB{grid-template-columns:1fr}#engTune .etH{flex-wrap:wrap}#engTune .etSeg{order:3;flex-basis:100%}#engTune .etX{margin-left:auto}}`;
  function slider(host,q,onMove){const keys=[].concat(q[0]),[,,lo,hi,step,fmt]=q,el=document.createElement('div');el.className='etR';
    el.innerHTML=`<div class="etL">${q[1]}<span></span></div><div class="etS"><div class="etT"></div><div class="etF"></div>${keys.map(()=>'<div class="etK"></div>').join('')}</div>`;host.appendChild(el);
    const S=el.querySelector('.etS'),Fl=el.querySelector('.etF'),Ks=[...el.querySelectorAll('.etK')],R=el.querySelector('.etL span');
    const inset=11,pos=v=>`calc(${inset}px + (100% - ${2*inset}px) * ${(v-lo)/(hi-lo)})`;
    const draw=()=>{keys.forEach((k,i)=>{Ks[i].style.left=pos(P[k]);});Fl.style.left=keys.length>1?pos(P[keys[0]]):pos(lo);Fl.style.width=`calc((100% - ${2*inset}px) * ${(P[keys[keys.length-1]]-(keys.length>1?P[keys[0]]:lo))/(hi-lo)})`;R.textContent=keys.length>1?fmt(P[keys[0]]).replace(/ .*/,'')+'~'+fmt(P[keys[1]]):fmt(P[keys[0]]);};
    let act=null;const at=e=>{const b=S.getBoundingClientRect();return lo+clamp((e.clientX-b.left-inset)/(b.width-2*inset),0,1)*(hi-lo);};
    const set=(k,x)=>{x=Math.round(x/step)*step;x=+x.toFixed(4);if(k===keys[0]&&keys.length>1)x=Math.min(x,P[keys[1]]);if(k===keys[1])x=Math.max(x,P[keys[0]]);P[k]=clamp(x,lo,hi);draw();onMove();};
    let pid=null,pick=null;
    S.addEventListener('pointerdown',e=>{if(pid!=null)return;e.preventDefault();e.stopPropagation();pid=e.pointerId;try{S.setPointerCapture(pid);}catch(er){}const x=at(e);
      if(keys.length>1&&P[keys[0]]===P[keys[1]]){act=null;pick=x;return;}   // the two handles on top of each other: the first move decides which one
      act=keys.reduce((a,k)=>Math.abs(P[k]-x)<Math.abs(P[a]-x)?k:a,keys[0]);set(act,x);});
    S.addEventListener('pointermove',e=>{if(e.pointerId!==pid)return;const x=at(e);if(pick!=null){if(Math.abs(x-pick)<step/2)return;act=x<pick?keys[0]:keys[1];pick=null;}if(act)set(act,x);});
    const end=e=>{if(e.pointerId!==pid)return;pid=null;act=null;pick=null;save();};S.addEventListener('pointerup',end);S.addEventListener('pointercancel',end);S.addEventListener('lostpointercapture',end);
    return draw;}
  function build(){const st=document.createElement('style');st.textContent=CSS;document.head.appendChild(st);box=document.createElement('div');box.id='engTune';box.hidden=true;
    box.innerHTML=`<div class="etC"><div class="etH"><b>엔진 소리 튜닝</b><div class="etSeg"><button type="button" data-m="2025">2025 스타일</button><button type="button" data-m="2026">2026 실제 스타일</button></div><button type="button" class="etX">닫기</button></div><div class="etB"></div><div class="etA"><button type="button" class="etGo">소리 듣기</button><button type="button" class="etD">기본값으로</button></div></div>`;document.body.appendChild(box);
    const body=box.querySelector('.etB'),apply=()=>{for(const v of live)applyP(v);},draws=SLIDERS.map(q=>slider(body,q,apply)),seg=[...box.querySelectorAll('.etSeg button')],drawSeg=()=>seg.forEach(b=>b.setAttribute('aria-pressed',b.dataset.m===P.mode?'true':'false'));
    const redraw=()=>{draws.forEach(d=>d());drawSeg();};box._redraw=redraw;
    seg.forEach(b=>b.addEventListener('click',()=>{P.mode=b.dataset.m;save();drawSeg();}));
    box.querySelector('.etX').addEventListener('click',()=>{box.hidden=true;});
    box.querySelector('.etGo').addEventListener('click',()=>{if(hooks.preview)hooks.preview();});
    box.querySelector('.etD').addEventListener('click',()=>{Object.assign(P,DEF);save();apply();redraw();});
    box.addEventListener('click',e=>{if(e.target===box)box.hidden=true;});}
  function openPanel(){if(!box)build();box._redraw();box.hidden=false;}
  // hooks: {preview, hidden (the element tapped 5 times to open the panel on a phone), ctx (the AudioContext, once there is one), mayResume}
  function setup(h){hooks=h;
    addEventListener('keydown',e=>{if(e.code!=='KeyT'||e.repeat||/^(INPUT|TEXTAREA)$/.test(e.target.tagName||''))return;if(box&&!box.hidden)box.hidden=true;else openPanel();});
    if(h.hidden){let n=0,last=0;h.hidden.addEventListener('pointerup',e=>{n=e.timeStamp-last<800?n+1:1;last=e.timeStamp;if(n>=5){n=0;setTimeout(openPanel,320);}});}
    // phones hold an AudioContext until a touch starts it, and a call leaves it interrupted
    const wake=()=>{const c=h.ctx&&h.ctx();if(c&&c.state!=='running'&&c.state!=='closed'&&(!h.mayResume||h.mayResume()))c.resume();};
    for(const ty of['touchend','pointerdown','keydown'])addEventListener(ty,wake,{capture:true,passive:true});}
  return {P,MODES,mapRpm,create,update,stop,reset,createLite,setLite,preview,setup,openPanel};
})();
