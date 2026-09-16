'use strict';
const fs = require('node:fs');
const path = require('node:path');

async function runChecks(source){
 const results=[];
 function assert(value,label){if(!value)throw new Error(label);results.push(label);}
 const elements=new Map();
 let inputValue='';
 let network=async()=>({ok:true,status:200,json:async()=>({retcode:0,data:{}})});
 const timers=new Map();let timerSequence=0;
 const input={get value(){return inputValue;},getBoundingClientRect:()=>({width:10,height:10}),focus(){},select(){}};
 function element(){
  return {dataset:{},attributes:{},children:new Map(),hidden:false,_html:'',style:{},
   setAttribute(key,value){this.attributes[key]=value;},
   appendChild(child){if(child.id)elements.set(child.id,child);},
   remove(){elements.delete(this.id);if(this.id==='spx-returns-assistant-modal')elements.delete('spx-returns-assistant-autoadd');},
   focus(){},
   set innerHTML(value){
    this._html=value;
    if(this.id==='spx-returns-assistant-modal'){
     for(const selector of ['.shipment strong','.body','[data-refresh]'])this.children.set(selector,element());
     elements.set('spx-returns-assistant-autoadd',element());
    }
   },
   get innerHTML(){return this._html;},
   querySelector(selector){return this.children.get(selector)||null;}
  };
 }
 const document={createElement:()=>element(),documentElement:element(),body:element(),addEventListener(){},removeEventListener(){},getElementById:id=>elements.get(id)||null,querySelectorAll:()=>[input],cookie:''};
 const location={origin:'https://spx.shopee.com.br',hash:'#/generalReceiveTaskMgt/singleReceiveNew/test'};
 const window={addEventListener(){}};
 const testSource=source.replace('(function initializeReturnsAssistant()', 'return (function initializeReturnsAssistant()')
 .replace(/\n  window\.addEventListener\('hashchange'[\s\S]*$/,
 `\nreturn {isTargetRoute, recommendation, validAttemptDays, photoUrl, renderHistory, autoAddTarget, currentTask, exactTarget, startShipment, shipmentChanged, stop, loadHistory, handleAddress, loadTaskPages, setCollapsed,
 state:()=>({version:requestVersion,lastShipmentId,historyBusy}),setVersion:value=>{requestVersion=value;}};
 })();`);
 const fakeTimeout=(callback,ms)=>{timers.set(++timerSequence,{callback,ms});return timerSequence;};
 const app=new Function('document','window','location','fetch','setTimeout','clearTimeout','setInterval','clearInterval','AbortController',testSource)(document,window,location,(...args)=>network(...args),fakeTimeout,id=>timers.delete(id),fakeTimeout,id=>timers.delete(id),class{signal={};abort(){}});
 assert(app.isTargetRoute(),'Management receiving route supported');
 location.hash='#/generalReceiveTaskMgt/singleReceiveNew/123?tab=receive';
 assert(app.isTargetRoute(),'Management task identifiers supported');
 location.hash='#/generalReceiveTaskOps/singleReceiveNew/test';
 assert(app.isTargetRoute(),'Operations receiving route preserved');
 location.hash='#/generalReceiveTaskMgt/other/test';
 assert(!app.isTargetRoute(),'Unrelated routes ignored');
 location.hash='#/generalReceiveTaskMgt/singleReceiveNew/test';
 const attempt=(reason,day)=>({ctime:Date.UTC(2026,8,day,15)/1000,on_hold_reason__desc:reason,driver_name:'Driver'});
 const oneDay=[attempt('recipient unavailable for parcel',1),attempt('office closed',1),attempt('recipient unavailable for parcel',1),attempt('insufficient time',2),attempt('insufficient time',3)];
 assert(app.recommendation(oneDay,'').text==='PROCESSAR PARA ENTREGA','Invalid reasons on other days do not trigger SOC');
 const valid=[attempt('recipient unavailable for parcel',1),attempt('office closed',2),attempt('cannot find address',3)];
 assert(app.recommendation(valid,'').text==='RETORNAR AO SOC','Three distinct valid days trigger SOC');
 assert(app.recommendation([...valid,attempt('wrongly assigned',4)],'').text==='REALOCAR/FLEET','Newest out-of-route takes priority');
 assert(app.recommendation([attempt('wrongly assigned',1),attempt('office closed',2)],'').text==='PROCESSAR PARA ENTREGA','Old out-of-route does not force reallocation');
 assert(app.recommendation([attempt('cannot find address',1)],'unknown').text==='CONFERIR TRATATIVA NO SPX','Address lookup errors do not imply delivery clearance');
 assert(app.recommendation([attempt('do not deliver',1)],'').text==='RETORNAR AO SOC','Final reasons preserved');
 assert(app.photoUrl({photo_list:['javascript:alert(1)']})==='','Unsafe photo scheme rejected');
 const html=app.renderHistory([{...attempt('office closed',1),driver_name:'<img onerror=alert(1)>',photo_list:['https://example.com/a.jpg']}],{state:''});
 assert(!html.includes('<img onerror=')&&html.includes('&lt;img onerror='),'API text escaped in UI');
 assert(html.indexOf('class="attempt"')<html.indexOf('class="decision '),'Classic layout shows orientation after attempts');
 assert(app.exactTarget([{target_id:'AT999',binding_entity:'wrong'}],'AT123')===null,'Unrelated AT never used as fallback');
 assert(app.currentTask([{validation_task_id:'closed',end_time:12}])===null,'Closed VT never used as fallback');
 assert(app.currentTask([{validation_task_id:'older',start_time:1},{validation_task_id:'newer',start_time:2}]).validation_task_id==='newer','Newest open VT selected');
 const now=Math.floor(Date.now()/1000);
 const tracking=(id,seconds,operator='Admin(Polygon Auto Add)')=>({message:`Assignment Task [${id}]`,timestamp:now-seconds,operator});
 assert(app.autoAddTarget({data:{tracking_list:[tracking('ATOLD',14000),tracking('ATNEW',70),tracking('ATMANUAL',1,'Other')]}},now)==='ATNEW','Newest AutoAdd in four-hour lookback selected');
 assert(app.autoAddTarget({data:{tracking_list:[tracking('ATOLD',14401),tracking('ATFUTURE',-300)]}},now)==='','Old and future tracking excluded');
 inputValue='BR1234567890123';
 app.shipmentChanged();
 const version=app.state().version;
 inputValue='BR1234567890124';
 app.shipmentChanged();
 assert(app.state().version>version&&app.state().lastShipmentId===inputValue,'New scan invalidates old response before debounce');
 app.setCollapsed(true);
 const modal=elements.get('spx-returns-assistant-modal');
 let resolveHistory;
 network=()=>new Promise(resolve=>{resolveHistory=resolve;});
 const current=app.state().version;
 const waiting=app.loadHistory(inputValue,current);
 app.stop();
 resolveHistory({ok:true,status:200,json:async()=>({retcode:0,data:{recipient:{On_Hold:valid}}})});
 await waiting;
 assert(!elements.has('spx-returns-assistant-modal'),'Response after stop cannot recreate UI');
 assert(![...timers.values()].some(item=>item.ms===1500),'Stop cancels pending scan debounce');
 inputValue='BR1234567890125';app.shipmentChanged();
 const active=app.state().version;
 network=async()=>({ok:true,status:200,json:async()=>({retcode:0,data:{recipient:{On_Hold:valid}}})});
 app.setCollapsed(true);
 await app.loadHistory(inputValue,active);
 assert(elements.get('spx-returns-assistant-modal').hidden,'Collapsed panel stays closed after response');
 let pageCalls=0;
 network=async()=>{
  pageCalls++;
  return {ok:true,status:200,json:async()=>({retcode:0,data:{total:101,list:pageCalls===1?Array.from({length:100},(_,i)=>({validation_task_id:'VT'+i})): [{validation_task_id:'VT100'}]}})};
 };
 const tasks=await app.loadTaskPages({start:0,end:10},active);
 assert(tasks.length===101&&pageCalls===2,'VT pagination reads beyond first page');
 const liveModal=elements.get('spx-returns-assistant-modal');
 const strong=element();const decision=element();decision.children.set('strong',strong);liveModal.children.set('.decision',decision);
 const actionStatus=element();
 const buttons=[{disabled:false,hidden:false},{disabled:false,hidden:false}];
 const actions={dataset:{reasonId:'ER40',localLang:'pt'},querySelector:()=>actionStatus,querySelectorAll:()=>buttons};
 const button={dataset:{addressAction:'confirm'},closest:selector=>selector.startsWith('#')?liveModal:actions};
 let resolveWrite;let writes=0;
 network=()=>{writes++;return new Promise(resolve=>{resolveWrite=resolve;});};
 const write=app.handleAddress(button);
 await app.handleAddress(button);
 assert(writes===1,'Duplicate address clicks submit only once');
 inputValue='BR1234567890126';app.shipmentChanged();
 resolveWrite({ok:true,status:200,json:async()=>({retcode:0})});await write;
 assert(strong.textContent===undefined,'Old action completion cannot overwrite new shipment');
 new Function(source);
 return results;
}

runChecks(fs.readFileSync(path.join(__dirname, 'assistente-de-devolucoes.js'), 'utf8'))
  .then(results => console.log(`${results.length} checks passed`))
  .catch(error => { console.error(error); process.exitCode = 1; });
