(function () {
  'use strict';
  const KEY='spxOnHoldDailyV1';
  const PALETTE=['#60a5fa','#f59e0b','#34d399','#c084fc','#f87171','#22d3ee','#fbbf24','#a3e635','#f472b6'];
  const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const safeNumber=value=>Number.isFinite(Number(value))?Math.max(0,Number(value)):0;
  function aggregate(rows,key) {
    const map=new Map();
    rows.forEach(row=>{const name=String(key(row)||'Não informado');map.set(name,(map.get(name)||0)+1);});
    return [...map.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0],'pt-BR'));
  }
  function dayLabel(day) {
    const match=String(day).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return match?match[3]+'/'+match[2]+'/'+match[1]:day;
  }
  function dataSource() {
    let store={};
    try {store=JSON.parse(localStorage.getItem(KEY)||'{}')||{};}catch {}
    const days=Object.keys(store).filter(day=>/^\d{4}-\d{2}-\d{2}$/.test(day)&&store[day]&&typeof store[day]==='object').sort();
    return {store,days};
  }
  function barChart(rows,dates,type) {
    const series=aggregate(rows,row=>row[type]).slice(0,7).map(x=>x[0]);
    if(!series.length||!dates.length)return '<p class="muted">Sem registros para o período selecionado.</p>';
    const legend='<div class="legend">'+series.map((item,i)=>'<span><i style="background:'+PALETTE[i]+'"></i>'+esc(item)+'</span>').join('')+'</div>';
    const bars=dates.map(day=>{
      const matching=rows.filter(row=>row.date===day);
      const counts=series.map(item=>matching.filter(row=>String(row[type]||'Não informado')===item).length);
      const total=counts.reduce((n,x)=>n+x,0);
      return '<div class="day-bar"><time>'+esc(dayLabel(day))+'</time><div class="stack" title="'+total+' registros">'+counts.map((n,i)=>n?'<i title="'+esc(series[i])+': '+n+'" style="width:'+(n/Math.max(1,total)*100)+'%;background:'+PALETTE[i]+'"></i>':'').join('')+'</div><b>'+matching.length+'</b></div>';
    }).join('');
    return legend+bars+'<p class="hint">Distribuição por dia entre os grupos mais frequentes. O total à direita inclui todos os grupos.</p>';
  }
  function pieChart(rows) {
    const entries=aggregate(rows,row=>row.suggestion||'Não registrada');
    if(!entries.length)return '<p class="muted">Sem sugestões registradas.</p>';
    let position=0;
    const segments=entries.map(([label,n],i)=>{const previous=position;position+=n/rows.length*100;return PALETTE[i%PALETTE.length]+' '+previous+'% '+position+'%';});
    return '<div class="pie-layout"><div class="pie" style="background:conic-gradient('+segments.join(',')+')"><div>'+rows.length+'<small>pedidos/dia</small></div></div><div class="pie-legend">'+entries.map(([label,n],i)=>'<div><i style="background:'+PALETTE[i%PALETTE.length]+'"></i><span>'+esc(label)+'</span><b>'+n+'</b></div>').join('')+'</div></div>';
  }
  function panel(title,content,subtitle='') {
    return '<section class="panel"><h2>'+esc(title)+'</h2>'+(subtitle?'<p class="muted">'+esc(subtitle)+'</p>':'')+content+'</section>';
  }
  function topList(rows,kind) {
    if(kind==='drivers') {
      const groups=new Map();
      rows.forEach(row=>{const driver=row.driver||'Não informado';if(!groups.has(driver))groups.set(driver,{name:driver,orders:new Set(),records:0,attempts:0});const v=groups.get(driver);v.orders.add(row.id);v.records++;v.attempts+=safeNumber(row.attempts);});
      return [...groups.values()].sort((a,b)=>b.attempts-a.attempts||b.records-a.records).slice(0,10).map((v,i)=>
        '<div class="ranking"><span class="rank">'+(i+1)+'</span><div><b>'+esc(v.name)+'</b><small>'+v.orders.size+' pedidos distintos · '+v.records+' registros por data</small></div><strong>'+v.attempts+' tentativas*</strong></div>').join('')||'<p class="muted">Nenhum motorista registrado.</p>';
    }
    return [...rows].sort((a,b)=>b.attempts-a.attempts).slice(0,12).map((v,i)=>
      '<div class="ranking"><span class="rank">'+(i+1)+'</span><div><b>'+esc(v.id)+'</b><small>'+esc(dayLabel(v.date))+' · '+esc(v.reason)+' · '+esc(v.driver)+'</small></div><strong>'+v.attempts+' tentativas</strong></div>').join('')||'<p class="muted">Nenhum pedido registrado.</p>';
  }
  function openReport() {
    const tab=window.open('','_blank');
    if(!tab){alert('Permita pop-ups para abrir o relatório On Hold.');return;}
    const doc=tab.document;
    doc.open();
    doc.write('<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Relatório On Hold</title><style>'+
      '*{box-sizing:border-box}body{background:#0b1220;color:#f8fafc;font:13px/1.5 Inter,system-ui,Arial,sans-serif;margin:0}main{max-width:1320px;margin:auto;padding:28px 22px}h1{font-size:27px;margin:0}h2{font-size:16px;margin:0 0 12px}p{margin:5px 0 14px}.muted,.hint{color:#94a3b8;font-size:12px}.hint{font-size:10px;margin-top:13px}.heading{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap}.actions{display:flex;gap:9px}button{background:#23344d;color:white;border:1px solid #3b4a60;border-radius:9px;padding:10px 14px;cursor:pointer;font-weight:750}button:hover{background:#30445d}.dates{display:flex;gap:9px;flex-wrap:wrap;margin:14px 0 18px}.date-card{display:flex;align-items:center;gap:9px;padding:11px 14px;background:#152238;border:1px solid #334155;border-radius:11px;cursor:pointer;font-weight:700}.date-card:has(input:checked){border-color:#60a5fa;background:#1d3351}.date-card input{accent-color:#3b82f6;width:16px;height:16px;cursor:pointer}.date-card small{font-weight:500;color:#94a3b8}.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px}.metric,.panel{background:#152238;border:1px solid #334155;border-radius:14px;padding:18px}.metric span{display:block;font-size:11px;color:#94a3b8}.metric strong{display:block;font-size:27px;margin-top:6px}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:15px;margin-bottom:16px}.panel{min-width:0}.legend{display:flex;flex-wrap:wrap;gap:8px 14px;margin:14px 0}.legend span{display:flex;align-items:center;gap:5px;font-size:10px;color:#b5c8e3}.legend i,.pie-legend i{display:inline-block;width:9px;height:9px;border-radius:2px;flex-shrink:0}.day-bar{display:grid;grid-template-columns:88px minmax(0,1fr) 28px;gap:10px;align-items:center;margin:10px 0;font-size:11px}.day-bar time{color:#cbd5e1}.stack{height:19px;display:flex;overflow:hidden;border-radius:6px;background:#263952}.stack i{height:100%;display:block}.pie-layout{display:flex;align-items:center;gap:24px;flex-wrap:wrap}.pie{width:190px;height:190px;flex-shrink:0;border-radius:50%;display:grid;place-items:center}.pie>div{width:130px;height:130px;background:#152238;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-direction:column;font-size:27px;font-weight:900}.pie small{display:block;font-size:10px;font-weight:400;color:#94a3b8}.pie-legend{flex:1;min-width:200px}.pie-legend>div{display:flex;gap:8px;align-items:center;margin:9px 0}.pie-legend span{flex:1}.ranking{display:flex;align-items:center;gap:12px;border-bottom:1px solid #334155;padding:10px 0}.ranking>div{flex:1;min-width:0}.ranking small{display:block;color:#94a3b8;font-size:10px}.ranking strong{white-space:nowrap;color:#fbbf24;font-size:12px}.rank{display:grid;place-items:center;flex:0 0 25px;height:25px;border-radius:8px;color:#bfdbfe;background:#213956;font-weight:800}.table-wrap{max-height:500px;overflow:auto}table{border-collapse:collapse;width:100%;min-width:830px}th,td{padding:10px 12px;border-bottom:1px solid #334155;text-align:left}th{position:sticky;top:0;background:#152238;color:#94a3b8}input[type=search]{width:100%;max-width:370px;padding:10px;background:#0e1828;border:1px solid #40516a;color:white;border-radius:9px;margin-bottom:12px}footer{color:#94a3b8;font-size:11px;margin:18px 0}@media(max-width:850px){.grid{grid-template-columns:1fr}.metrics{grid-template-columns:repeat(2,1fr)}main{padding:15px}}@media print{body{background:white;color:#111827}.panel,.metric,.date-card{background:white;color:#111827;border-color:#94a3b8}.stack{print-color-adjust:exact}.pie{print-color-adjust:exact}.actions{display:none}}'+
      '</style></head><body><main><header class="heading"><div><h1>Relatório On Hold</h1><p class="muted">Registros deste navegador · Selecione as datas para analisar</p></div><div class="actions"><button id="export">Exportar CSV</button><button id="print">Imprimir / PDF</button></div></header><div id="dateFilters" class="dates"></div><div id="content"></div></main></body></html>');
    doc.close();
    const {store,days}=dataSource();
    const selected=new Set(days);
    const filters=doc.getElementById('dateFilters');
    if(!days.length)filters.innerHTML='<span class="muted">Nenhuma data armazenada neste navegador.</span>';
    else {
      filters.innerHTML='<label class="date-card"><input id="allDates" type="checkbox" checked>Todas as datas</label>'+
        days.map(day=>'<label class="date-card"><input type="checkbox" data-day="'+esc(day)+'" checked>'+esc(dayLabel(day))+' <small>'+Object.keys(store[day]||{}).length+' pedidos</small></label>').join('');
    }
    const allDates=doc.getElementById('allDates');
    if(allDates)allDates.onchange=()=>{
      const checked=allDates.checked;
      selected.clear();if(checked)days.forEach(day=>selected.add(day));
      doc.querySelectorAll('[data-day]').forEach(input=>{input.checked=checked;});
      render();
    };
    doc.querySelectorAll('[data-day]').forEach(input=>input.onchange=()=>{
      if(input.checked)selected.add(input.dataset.day);else selected.delete(input.dataset.day);
      allDates.checked=selected.size===days.length;
      allDates.indeterminate=selected.size>0&&selected.size<days.length;
      render();
    });
    function selectedRows(){
      return [...selected].sort().flatMap(date=>Object.values(store[date]||{}).filter(Boolean).map(row=>({
        id:String(row.id||''),date,reason:String(row.reason||'Não informado'),driver:String(row.driver||'Não informado'),
        attempts:safeNumber(row.attempts),checkedAt:safeNumber(row.checkedAt),
        suggestion:String(row.suggestion||'Não registrada'),attemptDetails:Array.isArray(row.attemptDetails)?row.attemptDetails:[]
      }))).filter(row=>row.attempts>0);
    }
    function render(){
      const rows=selectedRows();
      const unique=new Set(rows.map(x=>x.id));
      const attempts=rows.reduce((n,row)=>n+row.attempts,0);
      const selectedDays=days.filter(day=>selected.has(day));
      const reasons=aggregate(rows,row=>row.reason);
      const metrics='<div class="metrics"><div class="metric"><span>Registros de pedidos por data</span><strong>'+rows.length+'</strong></div><div class="metric"><span>Pedidos únicos</span><strong>'+unique.size+'</strong></div><div class="metric"><span>Tentativas informadas*</span><strong>'+attempts+'</strong></div><div class="metric"><span>Datas selecionadas</span><strong>'+selectedDays.length+'</strong></div></div>';
      const chart1=panel('Evolução diária por motivo',barChart(rows,selectedDays,'reason'),'Motivo mais recente de cada pedido em cada data.');
      const chart2=panel('Evolução diária por motorista',barChart(rows,selectedDays,'driver'),'Último motorista registrado de cada pedido.');
      const pie=panel('Sugestões operacionais',pieChart(rows),'Distribuição por recomendação registrada. Dados antigos podem estar sem classificação.');
      const reasonRank=panel('Motivos mais frequentes',reasons.map(([name,count])=>'<div class="ranking"><div><b>'+esc(name)+'</b></div><strong>'+count+' registros</strong></div>').join('')||'<p class="muted">Sem dados.</p>');
      const offenders=panel('Motoristas ofensores',topList(rows,'drivers'),'Ordenado pela soma de tentativas registradas nos pedidos associados.');
      const parcels=panel('Pedidos com mais tentativas',topList(rows,'orders'),'Pedidos repetidos em mais de uma data aparecem como registros separados.');
      const table=rows.slice().sort((a,b)=>b.checkedAt-a.checkedAt).map(row=>
        '<tr data-filter="'+esc([row.id,row.driver,row.reason,row.suggestion,row.date].join(' ').toLowerCase())+'"><td>'+esc(dayLabel(row.date))+'</td><td>'+esc(row.id)+'</td><td>'+esc(row.reason)+'</td><td>'+esc(row.driver)+'</td><td>'+row.attempts+'</td><td>'+esc(row.suggestion)+'</td><td>'+ (row.checkedAt?new Date(row.checkedAt).toLocaleString('pt-BR'):'-')+'</td></tr>').join('');
      const detail=panel('Pedidos consultados','<input id="searchRows" type="search" placeholder="Pesquisar BR, motorista, motivo ou sugestão"><div class="table-wrap"><table><thead><tr><th>Data</th><th>BR</th><th>Motivo</th><th>Motorista</th><th>Tentativas</th><th>Sugestão</th><th>Consulta</th></tr></thead><tbody>'+table+'</tbody></table></div>');
      doc.getElementById('content').innerHTML=metrics+'<div class="grid">'+chart1+chart2+'</div><div class="grid">'+pie+reasonRank+'</div><div class="grid">'+offenders+parcels+'</div>'+detail+
        '<footer>* A base é um retrato da consulta por pedido/data. Tentativas podem se repetir entre datas; a soma não representa necessariamente eventos únicos. A atribuição por motorista usa o último motorista salvo e não identifica todos os motoristas envolvidos. Sugestões passaram a ser armazenadas nas novas consultas. Os dados antigos ficam como “Não registrada”. Retenção local atual: até 7 dias.</footer>';
      const search=doc.getElementById('searchRows');
      search.oninput=()=>{const query=search.value.trim().toLowerCase();doc.querySelectorAll('[data-filter]').forEach(tr=>tr.hidden=!tr.dataset.filter.includes(query));};
    }
    doc.getElementById('export').onclick=()=>{
      const records=selectedRows();
      const csv=[['Data','BR','Motivo','Motorista','Tentativas','Sugestão','Consulta'],...records.map(row=>[row.date,row.id,row.reason,row.driver,row.attempts,row.suggestion,row.checkedAt?new Date(row.checkedAt).toLocaleString('pt-BR'):''])]
        .map(row=>row.map(x=>'"'+String(x).replace(/"/g,'""')+'"').join(';')).join('\r\n');
      const url=URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'}));
      const anchor=doc.createElement('a');anchor.href=url;anchor.download='onhold-periodo.csv';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    };
    doc.getElementById('print').onclick=()=>tab.print();
    render();
  }
  window.spxOnHoldReportOpen=openReport;
})();