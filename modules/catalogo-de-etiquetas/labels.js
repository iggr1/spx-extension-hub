const LABELS = [
  { id: 'avaria-tratada', name: 'Avaria tratada', row: 1, column: 0 },
  { id: 'aviso-endereco-comercial', name: 'Aviso sobre endereço comercial', row: 1, column: 1 },
  { id: 'cuidado-fragil', name: 'Cuidado frágil', row: 1, column: 2 },
  { id: 'cuidado-liquido', name: 'Cuidado líquido', row: 1, column: 3 },
  { id: 'cuidado-vidro', name: 'Cuidado vidro', row: 2, column: 0 },
  { id: 'este-lado-para-cima', name: 'Este lado para cima', row: 2, column: 1 },
  { id: 'fora-de-rota-rural', name: 'Fora de rota rural', row: 2, column: 3 },
  { id: 'fora-de-rota', name: 'Fora de rota', row: 2, column: 2 },
  { id: 'liquidate', name: 'Liquidate', row: 3, column: 0 },
  { id: 'nao-contem-vidro', name: 'Não contém vidro', row: 3, column: 1 },
  { id: 'pacote-pesado', name: 'Pacote pesado', row: 3, column: 2 },
  { id: 'possivel-duplicado', name: 'Possível duplicado', row: 3, column: 3 },
  { id: 'prioridade-maxima', name: 'Prioridade máxima', row: 4, column: 1 },
  { id: 'prioridade', name: 'Prioridade', row: 4, column: 0 },
  { id: 'remark-avarias', name: 'Remark Avarias', row: 4, column: 2 },
  { id: 'solicitacao-rts', name: 'Solicitação de RTS', row: 4, column: 3 }
];

const LABEL_TYPES = {
  small: { label: 'Pequena', width: 70, height: 40 },
  large: { label: 'Grande', width: 100, height: 150 }
};

const ROW_CACHE = new Map();
const ARTWORK_CACHE = new Map();
const $ = id => document.getElementById(id);
let activeLabel = null;
let activeLabelType = 'small';
let printing = false;
let toastTimer = null;

function toast(message) {
  const el = $('toast');
  if (!el) return;
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

function setProgress(percent, message) {
  $('labelBarFill').style.width = `${Math.max(0, Math.min(100, Number(percent) || 0))}%`;
  $('labelProgress').textContent = message || 'Selecione uma etiqueta para imprimir.';
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Não foi possível carregar a arte da etiqueta.'));
    image.src = src;
  });
}

async function loadRow(row) {
  if (ROW_CACHE.has(row)) return ROW_CACHE.get(row);
  const promise = fetch(`assets/labels-row-${row}.b64?v=1.2.0`, { cache: 'force-cache' })
    .then(response => {
      if (!response.ok) throw new Error(`Falha ao carregar a folha ${row}.`);
      return response.text();
    })
    .then(base64 => {
      const clean = base64.replace(/\s+/g, '');
      const mime = clean.startsWith('UklGR') ? 'image/webp' : 'image/jpeg';
      return loadImage(`data:${mime};base64,${clean}`);
    });
  ROW_CACHE.set(row, promise);
  return promise;
}

async function getArtworkCanvas(label) {
  if (ARTWORK_CACHE.has(label.id)) return ARTWORK_CACHE.get(label.id);
  const promise = (async () => {
    const row = await loadRow(label.row);
    const cellWidth = Math.floor(row.naturalWidth / 4);
    const canvas = document.createElement('canvas');
    canvas.width = cellWidth;
    canvas.height = row.naturalHeight;
    canvas.getContext('2d').drawImage(row, label.column * cellWidth, 0, cellWidth, row.naturalHeight, 0, 0, cellWidth, row.naturalHeight);
    return canvas;
  })();
  ARTWORK_CACHE.set(label.id, promise);
  return promise;
}

async function artworkUrl(label) {
  return (await getArtworkCanvas(label)).toDataURL('image/png');
}

async function renderLabels() {
  const list = $('labelList');
  list.replaceChildren();
  $('labelStatus').textContent = 'Carregando 16 etiquetas...';
  setProgress(8, 'Carregando as artes do catálogo...');
  for (const label of LABELS) {
    const card = document.createElement('article');
    card.className = 'label-card';
    card.innerHTML = `<div class="label-preview"><div class="label-loading">Carregando...</div><img alt="${label.name}" hidden></div><div class="label-body"><h2>${label.name}</h2><div class="label-meta">Etiqueta original</div><div class="label-actions"><button class="primary" type="button">Imprimir</button></div></div>`;
    card.querySelector('button').addEventListener('click', () => openModal(label));
    list.appendChild(card);
    artworkUrl(label).then(url => {
      const image = card.querySelector('img');
      image.src = url;
      image.hidden = false;
      card.querySelector('.label-loading')?.remove();
    }).catch(error => {
      const loading = card.querySelector('.label-loading');
      if (loading) loading.textContent = 'Falha ao carregar';
      console.error(error);
    });
  }
  await Promise.allSettled(LABELS.map(getArtworkCanvas));
  $('labelStatus').textContent = `${LABELS.length} etiquetas carregadas`;
  setProgress(0, 'Selecione uma etiqueta para imprimir.');
}

async function openModal(label) {
  activeLabel = label;
  setType('small');
  setQty(1);
  $('labelModalTitle').textContent = label.name;
  $('labelModalImage').removeAttribute('src');
  $('labelPrintModal').classList.add('show');
  $('labelPrintModal').setAttribute('aria-hidden', 'false');
  try { $('labelModalImage').src = await artworkUrl(label); }
  catch (error) { toast(error.message || 'Não foi possível carregar a etiqueta.'); }
}

function closeModal() {
  if (printing) return;
  $('labelPrintModal').classList.remove('show');
  $('labelPrintModal').setAttribute('aria-hidden', 'true');
  activeLabel = null;
}

function setType(type) {
  activeLabelType = LABEL_TYPES[type] ? type : 'small';
  $('labelTypeSmall').classList.toggle('selected', activeLabelType === 'small');
  $('labelTypeLarge').classList.toggle('selected', activeLabelType === 'large');
}

function getQty() {
  const qty = Math.max(1, Math.min(999, Math.floor(Number($('labelQtyInput').value) || 1)));
  $('labelQtyInput').value = String(qty);
  return qty;
}

function setQty(value) {
  $('labelQtyInput').value = String(Math.max(1, Math.min(999, Math.floor(Number(value) || 1))));
}

function setLoading(loading) {
  printing = loading;
  ['labelModalPrint', 'labelModalCancel', 'labelModalClose', 'labelTypeSmall', 'labelTypeLarge', 'labelQtyInput', 'labelQtyMinus', 'labelQtyPlus'].forEach(id => { $(id).disabled = loading; });
  $('labelModalPrint').textContent = loading ? 'Preparando...' : 'Imprimir etiqueta';
}

function getAutoRotation(imageWidth, imageHeight, labelWidth, labelHeight) {
  return (imageWidth >= imageHeight) === (labelWidth >= labelHeight) ? 0 : 90;
}

function getDrawRect(imageWidth, imageHeight, pageWidth, pageHeight) {
  const imageRatio = imageWidth / imageHeight;
  const pageRatio = pageWidth / pageHeight;
  let width;
  let height;
  if (imageRatio > pageRatio) { width = pageWidth; height = width / imageRatio; }
  else { height = pageHeight; width = height * imageRatio; }
  return { x: (pageWidth - width) / 2, y: (pageHeight - height) / 2, width, height };
}

async function renderForPrint(label, settings) {
  const source = await getArtworkCanvas(label);
  const pxPerMm = 203 / 25.4;
  const canvasWidth = Math.max(1, Math.round(settings.width * pxPerMm));
  const canvasHeight = Math.max(1, Math.round(settings.height * pxPerMm));
  const rotation = getAutoRotation(source.width, source.height, settings.width, settings.height);
  const rotated = rotation === 90;
  const sourceWidth = rotated ? source.height : source.width;
  const sourceHeight = rotated ? source.width : source.height;
  const rect = getDrawRect(sourceWidth, sourceHeight, canvasWidth, canvasHeight);
  const canvas = document.createElement('canvas');
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  const context = canvas.getContext('2d');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvasWidth, canvasHeight);
  if (rotation) {
    context.save();
    context.translate(rect.x + rect.width / 2, rect.y + rect.height / 2);
    context.rotate(Math.PI / 2);
    context.drawImage(source, -rect.height / 2, -rect.width / 2, rect.height, rect.width);
    context.restore();
  } else context.drawImage(source, rect.x, rect.y, rect.width, rect.height);
  return canvas.toDataURL('image/png');
}

function printWithWindowsDialog(printWindow, imageUrl, label, settings, quantity) {
  const safeTitle = label.name.replace(/[<>]/g, '');
  const pages = Array.from({ length: quantity }, (_, index) => `<div class="page${index === quantity - 1 ? ' last' : ''}"><img src="${imageUrl}" alt="${safeTitle}"></div>`).join('');
  printWindow.document.open();
  printWindow.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${safeTitle}</title><style>@page{size:${settings.width}mm ${settings.height}mm;margin:0}html,body{margin:0;padding:0;background:#fff}.page{width:${settings.width}mm;height:${settings.height}mm;display:flex;align-items:center;justify-content:center;page-break-after:always;break-after:page;overflow:hidden}.page.last{page-break-after:auto;break-after:auto}.page img{display:block;width:100%;height:100%;object-fit:contain}</style></head><body>${pages}<script>window.addEventListener('load',()=>setTimeout(()=>{window.focus();window.print();},180));<\/script></body></html>`);
  printWindow.document.close();
}

async function printActiveLabel() {
  if (!activeLabel || printing) return;
  const settings = LABEL_TYPES[activeLabelType] || LABEL_TYPES.small;
  const quantity = getQty();
  const printWindow = window.open('', '_blank', 'width=960,height=720');
  if (!printWindow) { toast('Permita pop-ups para abrir a impressão do Windows.'); return; }
  printWindow.document.write('<!doctype html><title>Preparando impressão...</title><body style="font-family:Segoe UI,Arial,sans-serif;padding:28px">Preparando etiqueta...</body>');
  try {
    setLoading(true);
    setProgress(20, `Preparando ${settings.label.toLowerCase()} ${settings.width}×${settings.height} mm...`);
    const imageUrl = await renderForPrint(activeLabel, settings);
    setProgress(75, 'Abrindo a impressão padrão do Windows...');
    printWithWindowsDialog(printWindow, imageUrl, activeLabel, settings, quantity);
    setProgress(100, `${quantity} cópia(s) preparada(s) em ${settings.width}×${settings.height} mm.`);
    setLoading(false);
    closeModal();
    toast('Janela de impressão aberta.');
    setTimeout(() => setProgress(0, 'Selecione uma etiqueta para imprimir.'), 3500);
  } catch (error) {
    try { printWindow.close(); } catch {}
    setProgress(0, error?.message || 'Erro ao preparar a impressão.');
    toast(error?.message || 'Erro ao preparar a impressão.');
    setLoading(false);
  }
}

$('reloadLabels').addEventListener('click', () => { ARTWORK_CACHE.clear(); ROW_CACHE.clear(); renderLabels(); });
$('labelModalClose').addEventListener('click', closeModal);
$('labelModalCancel').addEventListener('click', closeModal);
$('labelTypeSmall').addEventListener('click', () => setType('small'));
$('labelTypeLarge').addEventListener('click', () => setType('large'));
$('labelQtyMinus').addEventListener('click', () => setQty(getQty() - 1));
$('labelQtyPlus').addEventListener('click', () => setQty(getQty() + 1));
$('labelQtyInput').addEventListener('change', getQty);
$('labelModalPrint').addEventListener('click', printActiveLabel);
$('labelPrintModal').addEventListener('click', event => { if (event.target === $('labelPrintModal')) closeModal(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeModal(); });
renderLabels();
