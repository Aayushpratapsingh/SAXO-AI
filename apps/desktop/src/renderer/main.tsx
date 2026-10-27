import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowUp, Check, CheckCircle2, CircleHelp, Globe2, History, LockKeyhole, MessageSquare, Mic, MoreHorizontal, Search, Settings2, ShieldCheck, Sparkles, X, Play, Pause } from 'lucide-react';
import saxoMark from './assets/saxo-mark.png';
import './style.css';

const saxo = window.saxo;

type Action = { kind:'navigate'|'search-web'|'search-youtube'|'open-video'|'play-video'; title: string; detail: string; reason: string; status: 'pending'|'running'|'succeeded'|'rejected'|'failed'; actionId: string; approvalToken: string; result?: string; video?:{url:string;title:string;thumbnail?:string} };
type ChatMessage = { id?:string; turnId?:string; role:'user'|'assistant'; content:string; audioUrl?:string; audioDuration?:number; mimeType?:string; transcript?:string; transcriptError?:string };
type Turn = { id: string; request: string; actions: Action[]; active: number; status: string; youtubeQuery?:string; playFirstResult?:boolean; firstYoutubeVideo?:boolean; followupQuery?:string; followupSite?:string; kind?:'browser'|'chat'; reply?:string };
const conversationKey='saxo.conversation.v1';
function loadConversation():ChatMessage[]{try{const parsed=JSON.parse(localStorage.getItem(conversationKey)||'[]');if(!Array.isArray(parsed))return[];const messages:ChatMessage[]=parsed.filter(item=>item&&['user','assistant'].includes(item.role)&&typeof item.content==='string').map(item=>({...item,audioUrl:undefined}));const unfinished=new Set(messages.filter(item=>item.role==='user'&&item.turnId).map(item=>item.turnId));for(const message of messages)if(message.role==='assistant'&&message.turnId)unfinished.delete(message.turnId);for(const id of unfinished)messages.push({role:'assistant',turnId:id,content:'SAXO closed before this browser task finished. Send the request again to continue.'});return messages}catch{return[]}}
function inlineFormatting(text:string):React.ReactNode[]{
  const pattern=/(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_|\[[^\]]+\]\(https?:\/\/[^\s)]+\)|https?:\/\/[^\s]+)/g;
  return text.split(pattern).filter(Boolean).map((part,index)=>{
    if(part.startsWith('`')&&part.endsWith('`'))return <code key={index}>{part.slice(1,-1)}</code>;
    if((part.startsWith('**')&&part.endsWith('**'))||(part.startsWith('__')&&part.endsWith('__')))return <strong key={index}>{part.slice(2,-2)}</strong>;
    if((part.startsWith('*')&&part.endsWith('*'))||(part.startsWith('_')&&part.endsWith('_')))return <em key={index}>{part.slice(1,-1)}</em>;
    const link=part.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);
    if(link)return <span className="formatted-link" title={link[2]} key={index}>{link[1]}</span>;
    return <React.Fragment key={index}>{part}</React.Fragment>;
  });
}
function FormattedMessage({text}:{text:string}){
  const lines=text.replace(/\r/g,'').split('\n');
  const blocks:React.ReactNode[]=[];let i=0,key=0;
  const special=(line:string)=>/^\s*(?:#{1,4}\s|[-*+]\s|\d+[.)]\s|>\s|```)/.test(line);
  while(i<lines.length){const line=lines[i].trim();if(!line){i++;continue}const id=key++;
    if(line.startsWith('```')){const code:string[]=[];i++;while(i<lines.length&&!lines[i].trim().startsWith('```'))code.push(lines[i++]);if(i<lines.length)i++;blocks.push(<pre key={id}><code>{code.join('\n')}</code></pre>);continue}
    const heading=line.match(/^(#{1,4})\s+(.+)$/);if(heading){const Tag=`h${Math.min(heading[1].length+1,4)}` as 'h2'|'h3'|'h4';blocks.push(<Tag key={id}>{inlineFormatting(heading[2])}</Tag>);i++;continue}
    const bullet=line.match(/^[-*+]\s+(.+)$/);if(bullet){const items:React.ReactNode[]=[];while(i<lines.length){const item=lines[i].trim().match(/^[-*+]\s+(.+)$/);if(!item)break;items.push(<li key={items.length}>{inlineFormatting(item[1])}</li>);i++}blocks.push(<ul key={id}>{items}</ul>);continue}
    const numbered=line.match(/^\d+[.)]\s+(.+)$/);if(numbered){const items:React.ReactNode[]=[];while(i<lines.length){const item=lines[i].trim().match(/^\d+[.)]\s+(.+)$/);if(!item)break;items.push(<li key={items.length}>{inlineFormatting(item[1])}</li>);i++}blocks.push(<ol key={id}>{items}</ol>);continue}
    if(line.startsWith('> ')){const quote:string[]=[];while(i<lines.length&&lines[i].trim().startsWith('> '))quote.push(lines[i++].trim().slice(2));blocks.push(<blockquote key={id}>{inlineFormatting(quote.join(' '))}</blockquote>);continue}
    const paragraph=[line];i++;while(i<lines.length&&lines[i].trim()&&!special(lines[i]))paragraph.push(lines[i++].trim());blocks.push(<p key={id}>{inlineFormatting(paragraph.join(' '))}</p>);
  }
  return <div className="formatted-message">{blocks}</div>;
}
function App() {
  const [text, setText] = useState('');
  const [turn, setTurnState] = useState<Turn | null>(null);
  const turnRef = useRef<Turn | null>(null);
  const setTurn = (nextOrUpdater: React.SetStateAction<Turn | null>) => setTurnState(current => {
    const next = typeof nextOrUpdater === 'function' ? nextOrUpdater(current) : nextOrUpdater;
    turnRef.current = next;
    return next;
  });
  const [history, setHistory] = useState<string[]>(()=>loadConversation().filter(message=>message.role==='user').map(message=>message.content).slice(-5).reverse());
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(loadConversation);
  const chatEndRef = useRef<HTMLDivElement|null>(null);
  const restoringVoice = useRef(new Set<string>());
  const [browser, setBrowser] = useState<{connected:boolean;url:string|null}>({connected:false,url:null});
  useEffect(()=>{try{localStorage.setItem(conversationKey,JSON.stringify(chatMessages.map(({audioUrl,...message})=>message)))}catch{/* Keep the active conversation usable if local storage is full. */}},[chatMessages]);
  useEffect(()=>{for(const message of chatMessages){if(!message.id||!message.mimeType||message.audioUrl||!message.audioDuration||restoringVoice.current.has(message.id))continue;restoringVoice.current.add(message.id);void saxo.readVoiceMessage({messageId:message.id,mimeType:message.mimeType}).then(({audioBase64})=>{const binary=atob(audioBase64);const bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);const audioUrl=URL.createObjectURL(new Blob([bytes],{type:message.mimeType}));setChatMessages(current=>current.map(item=>item.id===message.id&&!item.audioUrl?{...item,audioUrl}:item))}).catch(()=>{}).finally(()=>restoringVoice.current.delete(message.id!))}},[chatMessages]);
  useEffect(()=>{chatEndRef.current?.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'end'})},[chatMessages,turn?.status]);
  const proposeStep = async (taskId:string, kind:Action['kind'], detail:string, video?:Action['video'], site='') => {
    const titles:Record<Action['kind'],string>={navigate:'Open website', 'search-web':'Search website', 'search-youtube':'Search YouTube', 'open-video':'Open video', 'play-video':'Play video'};
    const reasons:Record<Action['kind'],string>={navigate:'Open the requested website.', 'search-web':'Submit this exact search query.', 'search-youtube':'Submit this exact query on the YouTube page that is already open.', 'open-video':'Open the first video shown in the search result.', 'play-video':'Start playback of the selected video.'};
    const action:Action={kind,title:titles[kind],detail,reason:reasons[kind],status:'pending',actionId:'',approvalToken:'',video};
    setTurn(current=>current?.id===taskId?{...current,actions:[...current.actions,action],active:current.actions.length,status:'Preparing approval'}:current);
    try {
      const payload = kind==='navigate'?{type:'navigate' as const,url:detail,reason:action.reason}:kind==='search-web'?{type:'search-web' as const,query:detail,site,reason:action.reason}:kind==='search-youtube'?{type:'search-youtube' as const,query:detail,reason:action.reason}:kind==='open-video'?{type:'open-video' as const,url:detail,title:video?.title||'',reason:action.reason}:{type:'play-video' as const,url:detail,title:video?.title||'',reason:action.reason};
  const proposal=await saxo.propose({taskId,action:payload});
      setTurn(current=>current?.id===taskId?{...current,actions:current.actions.map((a,i)=>i===current.actions.length-1?{...a,actionId:proposal.actionId,approvalToken:proposal.approvalToken}:a),status:'Awaiting approval'}:current);
    } catch(error) { setTurn(current=>current?.id===taskId?{...current,actions:current.actions.map((a,i)=>i===current.actions.length-1?{...a,status:'failed',result:error instanceof Error?error.message:'Could not prepare approval'}:a),status:'Could not prepare action'}:current); }
  };
  const submit = async (providedText?:string, transcriptAlreadyInChat=false) => {
    const request=(providedText??text).trim(); if(!request)return;
    const youtubeMatch=request.match(/(?:search|look\s+up|find)\s+(?:(?:on\s+)?youtube\s+)?(?:for\s+)?["“]?(.+?)["”]?\s*(?:on\s+youtube)?\s*$/i);
    const playFirst=/\b(play|start|watch)\b/i.test(request)&&/\b(first|top)\b/i.test(request);
    const firstYoutubeVideo=playFirst&&/\byoutube\b/i.test(request)&&!youtubeMatch;
    const youtubeIntent=/\byoutube\b/i.test(request)||playFirst;
    const youtubeQuery=youtubeIntent&&youtubeMatch?youtubeMatch[1].trim().replace(/\s+and\s+(?:play|open|watch)\s+(?:the\s+)?(?:first|top)\s+(?:video|result).*$/i,'').replace(/^(?:the\s+)?(?:first|top)\s+(?:video|result)\s+(?:for|of)\s+/i,'').trim():undefined;
    const urlMatch=request.match(/https?:\/\/[^\s]+/i);
    const siteQuery=request.match(/(?:search|look\s+up|find)\s+(?:(?:google|github|reddit|youtube)\s+)?(?:for\s+)?["“]?(.+?)["”]?\s*$/i)?.[1]?.trim();
    const openedSite=request.match(/\b(?:open|go\s+to|visit)\s+(?:github|reddit|youtube|google|wikipedia|stackoverflow|stack\s*overflow|([a-z0-9-]+\.[a-z]{2,}))\b/i);
    const siteName=request.toLowerCase().includes('github')?'github.com':request.toLowerCase().includes('reddit')?'reddit.com':request.toLowerCase().includes('stackoverflow')?'stackoverflow.com':request.toLowerCase().includes('wikipedia')?'wikipedia.org':request.toLowerCase().includes('youtube')?'youtube.com':request.toLowerCase().includes('google')?'google.com':'';
    const explicitGoogle=/\bgoogle\b/i.test(request);
    const directUrl=urlMatch?.[0].replace(/[.,!?)]+$/,'');
    let navigationUrl=directUrl;
    if(!navigationUrl&&openedSite){const hostname=openedSite[1]||siteName||'google.com';navigationUrl=`https://${hostname.replace(/^https?:\/\//,'')}`;}
    if(!navigationUrl&&/\b(?:open|visit|go\s+to)\s+[a-z0-9-]+\.[a-z]{2,}/i.test(request)){
      const host=request.match(/\b(?:open|visit|go\s+to)\s+((?:[a-z0-9-]+\.)+[a-z]{2,})/i)?.[1];if(host)navigationUrl=`https://${host}`;
    }
    const isBrowserRequest=Boolean(navigationUrl||youtubeQuery||firstYoutubeVideo||siteQuery||/\b(search|open|visit|go\s+to)\b/i.test(request)&&openedSite);
    const taskId=crypto.randomUUID();
    if(!isBrowserRequest){
      if(turn?.kind==='chat'&&turn.status==='Thinking')return;
      const userMessage:ChatMessage={role:'user',content:request};
      const context=[...chatMessages.filter(item=>!item.audioUrl&&(item.content.trim()||item.transcript)).map(item=>({role:item.role,content:item.transcript&&item.content==='Voice message'?item.transcript:item.content.trim()||item.transcript||''})),userMessage].slice(-12);
      if(!transcriptAlreadyInChat)setChatMessages(current=>[...current,userMessage]);
      setTurn({id:taskId,kind:'chat',request,actions:[],active:0,status:'Thinking'});setHistory(h=>[request,...h]);setText('');
      try{const answer=await saxo.chat({messages:context});setChatMessages(current=>[...current,{role:'assistant',content:answer.text}]);setTurn(current=>current?.id===taskId?{...current,status:'Ready',reply:answer.text}:current)}
      catch(error){const message=error instanceof Error?error.message:'SAXO could not respond. Try again.';setTurn(current=>current?.id===taskId?{...current,status:'Could not respond',reply:message}:current)}
      return;
    }
    const state=await saxo.browserStatus();setBrowser(state);
    const alreadyOnYoutube=state.connected&&!!state.url&&/^https:\/\/(?:www\.)?youtube\.com\//i.test(state.url);
    const hasSeparateOpenAndSearch=Boolean(openedSite&&siteQuery&&!youtubeQuery);
    const needsBrowserForSearch=Boolean(siteQuery&&!youtubeQuery&&!state.connected&&!hasSeparateOpenAndSearch);
    const searchSite=siteName==='google.com'?'':siteName;
    const followSearch=hasSeparateOpenAndSearch||needsBrowserForSearch;
    const searchHost=needsBrowserForSearch?(explicitGoogle?'https://www.google.com/':searchSite?`https://${searchSite}`:'https://www.google.com/'):navigationUrl;
    const turnData:Turn={id:taskId,kind:'browser',request,actions:[],active:0,status:'Preparing browser action',youtubeQuery,playFirstResult:playFirst,firstYoutubeVideo,followupQuery:followSearch?siteQuery:undefined,followupSite:followSearch?searchSite:undefined};
    if(!transcriptAlreadyInChat)setChatMessages(current=>[...current,{role:'user',content:request,turnId:taskId}]);
    setTurn(turnData);setHistory(h=>[request,...h]);setText('');
    if(youtubeQuery){
      if(alreadyOnYoutube)await proposeStep(taskId,'search-youtube',youtubeQuery);
      else await proposeStep(taskId,'navigate','https://www.youtube.com/');
    } else if(firstYoutubeVideo){
      if(alreadyOnYoutube){try{const video=await saxo.firstYouTubeVideo();await proposeStep(taskId,'open-video',video.url,video)}catch(error){setTurn(current=>current?.id===taskId?{...current,status:error instanceof Error?error.message:'No YouTube video is available'}:current)}}
      else await proposeStep(taskId,'navigate','https://www.youtube.com/');
    } else if(followSearch&&searchHost){await proposeStep(taskId,'navigate',searchHost)}
    else if(siteQuery){await proposeStep(taskId,'search-web',siteQuery,undefined,explicitGoogle?'':searchSite)}
    else if(navigationUrl)await proposeStep(taskId,'navigate',navigationUrl);
    else if(openedSite)await proposeStep(taskId,'navigate',navigationUrl||'https://www.google.com/');
    else {setTurn(current=>current?.id===taskId?{...current,status:'Could not understand browser request'}:current)}
  };
  const decide = async (approve:boolean) => {
    const current=turn, active=current?.actions[current.active];if(!current||!active||!active.actionId)return;
    if(!approve){await saxo.reject(active.actionId);setTurn({...current,actions:current.actions.map((a,i)=>i===current.active?{...a,status:'rejected'}:a),status:'Stopped · action rejected'});appendBrowserReply(current.id,`Stopped before this browser action: ${active.title}.`);return;}
    setTurn({...current,actions:current.actions.map((a,i)=>i===current.active?{...a,status:'running'}:a),status:active.kind.startsWith('search')?'Searching':'Opening approved page'});
    const outcome=await saxo.approve({taskId:current.id,actionId:active.actionId,approvalToken:active.approvalToken});
    if(!outcome.ok||!outcome.result){const failure=outcome.error||'Action failed';setTurn({...current,actions:current.actions.map((a,i)=>i===current.active?{...a,status:'failed',result:failure}:a),status:'Action failed'});appendBrowserReply(current.id,`Browser action failed: ${failure}`);return;}
    const result=outcome.result;setBrowser({connected:true,url:result.url});
    const completedActions=current.actions.map((a,i)=>i===current.active?{...a,status:'succeeded' as const,result:`${result.title} · ${result.url}`,...(result.video?{video:result.video}:{})}:a);
    const completed={...current,actions:completedActions,status:'Action verified'};setTurn(completed);
    if(active.kind==='navigate'&&current.youtubeQuery){await proposeStep(current.id,'search-youtube',current.youtubeQuery);return;}
    if(active.kind==='navigate'&&current.firstYoutubeVideo){
      try{const video=await saxo.firstYouTubeVideo();await proposeStep(current.id,'open-video',video.url,video)}
      catch(error){setTurn({...completed,status:error instanceof Error?error.message:'No YouTube video is available'});}
      return;
    }
    if(active.kind==='navigate'&&current.followupQuery){await proposeStep(current.id,'search-web',current.followupQuery,undefined,current.followupSite||'');return;}
    if(active.kind==='search-youtube'){
      if(!result.video){setTurn({...completed,status:'Search completed'});appendBrowserReply(current.id,`YouTube search completed: ${result.title} · ${result.url}`);return;}
      if(current.playFirstResult){await proposeStep(current.id,'open-video',result.video.url,result.video);return;}
      setTurn({...completed,status:`Search completed · ${result.video.title}`});appendBrowserReply(current.id,`YouTube search completed. First result: ${result.video.title} · ${result.video.url}`);return;
    }
    if(active.kind==='open-video'&&current.playFirstResult){await proposeStep(current.id,'play-video',active.detail,active.video);return;}
    if(active.kind==='play-video'&&!result.playing){setTurn({...completed,status:'Playback could not be verified'});appendBrowserReply(current.id,`Playback could not be verified for ${result.title}.`);return;}
    setTurn({...completed,status:active.kind==='play-video'?'Playback verified':'Action verified'});
    appendBrowserReply(current.id,`${active.kind==='play-video'?'Playback verified':'Browser action completed'}: ${result.title} · ${result.url}`);
  };
  const appendBrowserReply=(turnId:string,content:string)=>setChatMessages(current=>current.some(message=>message.role==='assistant'&&message.turnId===turnId)?current:[...current,{role:'assistant',content,turnId}]);
  const handledVoiceRequests=useRef(new Set<string>());
  const base64Of=async(blob:Blob)=>{const bytes=new Uint8Array(await blob.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));return btoa(binary)};
  const sendVoiceMessage=async(blob:Blob,audioUrl:string,duration:number)=>{
    const mimeType=blob.type.split(';')[0]||'audio/webm';
    const sent=await saxo.sendVoiceMessage({audioBase64:await base64Of(blob),mimeType});
    const message:ChatMessage={id:sent.messageId,role:'user',content:'Voice message',audioUrl,audioDuration:duration,mimeType:sent.mimeType,transcript:'Transcribing your voice…'};
    setChatMessages(current=>[...current,message]);setHistory(h=>['Voice message',...h]);
    setTurn({id:crypto.randomUUID(),kind:'chat',request:'Voice message',actions:[],active:0,status:'Transcribing voice message'});
    try{
      const result=await saxo.transcribeAudio({messageId:sent.messageId,mimeType:sent.mimeType});
      setChatMessages(current=>current.map(item=>item.id===sent.messageId?{...item,transcript:result.text,transcriptError:undefined}:item));
      handledVoiceRequests.current.add(sent.messageId);
      await submit(result.text,true);
    }catch(error){const message=error instanceof Error?error.message:'Transcription failed. The voice message is saved.';setChatMessages(current=>current.map(item=>item.id===sent.messageId?{...item,transcript:undefined,transcriptError:message}:item));setTurn(current=>current?.kind==='chat'?{...current,status:'Transcription failed',reply:message}:current);}
  };
  const retryVoiceTranscription=async(message:ChatMessage)=>{
    if(!message.id||!message.audioUrl)return;
    setChatMessages(current=>current.map(item=>item.id===message.id?{...item,transcriptError:undefined,transcript:'Transcribing your voice…'}:item));
    try{const result=await saxo.transcribeAudio({messageId:message.id,mimeType:message.mimeType||'audio/webm'});setChatMessages(current=>current.map(item=>item.id===message.id?{...item,transcript:result.text,transcriptError:undefined}:item));if(!handledVoiceRequests.current.has(message.id)){handledVoiceRequests.current.add(message.id);await submit(result.text,true)}}
    catch(error){setChatMessages(current=>current.map(item=>item.id===message.id?{...item,transcript:undefined,transcriptError:error instanceof Error?error.message:'Transcription failed.'}:item))}
  };
  const active=turn?.actions[turn.active];
  return <div className="shell">
    <aside className="sidebar">
      <div className="brand"><div className="brandmark"><img src={saxoMark} alt=""/></div><div><b>SAXO AI</b><span>PERSONAL AI ASSISTANT</span></div><button className="icon-button small more" aria-label="More options"><MoreHorizontal size={18}/></button></div>
      <div className="nav-label">WORKSPACE</div><button className="nav active"><MessageSquare size={17}/> Assistant</button><button className="nav"><History size={17}/> Activity history</button>
      <div className="history-label">RECENT TASKS</div><div className="history-list">{history.length?history.slice(0,5).map((h,i)=><button key={i} className="history-item"><span className="history-dot"/>{h}</button>):<p className="empty-history">Your recent tasks will appear here.</p>}</div>
      <div className="sidebar-bottom"><div className="security-note"><span><LockKeyhole size={14}/></span><div><b>Approval required</b><small>Every action waits for you.</small></div></div><button className="nav settings"><Settings2 size={17}/> Settings <span className="soon">SOON</span></button><div className="profile"><div className="avatar">A</div><div><b>Local workspace</b><small>Browser {browser.connected?'connected':'not connected'}</small></div><MoreHorizontal size={18}/></div></div>
    </aside>
    <main className="main">
      <header className="topbar"><div className="crumb"><img className="header-logo" src={saxoMark} alt="SAXO AI"/><span>SAXO AI</span><span className="slash">/</span><b>Assistant</b></div><div className="top-actions"><div className="browser-pill"><span className={browser.connected?'footer-dot':'online-dot'}/> Browser <span className="pill-muted">{browser.connected?'ready':'not connected'}</span></div><button className="icon-button" aria-label="Help"><CircleHelp size={18}/></button></div></header>
      <div className="content">
        {!turn&&!chatMessages.length?<section className="welcome"><div className="welcome-start"><div className="welcome-icon"><img src={saxoMark} alt="SAXO AI assistant"/></div><div className="welcome-message"><div className="welcome-label">SAXO <span>READY TO HELP</span></div><div className="welcome-bubble">Hey there. What do you need?</div><div className="welcome-caption">Your personal browser assistant · approvals before opening pages</div></div></div><div className="welcome-bottom"><div className="suggestions"><button onClick={()=>setText('Open YouTube')}><Search size={15}/><span>Open YouTube</span><ArrowUp size={13}/></button><button onClick={()=>setText('Open https://www.wikipedia.org')}><Globe2 size={15}/><span>Open a website</span><ArrowUp size={13}/></button></div><Composer text={text} setText={setText} submit={submit} onVoiceSend={sendVoiceMessage}/><div className="privacy-line"><ShieldCheck size={13}/> Every browser action needs approval <span>·</span> Search uses your regular Chrome profile</div></div></section>:(!turn||turn.kind==='chat')?<section className="conversation chat-conversation">
          <div className="conversation-head"><div className="eyebrow">CHAT</div><div className="task-status">{turn?.status==='Thinking'||turn?.status==='Transcribing voice message'?<><span className="waiting-dot"/> {turn.status}</>:turn?.status==='Could not respond'?turn.status:'SAXO is here to help'}</div></div>
          <div className="chat-thread" aria-live="polite">{chatMessages.map((message,index)=><div className={`chat-message ${message.role}`} key={message.id||`${message.role}-${message.turnId||index}`}><div className="chat-message-label">{message.role==='user'?'YOU':<><img className="chat-agent-logo" src={saxoMark} alt="SAXO AI"/> SAXO AI</>}</div>{message.content&&(message.role==='assistant'?<FormattedMessage text={message.content}/>:<p>{message.content}</p>)}{message.audioUrl&&<div className="chat-voice"><audio controls preload="metadata" src={message.audioUrl} aria-label="Voice message audio"/><span className="voice-duration">{String(Math.floor((message.audioDuration||0)/60)).padStart(2,'0')}:{String((message.audioDuration||0)%60).padStart(2,'0')}</span>{message.transcript&&<div className="chat-transcript"><span>TRANSCRIPT</span><p>{message.transcript}</p></div>}{message.transcriptError&&<div className="chat-transcript-error" role="alert">{message.transcriptError}<button onClick={()=>void retryVoiceTranscription(message)}>Retry transcript</button></div>}</div>}</div>)}{turn?.status==='Thinking'&&<div className="chat-message assistant thinking-message"><div className="chat-message-label"><img className="chat-agent-logo" src={saxoMark} alt="SAXO AI"/> SAXO AI</div><div className="chat-thinking"><i/><i/><i/></div></div>}{turn?.status==='Could not respond'&&turn.reply&&<div className="chat-error" role="alert">{turn.reply}</div>}<div ref={chatEndRef}/></div>
        </section>:<section className="conversation chat-conversation">
          <div className="conversation-head"><div className="eyebrow">TASK IN PROGRESS</div><div className="task-status"><span className={active&&active.status==='pending'?'waiting-dot':'done-dot'}/>{turn.status}</div></div>
          <div className="chat-thread" aria-live="polite">{chatMessages.map((message,index)=><div className={`chat-message ${message.role}`} key={message.id||`${message.role}-${message.turnId||index}`}><div className="chat-message-label">{message.role==='user'?'YOU':<><img className="chat-agent-logo" src={saxoMark} alt="SAXO AI"/> SAXO AI</>}</div>{message.content&&(message.role==='assistant'?<FormattedMessage text={message.content}/>:<p>{message.content}</p>)}{message.audioUrl&&<div className="chat-voice"><audio controls preload="metadata" src={message.audioUrl} aria-label="Voice message audio"/><span className="voice-duration">{String(Math.floor((message.audioDuration||0)/60)).padStart(2,'0')}:{String((message.audioDuration||0)%60).padStart(2,'0')}</span>{message.transcript&&<div className="chat-transcript"><span>TRANSCRIPT</span><p>{message.transcript}</p></div>}{message.transcriptError&&<div className="chat-transcript-error" role="alert">{message.transcriptError}<button onClick={()=>void retryVoiceTranscription(message)}>Retry transcript</button></div>}</div>}</div>)}<div ref={chatEndRef}/></div>
          <div className="agent-message"><div className="agent-icon"><img src={saxoMark} alt="SAXO AI"/></div><div className="agent-body"><div className="message-label"><img className="chat-agent-logo" src={saxoMark} alt="SAXO AI"/> SAXO AI <span className="mock-tag">BROWSER ACTION</span></div><p className="agent-copy">Every browser action is shown for approval before it runs. Follow-up searches use your regular Chrome profile.</p>
            {active?<><div className="plan"><div className="plan-head"><b>Proposed action</b><span>{turn.actions.length} {turn.actions.length===1?'step':'steps'}</span></div>{turn.actions.map((step,index)=><div className={`plan-row ${index===turn.active?'current':''}`} key={`${step.kind}-${index}`}><div className={`step-icon ${step.status}`}>{step.status==='succeeded'?<Check size={13}/>:step.status==='rejected'||step.status==='failed'?<X size={13}/>:<span>{String(index+1).padStart(2,'0')}</span>}</div><div className="step-copy"><b>{step.title}</b><span>{step.video?.title||step.detail}</span></div><div className={`step-state ${step.status}`}>{step.status.toUpperCase()}</div></div>)}</div>
              {active.status==='pending'&&!active.actionId&&<div className="thinking-card"><div className="thinking-label"><span className="thinking-spark">✳</span> SAXO IS THINKING</div><div className="thinking-dots"><i/><i/><i/></div><span className="thinking-copy">Preparing a clear action for you to review</span></div>}
              {active.status==='pending'&&!!active.actionId&&<div className="approval-card"><div className="approval-heading"><div className="approval-symbol"><ShieldCheck size={17}/></div><div><b>Review this action</b><span>Approval expires after 60 seconds</span></div><div className="approval-required">REQUIRED</div></div><div className="action-detail"><span className="field-label">ACTION</span><b>{active.title}</b>{active.kind==='open-video'&&active.video&&<><span className="field-label target-label">VIDEO RESULT</span>{active.video.thumbnail&&<img className="video-preview-thumbnail" src={active.video.thumbnail} alt=""/>}<b className="video-title">{active.video.title}</b></>}<span className="field-label target-label">TARGET / PARAMETERS</span><code>{active.detail}</code><p>{active.reason}</p></div><div className="approval-actions"><button className="reject-button" onClick={()=>void decide(false)}><X size={15}/> Reject</button><button className="approve-button" onClick={()=>void decide(true)}><Check size={15}/> Approve action <span>↗</span></button></div><div className="mock-disclaimer">This one-time action runs in your regular Chrome profile.</div></div>}
              {active.status==='running'&&<div className="thinking-card"><div className="thinking-label"><span className="thinking-spark">✳</span> OPENING APPROVED PAGE</div><div className="thinking-dots"><i/><i/><i/></div><span className="thinking-copy">Checking the loaded page and its title</span></div>}
              {active.status!=='pending'&&active.status!=='running'&&<div className={`completion ${active.status==='failed'?'failure':''}`}><CheckCircle2 size={18}/><span>{active.result||turn.status}</span><button onClick={()=>setTurn(null)}>Start another task</button></div>}
            </>:<div className="completion"><CircleHelp size={18}/><span>Enter a full website address, or start with “Open YouTube”.</span><button onClick={()=>setTurn(null)}>Try again</button></div>}
          </div></div>
        </section>}
      </div>
      {((turn&&(active||turn.kind==='chat'))||(!turn&&chatMessages.length>0))&&<div className="composer-dock"><Composer text={text} setText={setText} submit={submit} onVoiceSend={sendVoiceMessage}/><p><LockKeyhole size={12}/> {turn?.kind==='browser'?'Approve each browser action before it runs':'Chat with SAXO · opening a page needs your approval'}</p></div>}
      <footer className="app-footer"><span><span className="footer-dot"/> LOCAL PROTOTYPE</span><span>Built for deliberate browsing <span className="footer-star">✳</span></span></footer>
    </main>
  </div>;
}
function Composer({text,setText,submit,onVoiceSend}:{text:string;setText:(s:string)=>void;submit:()=>void;onVoiceSend:(blob:Blob,url:string,duration:number)=>Promise<void>}) {
  const [recording,setRecording]=useState(false),[seconds,setSeconds]=useState(0),[sending,setSending]=useState(false),[error,setError]=useState(''),[audioUrl,setAudioUrl]=useState(''),[audioBlob,setAudioBlob]=useState<Blob|null>(null),[playing,setPlaying]=useState(false),[voiceReady,setVoiceReady]=useState<boolean|null>(null),[envFileFound,setEnvFileFound]=useState(false);
  const recorder=useRef<MediaRecorder|null>(null),chunks=useRef<Blob[]>([]),stream=useRef<MediaStream|null>(null),started=useRef(0),audio=useRef<HTMLAudioElement|null>(null),cancelRecording=useRef(false),sendLock=useRef(false);
  useEffect(()=>{void saxo.voiceStatus().then(s=>{setVoiceReady(s.configured);setEnvFileFound(s.envFileFound)}).catch(()=>setVoiceReady(false))},[]);
  useEffect(()=>()=>{recorder.current?.stop();stream.current?.getTracks().forEach(t=>t.stop())},[]);
  const elapsed=()=>{const minutes=Math.floor(seconds/60);return `${String(minutes).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`};
  const stopRecording=()=>{if(recorder.current?.state==='recording')recorder.current.stop();setRecording(false);stream.current?.getTracks().forEach(t=>t.stop())};
  useEffect(()=>{if(!recording)return;const id=window.setInterval(()=>{const count=Math.floor((Date.now()-started.current)/1000);setSeconds(count);if(count>=60)stopRecording()},250);return()=>window.clearInterval(id)},[recording]);
  const startRecording=async()=>{setError('');try{if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder)throw new Error('Voice recording is unavailable on this device.');cancelRecording.current=false;const input=await navigator.mediaDevices.getUserMedia({audio:true});stream.current=input;const types=['audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus','audio/mp4'];const type=types.find(t=>MediaRecorder.isTypeSupported(t));const media=new MediaRecorder(input,type?{mimeType:type}:undefined);recorder.current=media;chunks.current=[];started.current=Date.now();setSeconds(0);media.ondataavailable=e=>{if(e.data.size)chunks.current.push(e.data)};media.onstop=()=>{if(cancelRecording.current){cancelRecording.current=false;return}const duration=Math.max(1,Math.round((Date.now()-started.current)/1000));setSeconds(duration);const blob=new Blob(chunks.current,{type:media.mimeType||'audio/webm'});if(!blob.size){setError('No audio was captured. Try recording again.');return}const url=URL.createObjectURL(blob);setAudioBlob(blob);setAudioUrl(url)};media.start();setRecording(true)}catch(err){const e=err as DOMException;setError(e?.name==='NotAllowedError'?'Microphone access is blocked. Allow SAXO AI in macOS System Settings → Privacy & Security → Microphone, then restart the app.':err instanceof Error?err.message:'Could not access the microphone.')}};
  const discard=()=>{if(recording){cancelRecording.current=true;stopRecording()}if(audioUrl)URL.revokeObjectURL(audioUrl);setAudioUrl('');setAudioBlob(null);setError('');setPlaying(false)};
  const sendAudio=async()=>{if(!audioBlob||!audioUrl||sendLock.current)return;sendLock.current=true;setSending(true);setError('');try{await onVoiceSend(audioBlob,audioUrl,seconds);setAudioUrl('');setAudioBlob(null);setPlaying(false)}catch(err){setError(err instanceof Error?err.message:'Could not send the voice message. Try again.')}finally{sendLock.current=false;setSending(false)}};
  return <div className="composer"><textarea aria-label="Message SAXO or describe a browser task" value={text} onChange={e=>setText(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();submit()}}} placeholder="Message SAXO or describe a browser task…" rows={1}/>
    {recording&&<div className="recording-row"><span className="recording-dot"/><span>Recording voice message</span><time>{elapsed()}</time><button className="record-stop" onClick={stopRecording}>Stop</button></div>}
    {audioUrl&&<div className="voice-card"><div className="voice-player"><button className="play-button" aria-label={playing?'Pause voice preview':'Play voice preview'} onClick={()=>{if(!audio.current)return;if(playing)audio.current.pause();else void audio.current.play().then(()=>setPlaying(true)).catch(()=>setError('Could not play this recording.'))}}>{playing?<Pause size={14}/>:<Play size={14}/>}</button><div className="waveform" aria-hidden="true">{Array.from({length:36},(_,i)=><i key={i} style={{height:`${7+Math.abs(Math.sin(i*2.3+seconds))*20}px`}}/>)}</div><span className="voice-duration">{elapsed()}</span><audio ref={audio} src={audioUrl} onEnded={()=>setPlaying(false)} onPause={()=>setPlaying(false)} hidden/></div><div className="voice-preview-label">Voice message preview · audio is sent as recorded</div><div className="voice-actions"><button onClick={discard} disabled={sending}>Discard</button><button className="use-transcript" onClick={()=>void sendAudio()} disabled={sending}>{sending?'Sending…':'Send voice message'} <ArrowUp size={12}/></button></div></div>}
    {error&&<div className="voice-error" role="alert">{error}</div>}
    <div className="composer-bottom"><span><span className="composer-dot"/> Chat + browser <span className="voice-hint">· {voiceReady===null?'Checking Groq':voiceReady?'Groq connected':envFileFound?'Groq key missing':'.env not found'}</span></span><div className="composer-controls"><button className={`mic-button ${recording?'is-recording':''}`} aria-label={recording?'Stop recording':'Record voice message'} title="Record a voice message" onClick={()=>recording?stopRecording():void startRecording()} disabled={sending||Boolean(audioUrl)}>{recording?<span className="record-stop-square"/>:<Mic size={15}/>}</button><button disabled={!text.trim()||sending} aria-label="Send message" onClick={()=>submit()}><ArrowUp size={17}/></button></div></div></div>
}
const root=createRoot(document.getElementById('root')!);
if(window.saxo) root.render(<App/>);
else root.render(<div style={{minHeight:'100vh',display:'grid',placeItems:'center',padding:24,background:'#f6fbf8',color:'#123b30',fontFamily:'-apple-system,BlinkMacSystemFont,sans-serif',textAlign:'center'}}><div><strong>SAXO AI runs as a desktop app.</strong><p>Open SAXO AI, describe the browser action, and approve it. Approved pages and searches will use your regular Chrome profile.</p></div></div>);
