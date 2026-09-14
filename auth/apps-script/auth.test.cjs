'use strict';
const fs = require('node:fs');
const path = require('node:path');

function backendTests(source){
 const passed=[];
 const assert=(value,message)=>{if(!value)throw Error(message);passed.push(message);};
 const sheets=new Map();
 class Sheet {
  constructor(name){this.name=name;this.data=[];}
  appendRow(row){this.data.push([...row]);return this;}
  getLastRow(){return this.data.length;}
  getLastColumn(){return this.data[0]?.length||0;}
  getRange(row,col,height=1,width=1){
   return {
    getValues:()=>Array.from({length:height},(_,r)=>Array.from({length:width},(_,c)=>this.data[row-1+r]?.[col-1+c]??'')),
    setValue:value=>{this.data[row-1][col-1]=value;},
    setValues:values=>{values.forEach((items,r)=>{this.data[row-1+r]??=[];items.forEach((v,c)=>{this.data[row-1+r][col-1+c]=v;});});}
   };
  }
  deleteRow(index){this.data.splice(index-1,1);}
 }
 for(const [name,headers] of Object.entries({USUARIOS:['usuario_id','email','nome','status','criado_em','ultimo_login'],MODULOS:['modulo_id','nome','restrito'],PERMISSOES:['email','modulo_id','modulo','status','alterado_em','alterado_por'],SESSOES:['token_hash','email','expira_em']})){
  const sheet=new Sheet(name);sheet.appendRow(headers);sheets.set(name,sheet);
 }
 const book={getSheetByName:name=>sheets.get(name)};
 sheets.get('MODULOS').appendRow(['spx-dock-flow','Dock Flow','SIM']);
 sheets.get('MODULOS').appendRow(['assistente-de-devolucoes','Devoluções','SIM']);
 const props=new Map([['AUTH_SECRET','test-only-secret'],['SPREADSHEET_ID','test-sheet']]);
 const cache=new Map();
 let uuid=0;
 const mails=[];
 // Deterministic test double only; production uses Google's HMAC-SHA256 implementation.
 function fakeHmac(value,key){
  let hash=2166136261;
  for(const character of key+value){hash^=character.charCodeAt(0);hash=Math.imul(hash,16777619);}
  return Array.from({length:32},(_,i)=>{hash=Math.imul(hash^i,16777619);return hash&255;});
 }
 const Utilities={getUuid:()=>String(++uuid).padStart(32,'0'),computeHmacSha256Signature:fakeHmac,formatDate:date=>date.toISOString().slice(0,10)};
 const PropertiesService={getScriptProperties:()=>({getProperty:key=>props.get(key)||null,setProperty:(key,value)=>props.set(key,value)})};
 const CacheService={getScriptCache:()=>({get:key=>cache.get(key)||null,put:(key,value)=>cache.set(key,value),remove:key=>cache.delete(key)})};
 const MailApp={getRemainingDailyQuota:()=>100,sendEmail:mail=>mails.push(mail)};
 const SpreadsheetApp={openById:()=>book};
 const ContentService={MimeType:{JSON:'json'},createTextOutput:text=>({setMimeType:()=>JSON.parse(text)})};
 const LockService={getScriptLock:()=>({tryLock:()=>true,hasLock:()=>true,releaseLock(){}})};
 const diagnosticLogs=[];
 const testConsole={info:value=>diagnosticLogs.push(JSON.parse(value)),error:value=>diagnosticLogs.push(JSON.parse(value))};
 const api=new Function('Utilities','PropertiesService','CacheService','MailApp','SpreadsheetApp','ContentService','LockService','console',source+'\nreturn {doPost,access_,digest_};')(Utilities,PropertiesService,CacheService,MailApp,SpreadsheetApp,ContentService,LockService,testConsole);
 const call=body=>api.doPost({postData:{contents:JSON.stringify(body)}});
 assert(call({action:'policy'}).modules.every(m=>m.restricted),'Both modules restricted by default');
 assert(!call({action:'session',token:'bad'}).ok,'Invalid session rejected');
 assert(!call({action:'request_code',email:'=EVIL'}).ok,'Invalid email rejected');
 assert(call({action:'request_code',email:'USER@example.com'}).ok,'Verification code can be requested');
 assert(sheets.get('USUARIOS').data.length===1,'Unverified email is not registered');
 assert(!call({action:'request_code',email:'user@example.com'}).ok,'Immediate resend rate limited');
 const code=mails[0].subject.slice(0,6);
 const wrong=code==='000000'?'000001':'000000';
 assert(!call({action:'verify_code',email:'user@example.com',code:wrong}).ok,'Wrong code rejected');
 const login=call({action:'verify_code',email:'user@example.com',code,name:'=HYPERLINK("x")'});
 assert(login.ok&&/^[a-f0-9]{64}$/.test(login.token),'Valid code creates a session');
 assert(login.user.email==='user@example.com','Email normalized consistently');
 assert(sheets.get('USUARIOS').data[1][2].startsWith("'="),'Spreadsheet formula injection neutralized');
 assert(login.modules.every(m=>m.status==='PENDENTE'&&!m.allowed),'First login creates pending grants');
 assert(!call({action:'verify_code',email:'user@example.com',code}).ok,'Code cannot be replayed');
 assert(sheets.get('SESSOES').data[1][0]!==login.token,'Raw session token is not stored in sheet');
 const permissions=sheets.get('PERMISSOES');
 permissions.data[1][3]='APROVADO';
 let result=call({action:'session',token:login.token});
 assert(result.ok&&result.modules[0].allowed&&!result.modules[1].allowed,'Approval scoped to one module');
 permissions.data[1][3]='NEGADO';
 result=call({action:'session',token:login.token});
 assert(!result.modules[0].allowed&&result.modules[0].status==='NEGADO','Revocation applies on next read');
 permissions.data[1][3]='APROVADO';
 permissions.appendRow([...permissions.data[1]]);
 assert(!call({action:'session',token:login.token}).modules[0].allowed,'Duplicate permission cannot grant access');
 permissions.deleteRow(permissions.data.length);
 sheets.get('MODULOS').data[2][2]='NAO';
 assert(call({action:'policy'}).modules[1].restricted===false,'Public modules configured in sheet');
 assert(call({action:'session',token:login.token}).modules[1].allowed,'Public module works without individual approval');
 sheets.get('USUARIOS').data[1][3]='BLOQUEADO';
 assert(call({action:'session',token:login.token}).code==='ACCOUNT_BLOCKED','Blocked account cannot reuse existing session');
 sheets.get('USUARIOS').data[1][3]='ATIVO';
 sheets.get('SESSOES').data[1][2]=new Date(Date.now()-1);
 assert(call({action:'session',token:login.token}).code==='SESSION_EXPIRED','Expired session rejected');
 sheets.get('SESSOES').data[1][2]=new Date(Date.now()+100000);
 assert(call({action:'logout',token:login.token}).ok&&!call({action:'session',token:login.token}).ok,'Logout revokes session');
 call({action:'request_code',email:'other@example.com'});
 const otherCode=mails.at(-1).subject.slice(0,6);
 const otherWrong=otherCode==='000000'?'000001':'000000';
 for(let i=0;i<5;i++)call({action:'verify_code',email:'other@example.com',code:otherWrong});
 assert(!call({action:'verify_code',email:'other@example.com',code:otherCode}).ok,'Five failed guesses invalidate the code');
 assert(call({action:'approve',email:'other@example.com',status:'APROVADO'}).code==='INVALID_REQUEST','Public API has no administrative approval operation');
 const policy=call({action:'policy'});
 assert(!JSON.stringify(policy).includes('user@example.com'),'Anonymous policy does not disclose users');
 assert(diagnosticLogs.some(log=>log.event==='REQUEST_RECEIVED'&&log.action==='policy'),'Logs distinguish policy from mail requests');
 assert(diagnosticLogs.some(log=>log.event==='MAIL_SEND_ACCEPTED'),'Successful MailApp return is recorded');
 assert(!JSON.stringify(diagnosticLogs).includes(login.token),'Session tokens absent from diagnostics');
 const deliveredBefore=mails.length;
 MailApp.sendEmail=()=>{throw Error('Permission denied for MailApp.sendEmail; code 123456');};
 const failed=call({action:'request_code',email:'failure@example.com'});
 assert(!failed.ok&&failed.code==='MAIL_FAILED'&&failed.requestId,'Mail failure returns correlation reference');
 assert(mails.length===deliveredBefore,'Mail error is not reported as sent');
 const failureLog=diagnosticLogs.find(log=>log.event==='MAIL_SEND_FAILED');
 assert(failureLog&&failureLog.detail.includes('Permission denied')&&!failureLog.detail.includes('123456'),'Mail error preserves cause without code');
 return passed;
}

async function frontendTests(source,launcherSource){
 const passed=[];
 const assert=(value,message)=>{if(!value)throw Error(message);passed.push(message);};
 const elements=new Map();
 function element(){
  return {value:'',hidden:false,disabled:false,open:false,dataset:{},listeners:{},classList:{toggle(){}},
   addEventListener(name,handler){this.listeners[name]=handler;},
   focus(){},reportValidity(){return true;},showModal(){this.open=true;},close(){this.open=false;},
   querySelectorAll(){return [];},
   set textContent(value){this._text=String(value);this._html=String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');},
   get textContent(){return this._text||'';},set innerHTML(value){this._html=value;},get innerHTML(){return this._html||'';}
  };
 }
 const document={hidden:false,activeElement:element(),addEventListener(){},getElementById:id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id);},createElement:()=>element()};
 const window={SPX_AUTH_CONFIG:{apiUrl:'https://script.google.com/macros/s/test/exec'},addEventListener(){},dispatchEvent(){}};
 const storage=new Map();
 const sessionStorage={getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)};
 let network=async()=>({ok:true,status:200,json:async()=>({ok:true,modules:[{id:'free',restricted:false},{id:'locked',restricted:true}]})});
 const instrumented=source.replace('(function initializeHubAuth()', 'return (function initializeHubAuth()')
 .replace('  renderAccount();\n  void refresh();\n})();', '  return { access, refresh, authorize, applyResult, saveToken, logout, state, openLogin, requestCode, verifyCode };\n})();');
 const app=new Function('window','document','sessionStorage','fetch','AbortController','setTimeout','clearTimeout','setInterval','CustomEvent',instrumented)(
  window,document,sessionStorage,(...args)=>network(...args),class{signal={};abort(){}},()=>1,()=>{},()=>1,class{});
 assert(!app.access('locked').allowed,'Restricted module denied before policy response');
 await app.refresh();
 assert(app.access('free').allowed,'Public module available to anonymous user');
 assert(!app.access('locked').allowed,'Anonymous user cannot access restricted module');
 assert(!app.access('unknown').allowed,'Unknown module defaults to restricted');
 const token='a'.repeat(64);
 app.saveToken(token);
 const result={user:{email:'user@example.com'},expiresAt:Date.now()+3600000,modules:[{id:'free',restricted:false},{id:'locked',restricted:true,status:'PENDENTE',allowed:false}]};
 app.applyResult(result,true);
 assert(!app.access('locked').allowed,'Authenticated pending user remains locked');
 app.applyResult({...result,modules:[{id:'locked',restricted:true,status:'APROVADO',allowed:true}]},true);
 assert(app.access('locked').allowed,'Approved user can access approved module');
 app.applyResult({...result,modules:[{id:'locked',restricted:true,status:'APROVADO',allowed:false}]},true);
 assert(!app.access('locked').allowed,'Approval label alone does not grant access');
 app.applyResult({...result,modules:[{id:'locked',restricted:true,status:'NEGADO',allowed:false}]},true);
 assert(app.access('locked').message.includes('não autorizado'),'Denied access has explicit explanation');
 app.applyResult({...result,modules:[{id:'locked',restricted:true,status:'APROVADO',allowed:true}]},true);
 app.state.expiresAt=Date.now()-1;
 assert(!app.access('locked').allowed,'Expired client session remains locked');
 app.state.expiresAt=Date.now()+3600000;
 app.state.checkedAt=Date.now()-76000;
 assert(!app.access('locked').allowed,'Stale permission snapshot is not trusted');
 network=async()=>{throw Error('offline');};
 await app.refresh(true);
 assert(!app.access('locked').allowed,'Network failure clears previous grant');
 network=async()=>({ok:true,json:async()=>({ok:true,...result,modules:[{id:'locked',restricted:true,status:'APROVADO',allowed:true}]})});
 assert(await app.authorize('locked'),'Action rechecks permissions with backend');
 network=async()=>({ok:true,json:async()=>({ok:true,...result})});
 assert(!await app.authorize('locked'),'Revoked permission blocks the next action');
 let finishOld;
 network=()=>new Promise(resolve=>{finishOld=resolve;});
 const oldRefresh=app.refresh(true);
 network=async()=>({ok:true,json:async()=>({ok:true,modules:[{id:'free',restricted:false},{id:'locked',restricted:true}]})});
 await app.logout();
 finishOld({ok:true,json:async()=>({ok:true,...result,modules:[{id:'locked',restricted:true,status:'APROVADO',allowed:true}]})});
 await oldRefresh;
 assert(!app.access('locked').allowed&&app.state.user===null,'Old response cannot restore grants after logout');
 app.openLogin();
 assert(elements.get('authCode').required===false,'Hidden code field does not block initial form submission');
 elements.get('authEmail').value='user@example.com';
 network=async()=>({ok:true,json:async()=>({ok:true,retryAfter:60})});
 await app.requestCode();
 assert(elements.get('authCode').required===true&&!elements.get('authCodeGroup').hidden,'Code becomes required after email was sent');
 let backendActions=0;
 const HubAuth={access:()=>({allowed:false,message:'Aguardando aprovação'}),authorize:async()=>false};
 const LoaderBridge={request:async()=>({ok:true}),requestForModule:async()=>{backendActions++;return {ok:true};},openModule(){backendActions++;}};
 const launcher=launcherSource.replace('loadModules(false);','')+
 '\nreturn {renderModules, toggleUserScript, setModules:value=>{currentModules=value;}};';
 const launcherApp=new Function('window','document','HubAuth','LoaderBridge',launcher)(window,document,HubAuth,LoaderBridge);
 launcherApp.setModules([{id:'locked-web',name:'Dashboard',type:'web_app',enabled:true},{id:'locked-script',name:'Script',type:'user_script',enabled:true}]);
 launcherApp.renderModules();
 const html=elements.get('moduleGrid').innerHTML;
 assert(html.includes('Dashboard')&&html.includes('Script')&&html.match(/Bloqueado/g).length===2,'All restricted cards remain visible with lock notices');
 assert(!html.includes('data-module-id=')&&!html.includes('data-user-script-toggle='),'Locked cards contain no opening or activation controls');
 await launcherApp.toggleUserScript({id:'locked-script'},true);
 assert(backendActions===0,'Activation handler enforces approval');
 await launcherApp.toggleUserScript({id:'locked-script'},false);
 assert(backendActions===1,'Deactivation remains available when permission is revoked');
 return passed;
}

(async function main() {
  const backend = backendTests(fs.readFileSync(path.join(__dirname, 'Code.gs'), 'utf8'));
  const frontend = await frontendTests(
    fs.readFileSync(path.join(__dirname, '../../launcher/auth.js'), 'utf8'),
    fs.readFileSync(path.join(__dirname, '../../launcher/launcher.js'), 'utf8')
  );
  console.log(`${backend.length + frontend.length} checks passed`);
})().catch(error => { console.error(error); process.exitCode = 1; });
