const $=(id)=>document.getElementById(id);

const els={
  lock:$("lockScreen"),room:$("room"),pass:$("passwordInput"),unlock:$("unlockBtn"),passErr:$("passwordError"),
  copyPage:$("copyPageBtn"),clearRoom:$("clearRoomBtn"),
  selectedPersonBadge:$("selectedPersonBadge"),leventOnline:$("leventOnline"),zeynepOnline:$("zeynepOnline"),
  connectionStatus:$("connectionStatus"),leventVoiceReady:$("leventVoiceReady"),zeynepVoiceReady:$("zeynepVoiceReady"),
  chatModeBtn:$("chatModeBtn"),voiceModeBtn:$("voiceModeBtn"),voicePanel:$("voicePanel"),voiceTimer:$("voiceTimer"),
  holdVoiceBtn:$("holdVoiceBtn"),resumeVoiceBtn:$("resumeVoiceBtn"),closeVoiceBtn:$("closeVoiceBtn"),voiceNotice:$("voiceNotice"),
  messages:$("messages"),messageInput:$("messageInput"),sendBtn:$("sendBtn"),chatInputWrap:$("chatInputWrap"),remoteAudio:$("remoteAudio"),
  callHistory:$("callHistory"),clearCallHistoryBtn:$("clearCallHistoryBtn"),
  playlistInput:$("playlistInput"),jamInput:$("jamInput"),saveLinks:$("saveLinksBtn"),clearLinks:$("clearLinksBtn"),
  playlistBtn:$("playlistBtn"),jamBtn:$("jamBtn"),spotifyEmbed:$("spotifyEmbed"),
  startSession:$("startSessionBtn"),sessionTimer:$("sessionTimer"),romanticLine:$("romanticLine"),meter:$("meterFill"),
  stars:$("stars"),hearts:$("hearts")
};

const state={
  db:null, roomRef:null, role:localStorage.getItem("firebaseJamRole")||"",
  pc:null, localStream:null, remoteStream:null,
  mode:"chat", voiceReady:false, callStarted:false,
  currentCallId:null, handledOfferId:null, handledAnswerId:null,
  voiceStartedAt:0, voiceElapsedMs:0, voiceTimerInterval:null, sessionTimer:null
};

const lines=[
  "Aynı odada değiliz ama aynı şarkının içindeyiz.",
  "Spotify’da müzik, burada kalbimiz açık.",
  "Bu playlist biraz sen, biraz ben.",
  "Aynı anda dinlediğimiz her şarkı bize ait oluyor.",
  "Mesafe varsa da ritim aynı.",
  "Jam başladıysa dünya birkaç dakika sadece ikimizin."
];

function visuals(){
  for(let i=0;i<90;i++){
    const s=document.createElement("span");
    s.style.left=`${Math.random()*100}%`;
    s.style.top=`${Math.random()*100}%`;
    s.style.animationDelay=`${Math.random()*3}s`;
    els.stars.appendChild(s);
  }
  setInterval(()=>{
    const h=document.createElement("span");
    h.textContent=Math.random()>.5?"♥":"♪";
    h.style.left=`${Math.random()*100}%`;
    h.style.fontSize=`${16+Math.random()*20}px`;
    h.style.setProperty("--x",`${(Math.random()-.5)*170}px`);
    h.style.animationDuration=`${7+Math.random()*5}s`;
    els.hearts.appendChild(h);
    setTimeout(()=>h.remove(),13000);
  },780);
}

function unlock(){
  if(els.pass.value.trim()!==window.ROOM_PASSWORD){
    els.passErr.textContent="Şifre yanlış. Lütfen tekrar dene.";
    return;
  }
  localStorage.setItem("firebaseJamUnlocked","true");
  els.lock.classList.add("hidden");
  els.room.classList.remove("hidden");
  initFirebase();
}

function initFirebase(){
  if(!window.firebaseConfig?.databaseURL){
    setConnection("Firebase ayarı eksik",false);
    return;
  }

  if(!firebase.apps.length)firebase.initializeApp(window.firebaseConfig);
  state.db=firebase.database();
  state.roomRef=state.db.ref(`rooms/${window.ROOM_ID||"main-room"}`);

  setConnection("Odaya bağlandı",true);
  bindFirebase();

  if(state.role)selectRole(state.role);
}

function bindFirebase(){
  state.roomRef.child("presence").on("value",snap=>{
    const p=snap.val()||{};
    setPresence(els.leventOnline,p.Levent?.online);
    setPresence(els.zeynepOnline,p.Zeynep?.online);
  });

  state.roomRef.child("voiceReady").on("value",async snap=>{
    const r=snap.val()||{};
    setReadyLabel(els.leventVoiceReady,r.Levent);
    setReadyLabel(els.zeynepVoiceReady,r.Zeynep);

    if(r.Levent && r.Zeynep && state.role==="Levent" && state.voiceReady && !state.callStarted){
      await createVoiceOffer();
    }
  });

  state.roomRef.child("links").on("value",snap=>renderLinks(snap.val()||{}));

  state.roomRef.child("messages").limitToLast(100).on("value",snap=>{
    const val=snap.val()||{};
    renderMessages(Object.values(val).sort((a,b)=>(a.createdAt||0)-(b.createdAt||0)));
  });

  state.roomRef.child("sessionStartedAt").on("value",snap=>startSessionTimer(snap.val()||0));

  state.roomRef.child("callHistory").limitToLast(20).on("value",snap=>{
    const val=snap.val()||{};
    renderCallHistory(Object.values(val).sort((a,b)=>(b.startedAt||0)-(a.startedAt||0)));
  });
}

function selectRole(role){
  state.role=role;
  localStorage.setItem("firebaseJamRole",role);

  document.querySelectorAll(".person-btn").forEach(btn=>btn.classList.toggle("active",btn.dataset.person===role));
  els.selectedPersonBadge.textContent=role;
  els.selectedPersonBadge.classList.add("ok");

  state.roomRef.child(`presence/${role}`).set({online:true, joinedAt:firebase.database.ServerValue.TIMESTAMP});
  state.roomRef.child(`presence/${role}`).onDisconnect().set({online:false, leftAt:firebase.database.ServerValue.TIMESTAMP});

  listenSignals();
}

function listenSignals(){
  const targetPath=`signals/${state.role}`;

  state.roomRef.child(`${targetPath}/offer`).on("value",async snap=>{
    const offer=snap.val();
    if(!offer || offer.from===state.role || !offer.description || offer.id===state.handledOfferId)return;
    state.handledOfferId=offer.id;
    await answerVoiceOffer(offer);
  });

  state.roomRef.child(`${targetPath}/answer`).on("value",async snap=>{
    const answer=snap.val();
    if(!answer || answer.from===state.role || !answer.description || answer.id===state.handledAnswerId)return;
    state.handledAnswerId=answer.id;
    await applyVoiceAnswer(answer);
  });

  state.roomRef.child(`${targetPath}/candidates`).on("child_added",async snap=>{
    const candidate=snap.val();
    if(!candidate || !state.pc)return;
    try{ await state.pc.addIceCandidate(new RTCIceCandidate(candidate)); }
    catch(e){ console.warn("candidate ignored",e); }
  });

  state.roomRef.child(`${targetPath}/control`).on("value",snap=>{
    const c=snap.val();
    if(!c || c.from===state.role)return;
    if(c.type==="close")closeVoice(false);
    if(c.type==="hold")holdVoice(false);
    if(c.type==="resume")resumeVoice(false);
  });
}

function otherRole(){
  return state.role==="Levent"?"Zeynep":state.role==="Zeynep"?"Levent":"";
}

function setPresence(el,online){
  el.textContent=online?"Çevrimiçi":"Bekliyor";
  el.classList.toggle("ok",!!online);
}

function setReadyLabel(el,ready){
  el.textContent=ready?"Hazır":"Bekliyor";
  el.classList.toggle("ok",!!ready);
}

function setConnection(text,ok){
  els.connectionStatus.textContent=text;
  els.connectionStatus.classList.toggle("ok",!!ok);
}

async function sendMessage(){
  if(!state.role){ alert("Önce kişi seç."); return; }
  if(state.mode==="voice"){ alert("Sesli bağlantı açıkken mesajlaşma kapalı. Mesajlaşma moduna dönmelisin."); return; }
  const text=els.messageInput.value.trim();
  if(!text)return;
  els.messageInput.value="";
  await state.roomRef.child("messages").push({from:state.role,text,createdAt:firebase.database.ServerValue.TIMESTAMP});
}

function renderMessages(messages){
  els.messages.innerHTML="";
  if(!messages.length){
    const div=document.createElement("div");
    div.className="message";
    div.innerHTML="<strong>Oda</strong>Buradan yazılan mesajlar canlı olarak karşı tarafta görünür.";
    els.messages.appendChild(div);
    return;
  }
  for(const msg of messages){
    const div=document.createElement("div");
    div.className=`message ${msg.from===state.role?"mine":""}`;
    const time=msg.createdAt?formatDateTime(msg.createdAt):"";
    div.innerHTML=`<strong>${escapeHtml(msg.from||"Oda")}</strong>${escapeHtml(msg.text||"")}<small>${time}</small>`;
    els.messages.appendChild(div);
  }
  els.messages.scrollTop=els.messages.scrollHeight;
}

async function prepareVoice(){
  if(!state.role){ alert("Önce kişi seç."); return; }

  try{
    // User gesture path: permission prompt happens here on both phones
    state.localStream=await navigator.mediaDevices.getUserMedia({
      audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},
      video:false
    });

    state.voiceReady=true;
    setMode("voice-waiting");
    els.voiceNotice.textContent="Mikrofon izni alındı. Karşı taraf da sesli bağlantıya geçince görüşme otomatik başlayacak.";

    await state.roomRef.child(`voiceReady/${state.role}`).set(true);
    await state.roomRef.child(`voiceReady/${state.role}`).onDisconnect().set(false);
  }catch(e){
    console.error(e);
    alert("Mikrofon izni alınamadı. Tarayıcı izinlerini kontrol et.");
  }
}

function createPeerConnection(){
  if(state.pc){
    try{state.pc.close();}catch{}
  }

  const pc=new RTCPeerConnection({iceServers:[{urls:"stun:stun.l.google.com:19302"}]});

  pc.onicecandidate=e=>{
    if(e.candidate && state.role){
      const target=otherRole();
      state.roomRef.child(`signals/${target}/candidates`).push(e.candidate.toJSON());
    }
  };

  pc.ontrack=e=>{
    state.remoteStream=e.streams[0];
    els.remoteAudio.srcObject=state.remoteStream;
    els.remoteAudio.play().catch(()=>{});
    setConnection("Sesli bağlantı açık",true);
  };

  pc.onconnectionstatechange=()=>{
    if(pc.connectionState==="connected"){
      state.callStarted=true;
    }
    setConnection(pc.connectionState==="connected"?"Sesli bağlantı açık":`Bağlantı: ${pc.connectionState}`,pc.connectionState==="connected");
  };

  if(state.localStream){
    state.localStream.getTracks().forEach(track=>pc.addTrack(track,state.localStream));
  }

  state.pc=pc;
  return pc;
}

async function createVoiceOffer(){
  if(!state.localStream)return;
  const target=otherRole();
  if(!target)return;

  state.callStarted=true;
  state.currentCallId=Date.now()+"-"+Math.random().toString(16).slice(2);

  await state.roomRef.child("signals").remove();

  const pc=createPeerConnection();
  const offer=await pc.createOffer();
  await pc.setLocalDescription(offer);

  await state.roomRef.child(`signals/${target}/offer`).set({
    id:state.currentCallId,
    from:state.role,
    description:pc.localDescription.toJSON(),
    createdAt:firebase.database.ServerValue.TIMESTAMP
  });

  await state.roomRef.child("voiceState").set({
    status:"calling",
    startedBy:state.role,
    startedAt:firebase.database.ServerValue.TIMESTAMP
  });

  setMode("voice");
  setConnection("Sesli bağlantı isteği gönderildi",true);
}

async function answerVoiceOffer(offer){
  if(!state.localStream){
    // Receiver must have clicked Sesli Bağlantıya Geç already
    els.voiceNotice.textContent="Sesli bağlantı isteği geldi. Lütfen Sesli Bağlantıya Geç butonuna basıp mikrofon izni ver.";
    return;
  }

  state.callStarted=true;
  state.currentCallId=offer.id;

  const pc=createPeerConnection();
  await pc.setRemoteDescription(new RTCSessionDescription(offer.description));

  const answer=await pc.createAnswer();
  await pc.setLocalDescription(answer);

  await state.roomRef.child(`signals/${offer.from}/answer`).set({
    id:offer.id,
    from:state.role,
    description:pc.localDescription.toJSON(),
    createdAt:firebase.database.ServerValue.TIMESTAMP
  });

  await state.roomRef.child("voiceState/status").set("connected");
  setMode("voice");
  setConnection("Sesli bağlantı yanıtlandı",true);
}

async function applyVoiceAnswer(answer){
  if(!state.pc || !answer.description)return;

  if(state.pc.signalingState!=="stable"){
    await state.pc.setRemoteDescription(new RTCSessionDescription(answer.description));
  }

  setMode("voice");
  setConnection("Sesli bağlantı açık",true);
}

async function closeVoice(send=true){
  await saveCallHistory();

  stopVoiceTimer();

  if(state.localStream){
    state.localStream.getTracks().forEach(t=>t.stop());
    state.localStream=null;
  }

  if(state.pc){
    try{state.pc.close();}catch{}
    state.pc=null;
  }

  state.remoteStream=null;
  els.remoteAudio.srcObject=null;
  state.voiceReady=false;
  state.callStarted=false;
  state.currentCallId=null;

  setMode("chat");

  if(state.role){
    await state.roomRef.child(`voiceReady/${state.role}`).set(false);
  }

  if(send && state.role){
    const target=otherRole();
    await state.roomRef.child(`signals/${target}/control`).set({
      type:"close",
      from:state.role,
      at:firebase.database.ServerValue.TIMESTAMP
    });
    await state.roomRef.child("voiceState").set({status:"closed",closedBy:state.role,closedAt:firebase.database.ServerValue.TIMESTAMP});
  }

  setConnection("Mesajlaşma aktif",true);
}

async function holdVoice(send=true){
  if(state.localStream){
    state.localStream.getAudioTracks().forEach(t=>t.enabled=false);
  }
  pauseVoiceTimer();
  els.voiceNotice.textContent="Sesli bağlantı askıya alındı.";

  if(send && state.role){
    await state.roomRef.child(`signals/${otherRole()}/control`).set({type:"hold",from:state.role,at:firebase.database.ServerValue.TIMESTAMP});
  }
}

async function resumeVoice(send=true){
  if(state.localStream){
    state.localStream.getAudioTracks().forEach(t=>t.enabled=true);
  }
  startVoiceTimer();
  els.voiceNotice.textContent="Sesli bağlantı devam ediyor.";

  if(send && state.role){
    await state.roomRef.child(`signals/${otherRole()}/control`).set({type:"resume",from:state.role,at:firebase.database.ServerValue.TIMESTAMP});
  }
}

function setMode(mode){
  state.mode=mode==="voice-waiting"?"chat":mode;
  const isVoice=mode==="voice" || mode==="voice-waiting";
  els.voicePanel.classList.toggle("hidden",!isVoice);
  els.chatInputWrap.classList.toggle("disabled",mode==="voice");
  els.voiceModeBtn.textContent=mode==="voice"?"Sesli Bağlantı Aktif":mode==="voice-waiting"?"Karşı Taraf Bekleniyor":"Sesli Bağlantıya Geç";
  if(mode==="voice")startVoiceTimer();
}

function startVoiceTimer(){
  if(!state.voiceStartedAt)state.voiceStartedAt=Date.now();
  clearInterval(state.voiceTimerInterval);
  state.voiceTimerInterval=setInterval(updateVoiceTimer,500);
  updateVoiceTimer();
}

function pauseVoiceTimer(){
  if(state.voiceStartedAt){
    state.voiceElapsedMs+=Date.now()-state.voiceStartedAt;
    state.voiceStartedAt=0;
  }
  clearInterval(state.voiceTimerInterval);
  updateVoiceTimer();
}

function stopVoiceTimer(){
  state.voiceStartedAt=0;
  state.voiceElapsedMs=0;
  clearInterval(state.voiceTimerInterval);
  els.voiceTimer.textContent="00:00";
}

function updateVoiceTimer(){
  let total=state.voiceElapsedMs;
  if(state.voiceStartedAt)total+=Date.now()-state.voiceStartedAt;
  els.voiceTimer.textContent=formatDuration(total);
}

async function saveCallHistory(){
  if(!state.voiceStartedAt && !state.voiceElapsedMs)return;

  const endedAt=Date.now();
  const startedAt=state.voiceStartedAt ? state.voiceStartedAt-state.voiceElapsedMs : endedAt-state.voiceElapsedMs;
  const durationMs=state.voiceElapsedMs + (state.voiceStartedAt ? endedAt-state.voiceStartedAt : 0);

  if(durationMs<1000)return;

  await state.roomRef.child("callHistory").push({
    startedBy:state.role||"",
    startedAt,
    endedAt,
    durationMs,
    createdAt:firebase.database.ServerValue.TIMESTAMP
  });
}

function renderCallHistory(items){
  if(!els.callHistory)return;
  els.callHistory.innerHTML="";
  if(!items.length){
    const div=document.createElement("div");
    div.className="call-history-item";
    div.innerHTML="<div><strong>Henüz sesli görüşme kaydı yok</strong><span>Sesli bağlantı kapatıldığında tarih ve süre burada görünecek.</span></div>";
    els.callHistory.appendChild(div);
    return;
  }

  for(const item of items){
    const div=document.createElement("div");
    div.className="call-history-item";
    div.innerHTML=`
      <div>
        <strong>${escapeHtml(item.startedBy||"Oda")} tarafından başlatıldı</strong>
        <span>Başlangıç: ${formatDateTime(item.startedAt)}${item.endedAt?` • Bitiş: ${formatDateTime(item.endedAt)}`:""}</span>
      </div>
      <em>${formatDuration(item.durationMs)}</em>
    `;
    els.callHistory.appendChild(div);
  }
}

async function clearCallHistory(){
  if(!confirm("Sesli görüşme geçmişi temizlensin mi?"))return;
  await state.roomRef.child("callHistory").remove();
}

async function saveLinks(){
  await state.roomRef.child("links").set({
    playlist:normalizeUrl(els.playlistInput.value),
    jam:normalizeUrl(els.jamInput.value),
    updatedAt:firebase.database.ServerValue.TIMESTAMP,
    updatedBy:state.role||""
  });
}

async function clearLinks(){
  await state.roomRef.child("links").set({playlist:"",jam:""});
}

function renderLinks(links){
  els.playlistInput.value=links.playlist||"";
  els.jamInput.value=links.jam||"";
  updateLink(els.playlistBtn,links.playlist);
  updateLink(els.jamBtn,links.jam);

  const embed=toEmbed(links.playlist);
  if(embed){
    els.spotifyEmbed.innerHTML=`<iframe src="${embed}" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" loading="lazy"></iframe>`;
  }else{
    els.spotifyEmbed.textContent="Playlist linki kaydedilince Spotify kartı burada görünecek.";
  }
}

function normalizeUrl(v){
  const u=(v||"").trim();
  return u&&/^https?:\/\//i.test(u)?u:"";
}

function getPlaylistId(u){
  const m=String(u||"").match(/open\.spotify\.com\/playlist\/([A-Za-z0-9]+)/);
  return m?m[1]:"";
}

function toEmbed(u){
  const id=getPlaylistId(u);
  return id?`https://open.spotify.com/embed/playlist/${id}?utm_source=generator&theme=0`:"";
}

function updateLink(el,url){
  if(url){el.href=url;el.classList.remove("disabled");}
  else{el.href="#";el.classList.add("disabled");}
}

async function startSession(){
  await state.roomRef.child("sessionStartedAt").set(firebase.database.ServerValue.TIMESTAMP);
}

function startSessionTimer(started){
  clearInterval(state.sessionTimer);
  if(!started){
    els.sessionTimer.textContent="00:00:00";
    els.meter.style.width="0%";
    return;
  }

  const tick=()=>{
    const diff=Math.max(0,Date.now()-started);
    const t=Math.floor(diff/1000);
    const h=String(Math.floor(t/3600)).padStart(2,"0");
    const m=String(Math.floor((t%3600)/60)).padStart(2,"0");
    const s=String(t%60).padStart(2,"0");
    els.sessionTimer.textContent=`${h}:${m}:${s}`;
    els.romanticLine.textContent=lines[Math.floor(t/18)%lines.length];
    els.meter.style.width=`${Math.min(100,((t%120)/120)*100)}%`;
  };
  tick();
  state.sessionTimer=setInterval(tick,1000);
}

async function clearRoom(){
  if(!confirm("Odadaki mesajlar, linkler ve bağlantı kayıtları temizlensin mi?"))return;
  await closeVoice(false);
  await state.roomRef.update({
    messages:null,
    links:{playlist:"",jam:""},
    signals:null,
    voiceReady:null,
    voiceState:null,
    mode:"chat",
    sessionStartedAt:null,
    callHistory:null
  });
}

function formatDateTime(value){
  if(!value)return "";
  return new Date(value).toLocaleString("tr-TR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"});
}

function formatDuration(ms){
  const total=Math.max(0,Math.floor((ms||0)/1000));
  const h=Math.floor(total/3600);
  const m=Math.floor((total%3600)/60);
  const s=total%60;
  if(h>0)return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
  return `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
}

function escapeHtml(v){
  return String(v).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));
}

async function copyText(text,button){
  try{
    await navigator.clipboard.writeText(text);
    const old=button.textContent;
    button.textContent="Kopyalandı";
    setTimeout(()=>button.textContent=old,1400);
  }catch{
    prompt("Kopyalamak için metni seç:",text);
  }
}

function bind(){
  els.unlock.addEventListener("click",unlock);
  els.pass.addEventListener("keydown",e=>{if(e.key==="Enter")unlock();});
  els.copyPage.addEventListener("click",()=>copyText(location.href,els.copyPage));
  els.clearRoom.addEventListener("click",clearRoom);

  document.querySelectorAll(".person-btn").forEach(btn=>btn.addEventListener("click",()=>selectRole(btn.dataset.person)));

  els.sendBtn.addEventListener("click",sendMessage);
  els.messageInput.addEventListener("keydown",e=>{if(e.key==="Enter")sendMessage();});

  els.saveLinks.addEventListener("click",saveLinks);
  els.clearLinks.addEventListener("click",clearLinks);

  els.voiceModeBtn.addEventListener("click",prepareVoice);
  els.chatModeBtn.addEventListener("click",()=>closeVoice(true));
  els.holdVoiceBtn.addEventListener("click",()=>holdVoice(true));
  els.resumeVoiceBtn.addEventListener("click",()=>resumeVoice(true));
  els.closeVoiceBtn.addEventListener("click",()=>closeVoice(true));

  els.clearCallHistoryBtn.addEventListener("click",clearCallHistory);
  els.startSession.addEventListener("click",startSession);
}

visuals();
bind();

if(localStorage.getItem("firebaseJamUnlocked")==="true"){
  els.lock.classList.add("hidden");
  els.room.classList.remove("hidden");
  initFirebase();
}
