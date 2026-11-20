import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, Check, MessageCircle, Pause, Play, RotateCcw, SkipForward, Volume2, VolumeX, X } from 'lucide-react';
import './echat-v2-intro.css';

const DURATION = 30;
const scenes = [
  { title: 'Echat is NEW', subtitle: 'Chat, Connect, Belong - Like Never Before', kind: 'intro' },
  { title: 'Your Space - Moments, Posts & Vibes in One Place', subtitle: 'Catch up with the people and moments you care about.', kind: 'home' },
  { title: 'Vibes - Swipe. Fire. Spread.', subtitle: 'Find your people and grow Your Circle.', kind: 'vibes' },
  { title: 'Echat Chat - Reply, Voice & Delete for Everyone', subtitle: 'Every conversation, all in one place.', kind: 'chat' },
  { title: 'Echat Market - Order on WhatsApp in 1 Tap', subtitle: 'Discover something special from your community.', kind: 'market' },
  { title: 'Echat is LIVE - Your Echat, Your Way', subtitle: 'Chat, Connect, Belong', kind: 'outro' },
];

interface Props { mode?: 'modal' | 'inline'; onClose?: () => void; onExplore?: () => void; }

const ScenePreview: React.FC<{kind:string}> = ({kind}) => {
  if (kind === 'intro' || kind === 'outro') return <div className="ev2-brand"><span className="ev2-logo">E</span><b>EchatSl</b></div>;
  if (kind === 'home') return <div className="ev2-mock ev2-home-mock"><div className="ev2-moments"><i>🌅</i><i>😊</i><i>🎸</i><i>✨</i></div><div className="ev2-compose">What’s on your mind?</div><div className="ev2-post"><b>Friends in Your Space</b><div className="ev2-post-image">A good day to connect ✨</div></div></div>;
  if (kind === 'vibes') return <div className="ev2-vibes-mock"><div className="ev2-vibe-card"><span>VIBES</span><strong>🔥</strong><small>Double tap to spread the fire</small></div><div className="ev2-circle-card"><i/>Your Circle <button type="button">Connect</button></div></div>;
  if (kind === 'chat') return <div className="ev2-chat-mock"><div className="ev2-bubble left">Hey! Check this out 📸</div><div className="ev2-photo">🌄</div><div className="ev2-bubble right">That looks amazing!</div><div className="ev2-deleted">This message was deleted</div></div>;
  return <div className="ev2-market-mock"><div className="ev2-mug">☕</div><div className="ev2-product"><b>Ceramic Mug</b><strong>$24</strong><button type="button">Chat in Echat</button><button type="button" className="ev2-whatsapp"><MessageCircle size={15}/> Order on WhatsApp</button></div></div>;
};

export const EchatV2IntroVideo: React.FC<Props> = ({mode='modal', onClose, onExplore}) => {
  const [elapsed,setElapsed]=useState(0);
  const [playing,setPlaying]=useState(true);
  const [muted,setMuted]=useState(true);
  const [finished,setFinished]=useState(false);
  const [soundReady,setSoundReady]=useState(false);
  const sceneIndex=Math.min(Math.floor(elapsed/5),5);
  const scene=scenes[sceneIndex];
  useEffect(()=>{if(!playing||finished)return;const timer=window.setInterval(()=>setElapsed(value=>{if(value+0.1>=DURATION){setFinished(true);setPlaying(false);return DURATION;}return value+0.1;}),100);return()=>window.clearInterval(timer);},[playing,finished]);
  useEffect(()=>{if(mode!=='modal')return;const key=(event:KeyboardEvent)=>{if(event.key==='Escape')onClose?.();if(event.code==='Space'&&!(event.target instanceof HTMLInputElement)){event.preventDefault();setPlaying(value=>!value);}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[mode,onClose]);
  const replay=()=>{setElapsed(0);setFinished(false);setPlaying(true);};
  const toggleSound=()=>{setMuted(value=>!value);setSoundReady(true);};
  const content=<div className={`ev2-tour ${mode==='inline'?'ev2-inline':''}`} role={mode==='modal'?'dialog':undefined} aria-modal={mode==='modal'?true:undefined} aria-label="Echat animated tour">
    {mode==='modal'&&<button className="ev2-close" aria-label="Close tour" onClick={onClose}><X size={22}/></button>}
    <div className={`ev2-stage ev2-scene-${scene.kind}`}>
      <div className="ev2-scene-inner" key={scene.kind}><ScenePreview kind={scene.kind}/><h1>{scene.title}</h1><p>{scene.subtitle}</p></div>
      {finished&&<div className="ev2-end-actions"><button type="button" className="ev2-explore" onClick={onExplore}>Open Echat Home <ArrowRight size={18}/></button><button type="button" className="ev2-watch" onClick={replay}><RotateCcw size={16}/> Watch Again</button></div>}
      <div className="ev2-controls"><div className="ev2-progress"><span>{`0:${String(Math.floor(elapsed)).padStart(2,'0')}`}</span><input aria-label="Tour progress" type="range" min="0" max={DURATION} step="0.1" value={elapsed} onChange={event=>{const value=Number(event.target.value);setElapsed(value);setFinished(value>=DURATION);}}/><span>0:30</span></div><div className="ev2-control-buttons"><button type="button" aria-label={playing?'Pause':'Play'} onClick={()=>setPlaying(value=>!value)}>{playing?<Pause size={18}/>:<Play size={18}/>}</button><button type="button" aria-label={muted?'Unmute':'Mute'} onClick={toggleSound}>{muted?<VolumeX size={18}/>:<Volume2 size={18}/>}<span>{muted?'Unmute':'Mute'}</span></button><button type="button" onClick={()=>{setElapsed(DURATION);setFinished(true);setPlaying(false);}}><SkipForward size={18}/><span>Skip</span></button><button type="button" onClick={replay}><RotateCcw size={18}/><span>Replay</span></button></div>{soundReady&&!muted&&<span className="ev2-sound-note"><Check size={12}/> Sound is enabled when audio is available</span>}</div>
    </div>
  </div>;
  if(mode==='inline')return content;
  return createPortal(<div className="ev2-tour-backdrop">{content}</div>,document.body);
};
