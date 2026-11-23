import React, { useEffect, useRef, useState } from 'react';

type Ball = { x: number; y: number; vx: number; vy: number; color: string; cue?: boolean };
const pockets = [[20,20],[240,18],[460,20],[20,260],[240,262],[460,260]];
const rack = (): Ball[] => [
  { x: 110, y: 140, vx: 0, vy: 0, color: '#f8fafc', cue: true },
  ...['#ef4444','#facc15','#3b82f6','#f97316','#a855f7','#22c55e','#111827','#f8fafc'].map((color,i)=>({x:290+(i%3)*19,y:112+Math.floor(i/3)*20+(i%2)*8,vx:0,vy:0,color}))
];

export const V2Pool: React.FC<{ resetKey: number; onWin: (score:number)=>void; onShot?:()=>void; onPocket?:()=>void }> = ({ resetKey, onWin, onShot, onPocket }) => {
  const canvas=useRef<HTMLCanvasElement>(null), balls=useRef<Ball[]>(rack()), aim=useRef({x:350,y:140}), moving=useRef(false), done=useRef(false), win=useRef(onWin), shot=useRef(onShot), pocket=useRef(onPocket), shotCount=useRef(0), previousCount=useRef(8);
  const [remaining,setRemaining]=useState(8),[shots,setShots]=useState(0);
  win.current=onWin;shot.current=onShot;pocket.current=onPocket;
  useEffect(()=>{
    balls.current=rack();moving.current=false;done.current=false;shotCount.current=0;previousCount.current=8;setRemaining(8);setShots(0);
    let frame=0;
    const draw=()=>{
      const el=canvas.current,ctx=el?.getContext('2d');if(!el||!ctx)return;
      ctx.clearRect(0,0,480,280);ctx.fillStyle='#563b29';ctx.fillRect(0,0,480,280);ctx.fillStyle='#16734b';ctx.fillRect(20,20,440,240);
      for(const [x,y] of pockets){ctx.beginPath();ctx.arc(x,y,15,0,Math.PI*2);ctx.fillStyle='#101820';ctx.fill();}
      const pocketed=(x:number,y:number)=>pockets.some(([px,py])=>Math.hypot(px-x,py-y)<18);
      for(const b of balls.current){if(!moving.current)continue;b.x+=b.vx;b.y+=b.vy;b.vx*=.987;b.vy*=.987;if(b.x<31||b.x>449)b.vx*=-.92;if(b.y<31||b.y>249)b.vy*=-.92;if(Math.abs(b.vx)+Math.abs(b.vy)<.06)b.vx=b.vy=0;if(!b.cue&&pocketed(b.x,b.y))b.color='transparent';if(b.cue&&pocketed(b.x,b.y)){b.x=110;b.y=140;b.vx=b.vy=0;}}
      balls.current=balls.current.filter(b=>b.cue||b.color!=='transparent');
      for(let i=0;i<balls.current.length;i++)for(let j=i+1;j<balls.current.length;j++){const a=balls.current[i],b=balls.current[j],dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy);if(d>0&&d<19){const nx=dx/d,ny=dy/d,av=a.vx*nx+a.vy*ny,bv=b.vx*nx+b.vy*ny,delta=bv-av;a.vx+=delta*nx;a.vy+=delta*ny;b.vx-=delta*nx;b.vy-=delta*ny;const overlap=(19-d)/2;a.x-=nx*overlap;a.y-=ny*overlap;b.x+=nx*overlap;b.y+=ny*overlap;}}
      for(const b of balls.current){ctx.beginPath();ctx.arc(b.x,b.y,9,0,Math.PI*2);ctx.fillStyle=b.color;ctx.fill();ctx.strokeStyle='#e2e8f0';ctx.stroke();}
      const cue=balls.current.find(b=>b.cue);if(cue&&!moving.current){ctx.beginPath();ctx.moveTo(cue.x,cue.y);ctx.lineTo(aim.current.x,aim.current.y);ctx.strokeStyle='rgba(255,255,255,.5)';ctx.setLineDash([5,5]);ctx.stroke();ctx.setLineDash([]);}
      if(!balls.current.some(b=>Math.abs(b.vx)+Math.abs(b.vy)>.07))moving.current=false;
      const count=balls.current.filter(b=>!b.cue).length;if(count<previousCount.current)pocket.current?.();previousCount.current=count;setRemaining(old=>old===count?old:count);if(!count&&!done.current){done.current=true;win.current(Math.max(1,80-shotCount.current*5));}
      frame=requestAnimationFrame(draw);
    };
    frame=requestAnimationFrame(draw);return()=>cancelAnimationFrame(frame);
  },[resetKey]);
  const point=(e:React.PointerEvent<HTMLCanvasElement>)=>{const r=e.currentTarget.getBoundingClientRect();aim.current={x:(e.clientX-r.left)*480/r.width,y:(e.clientY-r.top)*280/r.height};};
  const shoot=(e:React.PointerEvent<HTMLCanvasElement>)=>{if(moving.current||done.current)return;point(e);const cue=balls.current.find(b=>b.cue);if(!cue)return;const dx=aim.current.x-cue.x,dy=aim.current.y-cue.y,n=Math.hypot(dx,dy)||1;cue.vx=dx/n*8;cue.vy=dy/n*8;moving.current=true;shotCount.current+=1;shot.current?.();setShots(shotCount.current);};
  return <div className="mx-auto max-w-lg text-center"><p className="mb-2">Balls remaining: {remaining} · Shots: {shots} · Aim, then tap to shoot.</p><canvas ref={canvas} width={480} height={280} onPointerMove={point} onPointerDown={shoot} aria-label="Pool table. Aim and tap to shoot." className="w-full touch-none rounded-2xl border-4 border-[#563b29]"/><p className="mt-2 text-xs text-slate-500">Pocket all eight balls. The cue ball resets if it falls in a pocket.</p></div>;
};
