const fs = require('node:fs');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const source = fs.readFileSync(require('node:path').join(__dirname, 'importador-de-planilhas.js'),'utf8');
const main = `<!doctype html><html><head><style>
body{font:14px Arial}.grid{height:500px;background:#eee}.modal-dialog,.picker-dialog{padding:24px;background:white;border:1px solid #ccc}.goog-menuitem,[role=listbox]{padding:12px;cursor:pointer}[hidden]{display:none!important}
</style></head><body>
<div id="docs-file-menu" role="menuitem" class="menu-button goog-control goog-inline-block" aria-disabled="false" aria-expanded="false" aria-haspopup="true">File</div>
<div class="goog-menuitem apps-menuitem" role="menuitem" id="import-menu" hidden><div class="goog-menuitem-content"><div class="docs-icon" aria-hidden="true"><div class="docs-icon-img docs-icon-editors-ia-import">↥</div></div><span aria-label="Import i" class="goog-menuitem-label"><span class="goog-menuitem-mnemonic-hint">I</span>mport</span></div></div>
<div class="grid"></div><div class="picker-dialog" role="dialog" hidden></div>
<div class="modal-dialog docs-dialog" role="dialog" hidden>
<h2>Import file</h2><div class="waffle-import-options-destination">
<div class="docs-material-gm-labeled-select jfk-select" id="destination" aria-labelledby="destination-label" role="listbox" aria-expanded="false" tabindex="0" aria-haspopup="true">
<div class="docs-material-gm-labeled-select-content"><label class="docs-material-gm-labeled-select-label" for="destination" id="destination-label">Import location</label></div>
<div class="docs-material-gm-labeled-select-outer-box"><div class="docs-material-gm-labeled-select-inner-box"><div class="docs-material-gm-labeled-select-caption">Create new spreadsheet</div><div class="docs-material-gm-labeled-select-dropdown"></div></div></div></div></div>
<div class="waffle-import-options-delimiter"><div role="listbox" class="docs-material-gm-labeled-select"><label>Separator type</label><div class="docs-material-gm-labeled-select-caption">Detect automatically</div></div></div>
<button name="import">Import data</button><button name="cancel">Cancel</button></div>
<script>
window.confirmed=0;window.destination='Create new spreadsheet';window.separatorClicks=0;
document.querySelector('.waffle-import-options-delimiter [role=listbox]').onclick=()=>window.separatorClicks++;
document.getElementById('docs-file-menu').onmousedown=()=>{document.getElementById('import-menu').hidden=false;document.getElementById('docs-file-menu').setAttribute('aria-expanded','true');};
document.getElementById('import-menu').onmouseup=()=>{document.getElementById('import-menu').hidden=true;const picker=document.querySelector('.picker-dialog');picker.hidden=false;const frame=document.createElement('iframe');frame.src='https://drive.google.com/picker';picker.append(frame);};
window.addEventListener('message',e=>{if(e.origin!=='https://drive.google.com'||e.data?.type!=='fixture-upload')return;window.received=e.data.name;window.receivedText=e.data.text;document.querySelector('.picker-dialog').remove();document.querySelector('.modal-dialog').hidden=false;});
document.querySelector('[name=import]').onclick=()=>window.confirmed++;
const dropdown=document.getElementById('destination');dropdown.onmousedown=()=>{dropdown.setAttribute('aria-expanded','true');const menu=document.createElement('div');menu.role='listbox';for(const text of ['Create new spreadsheet','Replace current sheet','Insert new sheet(s)','Replace spreadsheet']){const option=document.createElement('div');option.className='goog-menuitem';option.role='option';option.textContent=text;option.onmouseup=()=>{dropdown.querySelector('.docs-material-gm-labeled-select-caption').textContent=text;window.destination=text;dropdown.setAttribute('aria-expanded','false');menu.remove();};menu.append(option);}document.body.append(menu);};
</script></body></html>`;
const picker = `<html><body><button role="tab" aria-selected="false" id="3"><span><span>Upload</span></span></button><div class="qhOH9d" hidden><button id="uploadButtonId">Browse</button><input type="file" jsname="G1bupd" jsaction="change:NwEMS(l00Vee)" accept="text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" style="display:none"><div>or drag a file to upload to <b>My Drive</b> and select</div></div><script>
document.querySelector('[role=tab]').onclick=e=>{e.currentTarget.setAttribute('aria-selected','true');document.querySelector('.qhOH9d').hidden=false;};
document.querySelector('input').addEventListener('change',async e=>{if(document.querySelector('[role=tab]').getAttribute('aria-selected')!=='true')throw new Error('Upload tab not selected');window.top.postMessage({type:'fixture-upload',name:e.target.files[0].name,text:await e.target.files[0].text()},'https://docs.google.com');});
</script></body></html>`;
(async()=>{
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE_PATH,headless:true,args:['--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--disable-software-rasterizer','--use-gl=angle','--use-angle=swiftshader']});
const context=await browser.newContext({viewport:{width:1366,height:768}});
await context.route('**/*',async route=>{
 const url=route.request().url();
 if(url==='https://docs.google.com/spreadsheets/d/test-sheet/edit')return route.fulfill({headers:{'Content-Security-Policy':"require-trusted-types-for 'script'; trusted-types 'none'"},contentType:'text/html; charset=utf-8',body:main});
 if(url==='https://drive.google.com/picker')return route.fulfill({headers:{'Content-Security-Policy':"require-trusted-types-for 'script'; trusted-types 'none'"},contentType:'text/html; charset=utf-8',body:picker+'<script>'+source+'</script>'});
 return route.abort();
});
const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto('https://docs.google.com/spreadsheets/d/test-sheet/edit');await page.evaluate(source);
await page.evaluate(()=>{const transfer=new DataTransfer();transfer.items.add(new File(['id,quantidade\nBR0123,20'],'recebimento.csv',{type:'text/csv'}));document.querySelector('.grid').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer}));});
await page.getByRole('button',{name:'Continuar',exact:true}).waitFor();

await page.getByRole('button',{name:'Continuar',exact:true}).click();
try { await page.waitForFunction(()=>window.destination==='Insert new sheet(s)',null,{timeout:8000}); } catch(e) { console.log(await page.evaluate(()=>({status:document.querySelector('[data-spx-importer]').shadowRoot.querySelector('.status').textContent,received:window.received,destination:window.destination,body:document.body.innerText,frames:window.frames.length}))); console.log(errors); console.log(await Promise.all(page.frames().map(async f=>({url:f.url(),data:await f.evaluate(()=>({worker:window.__spxSheetsImporter,body:document.body.innerText})).catch(()=>null)}))));  await browser.close(); throw e; }
await page.waitForFunction(()=>document.querySelector('[data-spx-importer]').shadowRoot.querySelector('.status').classList.contains('ok'));assert.equal(await page.evaluate(()=>window.received),'recebimento.csv');assert.equal(await page.evaluate(()=>window.confirmed),0);assert.equal(await page.evaluate(()=>window.separatorClicks),0);
assert.deepEqual(errors,[]);
await assert.rejects(page.evaluate(()=>{document.createElement('div').attachShadow({mode:'open'}).innerHTML='<p>blocked</p>';}), /TrustedHTML/);
await page.setViewportSize({width:390,height:720});await page.getByRole('button',{name:'Importar',exact:true}).click();

await page.goto('https://docs.google.com/spreadsheets/d/test-sheet/edit');await page.evaluate(source);await page.getByRole('button',{name:'Importar',exact:true}).click();await page.locator('input[type=file]').setInputFiles({name:'dados.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(fs.readFileSync(require('node:path').join(__dirname,'fixtures/dados.xlsx.base64'),'utf8'),'base64')});await page.waitForFunction(()=>!document.querySelector('[data-spx-importer]').shadowRoot.querySelector('.start').disabled);await page.locator('input[value=current]').check();await page.locator('.sheet').selectOption('1');await page.getByRole('button',{name:'Continuar',exact:true}).click();await page.waitForFunction(()=>window.destination==='Replace current sheet',null,{timeout:10000});await page.waitForFunction(()=>document.querySelector('[data-spx-importer]').shadowRoot.querySelector('.status').classList.contains('ok'));assert.equal(await page.evaluate(()=>window.received),'Expedição.csv');assert.equal(await page.evaluate(()=>window.receivedText),'"BR456","7"');assert.equal(await page.evaluate(()=>window.confirmed),0);assert.equal(await page.evaluate(()=>window.separatorClicks),0);for (const [mode, destination] of [['new','Create new spreadsheet'],['replace','Replace spreadsheet']]) {
 await page.goto('https://docs.google.com/spreadsheets/d/test-sheet/edit');await page.evaluate(source);
 await page.getByRole('button',{name:'Importar',exact:true}).click();
 await page.locator('input[type=file]').setInputFiles({name:'test.csv',mimeType:'text/csv',buffer:Buffer.from('id,value\n1,2')});
 await page.locator('input[value='+mode+']').check();await page.getByRole('button',{name:'Continuar',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('[data-spx-importer]').shadowRoot.querySelector('.status').classList.contains('ok'));
 assert.equal(await page.evaluate(()=>window.destination),destination);assert.equal(await page.evaluate(()=>window.confirmed),0);assert.equal(await page.evaluate(()=>window.separatorClicks),0);
}
assert.deepEqual(errors,[]);await browser.close();console.log('Chromium QA passed: actual compressed XLSX conversion, chosen sheet CSV, whole-sheet drop, iframe upload on drive.google.com, Google-style dropdown, selected insert destination, no automatic confirmation, no browser errors. Trusted Types enforced with policies disabled.');
})().catch(e=>{console.error(e);process.exit(1);});
