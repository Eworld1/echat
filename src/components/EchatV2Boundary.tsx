import React from 'react';

interface Props { children:React.ReactNode; }
interface State { failed:boolean; }
/** An isolated V2 rendering failure keeps classic source code intact and offers a V2 reload. */
export class EchatV2Boundary extends React.Component<Props,State>{
  state:State={failed:false};
  static getDerivedStateFromError():State{return{failed:true};}
  componentDidCatch(error:Error){console.error('[Echat] Isolated feature error:',error);}
  render(){if(this.state.failed)return <main className="grid min-h-dvh place-items-center bg-[#F0F2F5] p-6 text-center"><div className="max-w-md rounded-3xl bg-white p-7 shadow-xl"><h1 className="text-xl font-extrabold">Echat could not load this screen</h1><p className="mt-2 text-sm text-slate-600">Your account and saved data are unchanged.</p><button onClick={()=>window.location.assign('/v2/home')} className="mt-5 rounded-full bg-slate-900 px-5 py-3 font-bold text-white">Reload Echat</button></div></main>;return this.props.children;}
}
