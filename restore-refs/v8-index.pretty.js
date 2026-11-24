(function(){
let e=document.createElement(`link`).relList;
if(e&&e.supports&&e.supports(`modulepreload`))return;
for(let e of document.querySelectorAll(`link[rel="modulepreload"]`))n(e);
new MutationObserver(e=>{
for(let t of e)if(t.type===`childList`)for(let e of t.addedNodes)e.tagName===`LINK`&&e.rel===`modulepreload`&&n(e)}).observe(document,{
childList:!0,subtree:!0});
function t(e){
let t={
};
return e.integrity&&(t.integrity=e.integrity),e.referrerPolicy&&(t.referrerPolicy=e.referrerPolicy),t.credentials=e.crossOrigin===`use-credentials`?`include`:e.crossOrigin===`anonymous`?`omit`:`same-origin`,t}function n(e){
if(e.ep)return;
e.ep=!0;
let n=t(e);
fetch(e.href,n)}})();
var e;
(function(e){
e.Unimplemented=`UNIMPLEMENTED`,e.Unavailable=`UNAVAILABLE`})(e||={
});
var t=class extends Error{
constructor(e,t,n){
super(e),this.message=e,this.code=t,this.data=n}},n=e=>e?.androidBridge?`android`:e?.webkit?.messageHandlers?.bridge?`ios`:`web`,r=r=>{
let i=r.CapacitorCustomPlatform||null,a=r.Capacitor||{
},o=a.Plugins=a.Plugins||{
},s=()=>i===null?n(r):i.name,c=()=>s()!==`web`,l=e=>!!(f.get(e)?.platforms.has(s())||u(e)),u=e=>a.PluginHeaders?.find(t=>t.name===e),d=e=>r.console.error(e),f=new Map;
return a.convertFileSrc||=e=>e,a.getPlatform=s,a.handleError=d,a.isNativePlatform=c,a.isPluginAvailable=l,a.registerPlugin=(n,r={
})=>{
let c=f.get(n);
if(c)return console.warn(`Capacitor plugin "${
n}" already registered. Cannot register plugins twice.`),c.proxy;
let l=s(),d=u(n),p,m=async()=>(!p&&l in r?p=p=typeof r[l]==`function`?await r[l]():r[l]:i!==null&&!p&&`web`in r&&(p=p=typeof r.web==`function`?await r.web():r.web),p),h=(r,i)=>{
if(d){
let e=d?.methods.find(e=>i===e.name);
if(e)return e.rtype===`promise`?e=>a.nativePromise(n,i.toString(),e):(e,t)=>a.nativeCallback(n,i.toString(),e,t);
if(r)return r[i]?.bind(r)}else if(r)return r[i]?.bind(r);
else throw new t(`"${
n}" plugin is not implemented on ${
l}`,e.Unimplemented)},g=r=>{
let i,a=(...a)=>{
let o=m().then(o=>{
let s=h(o,r);
if(s){
let e=s(...a);
return i=e?.remove,e}throw new t(`"${
n}.${
r}()" is not implemented on ${
l}`,e.Unimplemented)});
return r===`addListener`&&(o.remove=async()=>i()),o};
return a.toString=()=>`${
r.toString()}() {
 [capacitor code] }`,Object.defineProperty(a,"name",{
value:r,writable:!1,configurable:!1}),a},_=g(`addListener`),v=g(`removeListener`),y=(e,t)=>{
let n=_({
eventName:e},t),r=async()=>{
let r=await n;
v({
eventName:e,callbackId:r},t)},i=new Promise(e=>n.then(()=>e({
remove:r})));
return i.remove=async()=>{
console.warn(`Using addListener() without 'await' is deprecated.`),await r()},i},b=new Proxy({
},{
get(e,t){
switch(t){
case`$$typeof`:return;
case`toJSON`:return()=>({
});
case`addListener`:return d?y:_;
case`removeListener`:return v;
default:return g(t)}}});
return o[n]=b,f.set(n,{
name:n,proxy:b,platforms:new Set([...Object.keys(r),...d?[l]:[]])}),b},a.Exception=t,a.DEBUG=!!a.DEBUG,a.isLoggingEnabled=!!a.isLoggingEnabled,a},i=(e=>e.Capacitor=r(e))(typeof globalThis<`u`?globalThis:typeof self<`u`?self:typeof window<`u`?window:typeof global<`u`?global:{
}),a=i.registerPlugin,o=class{
constructor(){
this.listeners={
},this.retainedEventArguments={
},this.windowListeners={
}}addListener(e,t){
let n=!1;
this.listeners[e]||(this.listeners[e]=[],n=!0),this.listeners[e].push(t);
let r=this.windowListeners[e];
return r&&!r.registered&&this.addWindowListener(r),n&&this.sendRetainedArgumentsForEvent(e),Promise.resolve({
remove:async()=>this.removeListener(e,t)})}async removeAllListeners(){
this.listeners={
};
for(let e in this.windowListeners)this.removeWindowListener(this.windowListeners[e]);
this.windowListeners={
}}notifyListeners(e,t,n){
let r=this.listeners[e];
if(r)r.forEach(e=>e(t));
else if(n){
let n=this.retainedEventArguments[e];
n||=[],n.push(t),this.retainedEventArguments[e]=n}}hasListeners(e){
return!!this.listeners[e]?.length}registerWindowListener(e,t){
this.windowListeners[t]={
registered:!1,windowEventName:e,pluginEventName:t,handler:e=>{
this.notifyListeners(t,e)}}}unimplemented(t=`not implemented`){
return new i.Exception(t,e.Unimplemented)}unavailable(t=`not available`){
return new i.Exception(t,e.Unavailable)}async removeListener(e,t){
let n=this.listeners[e];
if(!n)return;
let r=n.indexOf(t);
this.listeners[e].splice(r,1),this.listeners[e].length||this.removeWindowListener(this.windowListeners[e])}addWindowListener(e){
window.addEventListener(e.windowEventName,e.handler),e.registered=!0}removeWindowListener(e){
e&&(window.removeEventListener(e.windowEventName,e.handler),e.registered=!1)}sendRetainedArgumentsForEvent(e){
let t=this.retainedEventArguments[e];
t&&(delete this.retainedEventArguments[e],t.forEach(t=>{
this.notifyListeners(e,t)}))}},s=e=>encodeURIComponent(e).replace(/%(2[346B]|5E|60|7C)/g,decodeURIComponent).replace(/[()]/g,escape),c=e=>e.replace(/(%[\dA-F]{
2})+/gi,decodeURIComponent),l=class extends o{
async getCookies(){
let e=document.cookie,t={
};
return e.split(`;
`).forEach(e=>{
if(e.length<=0)return;
let[n,r]=e.replace(/=/,`CAP_COOKIE`).split(`CAP_COOKIE`);
n=c(n).trim(),r=c(r).trim(),t[n]=r}),t}async setCookie(e){
try{
let t=s(e.key),n=s(e.value),r=e.expires?`;
 expires=${
e.expires.replace(`expires=`,``)}`:``,i=(e.path||`/`).replace(`path=`,``),a=e.url!=null&&e.url.length>0?`domain=${
e.url}`:``;
document.cookie=`${
t}=${
n||``}${
r};
 path=${
i};
 ${
a};
`}catch(e){
return Promise.reject(e)}}async deleteCookie(e){
try{
document.cookie=`${
e.key}=;
 Max-Age=0`}catch(e){
return Promise.reject(e)}}async clearCookies(){
try{
let e=document.cookie.split(`;
`)||[];
for(let t of e)document.cookie=t.replace(/^ +/,``).replace(/=.*/,`=;
expires=${
new Date().toUTCString()};
path=/`)}catch(e){
return Promise.reject(e)}}async clearAllCookies(){
try{
await this.clearCookies()}catch(e){
return Promise.reject(e)}}};
a(`CapacitorCookies`,{
web:()=>new l});
var u=async e=>new Promise((t,n)=>{
let r=new FileReader;
r.onload=()=>{
let e=r.result;
t(e.indexOf(`,`)>=0?e.split(`,`)[1]:e)},r.onerror=e=>n(e),r.readAsDataURL(e)}),d=(e={
})=>{
let t=Object.keys(e);
return Object.keys(e).map(e=>e.toLocaleLowerCase()).reduce((n,r,i)=>(n[r]=e[t[i]],n),{
})},f=(e,t=!0)=>e?Object.entries(e).reduce((e,n)=>{
let[r,i]=n,a,o;
return Array.isArray(i)?(o=``,i.forEach(e=>{
a=t?encodeURIComponent(e):e,o+=`${
r}=${
a}&`}),o.slice(0,-1)):(a=t?encodeURIComponent(i):i,o=`${
r}=${
a}`),`${
e}&${
o}`},``).substr(1):null,p=(e,t={
})=>{
let n=Object.assign({
method:e.method||`GET`,headers:e.headers},t),r=d(e.headers)[`content-type`]||``;
if(typeof e.data==`string`)n.body=e.data;
else if(r.includes(`application/x-www-form-urlencoded`)){
let t=new URLSearchParams;
for(let[n,r]of Object.entries(e.data||{
}))t.set(n,r);
n.body=t.toString()}else if(r.includes(`multipart/form-data`)||e.data instanceof FormData){
let t=new FormData;
if(e.data instanceof FormData)e.data.forEach((e,n)=>{
t.append(n,e)});
else for(let n of Object.keys(e.data))t.append(n,e.data[n]);
n.body=t;
let r=new Headers(n.headers);
r.delete(`content-type`),n.headers=r}else(r.includes(`application/json`)||typeof e.data==`object`)&&(n.body=JSON.stringify(e.data));
return n},m=class extends o{
async request(e){
let t=p(e,e.webFetchExtra),n=f(e.params,e.shouldEncodeUrlParams),r=n?`${
e.url}?${
n}`:e.url,i=await fetch(r,t),a=i.headers.get(`content-type`)||``,{
responseType:o=`text`}=i.ok?e:{
};
a.includes(`application/json`)&&(o=`json`);
let s,c;
switch(o){
case`arraybuffer`:case`blob`:c=await i.blob(),s=await u(c);
break;
case`json`:s=await i.json();
break;
default:s=await i.text()}let l={
};
return i.headers.forEach((e,t)=>{
l[t]=e}),{
data:s,headers:l,status:i.status,url:i.url}}async get(e){
return this.request(Object.assign(Object.assign({
},e),{
method:`GET`}))}async post(e){
return this.request(Object.assign(Object.assign({
},e),{
method:`POST`}))}async put(e){
return this.request(Object.assign(Object.assign({
},e),{
method:`PUT`}))}async patch(e){
return this.request(Object.assign(Object.assign({
},e),{
method:`PATCH`}))}async delete(e){
return this.request(Object.assign(Object.assign({
},e),{
method:`DELETE`}))}};
a(`CapacitorHttp`,{
web:()=>new m});
var h=`modulepreload`,g=function(e){
return`/`+e},_={
},v=function(e){
return e.pathname.endsWith(`.css`)},y=function(e,t,n){
if(t in e)return e[t];
let r=n();
if(!r){
e[t]=void 0;
return}let i=r.then(()=>{
e[t]=void 0},n=>{
throw e[t]=void 0,n});
return e[t]=i,i},b=function(e,t,n){
let r=Promise.resolve();
if(t&&t.length>0){
let e,i=document.querySelector(`meta[property=csp-nonce]`),a=i?.nonce||i?.getAttribute(`nonce`);
function o(e){
return Promise.all(e.map(e=>Promise.resolve(e).then(e=>({
status:`fulfilled`,value:e}),e=>({
status:`rejected`,reason:e}))))}function s(e){
return import.meta.resolve?new URL(import.meta.resolve(e)):new URL(e,import.meta.url)}r=o(t.map(t=>{
t=g(t,n);
let r=s(t),i=v(r);
return y(_,r.href,()=>{
if(e===void 0){
e={
all:new Set,styles:new Set};
let t=document.getElementsByTagName(`link`);
for(let n=t.length-1;
n>=0;
n--){
let r=t[n];
e.all.add(r.href),r.rel===`stylesheet`&&e.styles.add(r.href)}}if((i?e.styles:e.all).has(r.href))return;
let t=document.createElement(`link`);
if(t.rel=i?`stylesheet`:h,i||(t.as=`script`),t.crossOrigin=``,t.href=r.href,a&&t.setAttribute(`nonce`,a),document.head.appendChild(t),i)return new Promise((e,n)=>{
t.addEventListener(`load`,e),t.addEventListener(`error`,()=>n(Error(`Unable to preload CSS for ${
r}`)))})})}).filter(e=>e!==void 0))}function i(e){
let t=new Event(`vite:preloadError`,{
cancelable:!0});
if(t.payload=e,window.dispatchEvent(t),!t.defaultPrevented)throw e}return r.then(t=>{
for(let e of t||[])e.status===`rejected`&&i(e.reason);
return e().catch(i)})};
async function x(){
if(i.isNativePlatform())try{
let{
Haptics:e,ImpactStyle:t}=await b(async()=>{
let{
Haptics:e,ImpactStyle:t}=await import(`./esm-D62gMpjX.js`);
return{
Haptics:e,ImpactStyle:t}},[]);
await e.impact({
style:t.Light})}catch{
}}async function S(){
if(i.isNativePlatform()){
try{
let{
StatusBar:e,Style:t}=await b(async()=>{
let{
StatusBar:e,Style:t}=await import(`./esm-D2dXjnPr.js`);
return{
StatusBar:e,Style:t}},[]),n=window.matchMedia(`(prefers-color-scheme: dark)`).matches;
await e.setOverlaysWebView({
overlay:!0}),await e.setStyle({
style:n?t.Dark:t.Light}),await e.setBackgroundColor({
color:n?`#0c0c0c`:`#f7f5f2`})}catch{
}try{
let{
Keyboard:e}=await b(async()=>{
let{
Keyboard:e}=await import(`./esm-FZHuEcR-.js`);
return{
Keyboard:e}},[]);
e.setAccessoryBarVisible({
isVisible:!1}).catch(()=>{
})}catch{
}}}S();
var C=`baizhi.todos.v1`,w=`Asia/Hong_Kong`,T=window.matchMedia(`(prefers-reduced-motion: reduce)`).matches,E=document.querySelector(`#app`);
E.innerHTML=`
  <header class="app-header">
    <div class="app-meta" id="countMeta"></div>
  </header>
  <main class="paper-scroll" id="paper" aria-label="白纸待办">
    <div class="empty-state" id="empty">
      <div class="empty-glyph" aria-hidden="true"></div>
      <p class="empty-title">轻写下第一件事</p>
      <p class="empty-sub">点 + 新建 · 双击划线 · 长按编辑</p>
    </div>
    <ul class="todo-list" id="list"></ul>
    <div class="tap-catcher" id="tapCatcher" aria-hidden="true"></div>
  </main>
  <button class="fab" id="fab" type="button" aria-label="新建">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
      <path d="M12 5v14M5 12h14"/>
    </svg>
  </button>
`;
var D=document.getElementById(`list`),O=document.getElementById(`empty`),k=document.getElementById(`countMeta`),A=document.getElementById(`paper`),j=document.getElementById(`fab`),M=document.getElementById(`tapCatcher`),N=F(),P=0;
function F(){
try{
let e=localStorage.getItem(C);
if(!e)return[];
let t=JSON.parse(e);
return Array.isArray(t)?t.filter(e=>e&&typeof e.id==`string`).map(e=>({
id:e.id,text:String(e.text??``),createdAt:Number(e.createdAt)||Date.now(),completed:!!e.completed,completedAt:e.completedAt??null})):[]}catch{
return[]}}function I(){
localStorage.setItem(C,JSON.stringify(N))}function L(){
return`${
Date.now().toString(36)}-${
Math.random().toString(36).slice(2,9)}`}function R(e){
let t=new Intl.DateTimeFormat(`en-CA`,{
timeZone:w,year:`numeric`,month:`2-digit`,day:`2-digit`,hour:`2-digit`,minute:`2-digit`,hour12:!1}),n=Object.fromEntries(t.formatToParts(new Date(e)).filter(e=>e.type!==`literal`).map(e=>[e.type,e.value]));
return{
year:n.year,month:n.month,day:n.day,hour:n.hour===`24`?`00`:n.hour,minute:n.minute,ymd:`${
n.year}-${
n.month}-${
n.day}`}}function z(){
return R(Date.now()).ymd}function B(){
return R(Date.now()-864e5).ymd}function V(e){
let t=R(e),n=`${
t.hour}:${
t.minute}`,r=t.ymd;
return r===z()?`今天 ${
n}`:r===B()?`昨天 ${
n}`:`${
t.month}-${
t.day} ${
n}`}function H(){
let e=N.filter(e=>!e.completed).length,t=N.filter(e=>e.completed).length;
N.length===0?k.textContent=``:k.innerHTML=`<span class="meta-open">未完成 ${
e}</span><span class="meta-sep">·</span><span class="meta-done">已完成 ${
t}</span>`,O.classList.toggle(`is-visible`,N.length===0)}function U(e){
e.style.height=`auto`,e.style.height=`${
e.scrollHeight}px`}function W(e,t,n){
return Math.max(t,Math.min(n,e))}function G(e){
let t=W(e,0,1);
return t*t*(3-2*t)}function K(){
if(P=0,T){
D.querySelectorAll(`.todo-item`).forEach(e=>{
let t=e,n=t.querySelector(`.todo-face`);
n&&(n.style.transform=``,n.style.filter=``),t.style.opacity=t.classList.contains(`is-done`)?`0.88`:`1`});
return}let e=A.getBoundingClientRect(),t=Math.max(e.height,1),n=e.top+t*.91;
D.querySelectorAll(`.todo-item`).forEach(r=>{
let i=r,a=i.querySelector(`.todo-face`)||i,o=i.getBoundingClientRect();
if(o.bottom<-100||o.top>e.bottom+100){
i.style.opacity=`0`;
return}let s=o.top+o.height*.5,c=W((n-s)/Math.max(n-0,1),0,1),l=G(c*.38+c**1.28*.62),u=G(W((s-n)/(t*.2),0,1)),d=1.22-l*.74-u*.04,f=1-l*.86-u*.08,p=l*62-u*8,m=-l*260-u*12,h=-l*22,g=l>.55?(l-.55)*2.2:0,_=W(f*(i.classList.contains(`is-done`)?.9:1),.12,1);
a.style.transform=`translate3d(0, ${
h.toFixed(2)}px, ${
m.toFixed(2)}px) rotateX(${
p.toFixed(2)}deg) scale(${
d.toFixed(4)})`,a.style.filter=g>.04?`blur(${
g.toFixed(2)}px)`:``,i.style.opacity=_.toFixed(3)})}function q(){
P||=requestAnimationFrame(K)}function J(e,{
animate:t=!1,startEditing:n=!1}={
}){
let r=document.createElement(`li`);
r.className=`todo-item${
e.completed?` is-done`:``}${
t?` is-entering`:``}`,r.dataset.id=e.id,r.innerHTML=`
    <div class="todo-face">
      <div class="todo-body">
        <time class="todo-time" datetime="${
new Date(e.createdAt).toISOString()}">${
V(e.createdAt)}</time>
        <textarea class="todo-text" rows="1" maxlength="280" placeholder="写点什么…" enterkeyhint="done" readonly></textarea>
      </div>
    </div>
  `;
let i=r.querySelector(`.todo-text`);
i.value=e.text,U(i);
let a=0,o=0,s=0,c=!1,l=0,u=!1,d=()=>{
a&&=(clearTimeout(a),0),r.classList.remove(`is-longpressing`,`is-pressing`)},f=()=>{
u=!0,i.readOnly=!1,r.classList.add(`is-editing`),i.focus();
let e=i.value.length;
try{
i.setSelectionRange(e,e)}catch{
}},p=()=>{
u=!1,i.readOnly=!0,r.classList.remove(`is-editing`)};
return r.addEventListener(`pointerdown`,e=>{
u||document.activeElement===i||(e.pointerType!==`mouse`||e.button===0)&&(c=!1,o=e.clientX,s=e.clientY,r.classList.add(`is-pressing`,`is-longpressing`),clearTimeout(a),a=window.setTimeout(()=>{
a=0,c=!0,l=0,r.classList.remove(`is-longpressing`),x(),f()},480))}),r.addEventListener(`pointermove`,e=>{
if(!a)return;
let t=e.clientX-o,n=e.clientY-s;
t*t+n*n>64&&d()}),r.addEventListener(`pointerup`,()=>{
let t=c,n=!!a;
if(d(),t||!n||u||document.activeElement===i)return;
let r=performance.now();
l&&r-l<320?(l=0,x(),X(e.id)):l=r}),r.addEventListener(`pointerleave`,d),r.addEventListener(`pointercancel`,d),r.addEventListener(`contextmenu`,e=>{
e.preventDefault()}),i.addEventListener(`pointerdown`,e=>{
u||e.preventDefault()}),i.addEventListener(`input`,()=>{
U(i);
let t=N.find(t=>t.id===e.id);
t&&(t.text=i.value,I(),q())}),i.addEventListener(`keydown`,e=>{
e.key===`Enter`&&!e.shiftKey&&(e.preventDefault(),i.blur())}),i.addEventListener(`blur`,()=>{
let t=N.find(t=>t.id===e.id);
t&&(t.text=i.value.trim(),i.value=t.text,U(i),I(),p(),q())}),t&&r.addEventListener(`animationend`,()=>{
r.classList.remove(`is-entering`),q()},{
once:!0}),n&&requestAnimationFrame(()=>f()),r}function Y(){
D.replaceChildren();
let e=[...N].sort((e,t)=>e.createdAt-t.createdAt);
for(let t of e)D.appendChild(J(t));
H(),q()}function X(e){
let t=N.find(t=>t.id===e);
if(!t)return;
t.completed=!t.completed,t.completedAt=t.completed?Date.now():null,I();
let n=D.querySelector(`[data-id="${
e}"]`);
n?(n.classList.toggle(`is-done`,t.completed),H(),q()):Y()}function Z({
focus:e=!0}={
}){
x();
let t={
id:L(),text:``,createdAt:Date.now(),completed:!1,completedAt:null};
N.push(t),I(),O.classList.remove(`is-visible`);
let n=J(t,{
animate:!0,startEditing:e});
return D.appendChild(n),H(),requestAnimationFrame(()=>{
let t=()=>{
let e=A.getBoundingClientRect(),t=n.getBoundingClientRect(),r=e.top+A.clientHeight*.9,i=t.top+t.height*.5-r,a=Math.max(0,A.scrollTop+i);
A.scrollTo({
top:a,behavior:`smooth`})};
A.scrollTo({
top:A.scrollHeight,behavior:`auto`}),requestAnimationFrame(t),q(),e&&setTimeout(()=>{
t(),q()},180)}),t}j.addEventListener(`click`,()=>Z()),M.addEventListener(`click`,()=>Z()),A.addEventListener(`click`,e=>{
(e.target===A||e.target===O||O.contains(e.target))&&N.length===0&&Z()}),A.addEventListener(`scroll`,q,{
passive:!0}),window.addEventListener(`resize`,q),window.visualViewport?.addEventListener(`resize`,q),setInterval(()=>{
D.querySelectorAll(`.todo-item`).forEach(e=>{
let t=e.dataset.id,n=N.find(e=>e.id===t);
if(!n)return;
let r=e.querySelector(`.todo-time`);
r&&(r.textContent=V(n.createdAt))})},6e4),Y(),window.__baizhi={
addTodo:Z,todos:()=>N,formatStamp:V,renderAll:Y,STORAGE_KEY:C,updateReel:K,scheduleReel:q};
export{
o as n,a as r,b as t};
