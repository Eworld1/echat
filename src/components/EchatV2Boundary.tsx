import React from 'react';

interface Props { onClassic:()=>void; children:React.ReactNode; }
interface State { failed:boolean; }
/** A V2 rendering failure falls back to classic Echat instead of replacing its app shell. */
export class EchatV2Boundary extends React.Component<Props,State>{
  state:State={failed:false};
  static getDerivedStateFromError():State{return{failed:true};}
  componentDidCatch(error:Error){console.error('[Echat V2] Isolated feature error:',error);}
  render(){if(this.state.failed)return <main className="grid min-h-dvh place-items-center bg-[#F0F2F5] p-6 text-center"><div className="max-w-md rounded-3xl bg-white p-7 shadow-xl"><h1 className="text-xl font-extrabold">New Echat couldn’t load</h1><p className="mt-2 text-sm text-slate-600">Your classic Echat account and data are unchanged.</p><button onClick={this.props.onClassic} className="mt-5 rounded-full bg-slate-900 px-5 py-3 font-bold text-white">Back to Classic Echat</button></div></main>;return this.props.children;}
}
