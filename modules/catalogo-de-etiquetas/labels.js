const LABELS = [
  ['Avaria tratada', 'landscape'],
  ['Aviso sobre endereço comercial', 'portrait'],
  ['Cuidado frágil', 'portrait'],
  ['Cuidado líquido', 'portrait'],
  ['Cuidado vidro', 'portrait'],
  ['Este lado para cima', 'portrait'],
  ['Fora de rota', 'square'],
  ['Fora de rota rural', 'portrait'],
  ['Liquidate', 'landscape'],
  ['Não contém vidro', 'portrait'],
  ['Pacote pesado', 'portrait'],
  ['Possível duplicado', 'landscape'],
  ['Prioridade', 'landscape'],
  ['Prioridade máxima', 'square'],
  ['Remark Avarias', 'landscape'],
  ['Solicitação de RTS', 'landscape']
].map(([name, orientation], index) => ({ id: `label-${index + 1}`, name, orientation }));

const LABEL_TYPES = {
  small: { key: 'small', labelType: 'Pequena', width: 70, height: 40 },
  large: { key: 'large', labelType: 'Grande', width: 100, height: 150 }
};

const $ = id => document.getElementById(id);
let activeLabel = null;
let activeLabelType = 'small';
let printing = false;
let toastTimer = null;

function toast(message) {
  const element = $('toast');
  if (!element) return;
  element.textContent = message;
  element.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove('show'), 3200);
}

function setProgress(percent, message) {
  $('labelBarFill').style.width = `${Math.max(0, Math.min(100, Number(percent) || 0))}%`;
  $('labelProgress').textContent = message || 'Selecione uma etiqueta para imprimir.';
}

function wrapText(context, text, maxWidth) {
  const words = text.split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (context.measureText(test).width <= maxWidth || !line) line = test;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  return lines;
}

function createArtwork(label, width = 900, height = 600) {
  const canvas = document.createElement('canvas');
  if (label.orientation === 'portrait') { canvas.width = height; canvas.height = width; }
  else if (label.orientation === 'square') { canvas.width = 760; canvas.height = 760; }
  else { canvas.width = width; canvas.height = height; }

  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  const pad = Math.round(Math.min(w, h) * .055);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#111';
  ctx.lineWidth = Math.max(8, Math.round(Math.min(w, h) * .018));
  ctx.strokeRect(pad / 2, pad / 2, w - pad, h - pad);

  const warning = /cuidado|avaria|fora de rota|pesado|duplicado|vidro/i.test(label.name);
  ctx.fillStyle = warning ? '#111' : '#ee4d2d';
  ctx.fillRect(pad, pad, w - pad * 2, Math.round(h * .17));
  ctx.fillStyle = '#fff';
  ctx.font = `700 ${Math.round(h * .055)}px Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('SPX', w / 2, pad + Math.round(h * .085));

  ctx.fillStyle = '#111';
  let fontSize = Math.round(Math.min(w, h) * .115);
  const maxWidth = w - pad * 2.2;
  let lines;
  do {
    ctx.font = `800 ${fontSize}px Arial, sans-serif`;
    lines = wrapText(ctx, label.name.toUpperCase(), maxWidth);
    if (lines.length <= 4) break;
    fontSize -= 4;
  } while (fontSize > 34);

  const lineHeight = fontSize * 1.08;
  const total = lines.length * lineHeight;
  let y = h * .58 - total / 2 + lineHeight / 2;
  for (const line of lines) {
    ctx.fillText(line, w / 2, y);
    y += lineHeight;
  }

  ctx.font = `600 ${Math.round(h * .035)}px Arial, sans-serif`;
  ctx.fillStyle = '#555';
  ctx.fillText('ETIQUETA OPERACIONAL', w / 2, h - pad * 1.25);
  return canvas;
}

function artworkUrl(label) {
  return createArtwork(label).toDataURL('image/jpeg', .92);
}

function renderLabels() {
  const list = $('labelList');
  list.replaceChildren();
  for (const label of LABELS) {
    const card = document.createElement('article');
    card.className = 'label-card';
    card.innerHTML = `
      <div class="label-preview"><img src="${artworkUrl(label)}" alt="${label.name}"></div>
      <div class="label-body">
        <h2>${label.name}</h2>
        <div class="label-meta">Etiqueta operacional</div>
        <div class="label-actions"><button class="primary" type="button">Imprimir</button></div>
      </div>`;
    card.querySelector('button').addEventListener('click', () => openModal(label));
    list.appendChild(card);
  }
  $('labelStatus').textContent = `${LABELS.length} etiquetas cadastradas`;
  setProgress(0, 'Selecione uma etiqueta para imprimir.');
}

function openModal(label) {
  activeLabel = label;
  setType('small');
  setQty(1);
  $('labelModalTitle').textContent = label.name;
  $('labelModalImage').src = artworkUrl(label);
  $('labelPrintModal').classList.add('show');
  $('labelPrintModal').setAttribute('aria-hidden', 'false');
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
  const value = Math.max(1, Math.min(999, Math.floor(Number($('labelQtyInput').value) || 1)));
  $('labelQtyInput').value = String(value);
  return value;
}

function setQty(value) {
  $('labelQtyInput').value = String(Math.max(1, Math.min(999, Math.floor(Number(value) || 1))));
}

function setLoading(loading) {
  printing = loading;
  ['labelModalPrint','labelModalCancel','labelModalClose','labelTypeSmall','labelTypeLarge','labelQtyInput','labelQtyMinus','labelQtyPlus']
    .forEach(id => { $(id).disabled = loading; });
  $('labelModalPrint').textContent = loading ? 'Imprimindo...' : 'Imprimir etiqueta';
}

function blobToArrayBuffer(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('Não foi possível gerar o PDF.'));
    reader.readAsArrayBuffer(blob);
  });
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Não foi possível converter a etiqueta.')), 'image/jpeg', .95));
}

function getAutoRotation(imageWidth, imageHeight, labelWidth, labelHeight) {
  return (imageWidth >= imageHeight) === (labelWidth >= labelHeight) ? 0 : 90;
}

function getDrawRect(imageWidth, imageHeight, pageWidth, pageHeight) {
  const imageRatio = imageWidth / imageHeight;
  const pageRatio = pageWidth / pageHeight;
  let width, height;
  if (imageRatio > pageRatio) { width = pageWidth; height = width / imageRatio; }
  else { height = pageHeight; width = height * imageRatio; }
  return { x: (pageWidth - width) / 2, y: (pageHeight - height) / 2, width, height };
}

async function renderToJpeg(label, settings) {
  const source = createArtwork(label, 1200, 800);
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
  const jpegBlob = await canvasToBlob(canvas);
  return { bytes: new Uint8Array(await blobToArrayBuffer(jpegBlob)), widthPx: canvasWidth, heightPx: canvasHeight };
}

function makePdfFromJpeg(jpeg, widthMm, heightMm) {
  const encoder = new TextEncoder();
  const chunks = []; const offsets = []; let length = 0;
  const addText = text => { const bytes = encoder.encode(text); chunks.push(bytes); length += bytes.length; };
  const addBytes = bytes => { chunks.push(bytes); length += bytes.length; };
  const object = (id, content) => { offsets[id] = length; addText(`${id} 0 obj\n${content}\nendobj\n`); };
  const widthPt = widthMm * 72 / 25.4; const heightPt = heightMm * 72 / 25.4;
  const content = `q\n${widthPt.toFixed(4)} 0 0 ${heightPt.toFixed(4)} 0 0 cm\n/Im0 Do\nQ`;
  addText('%PDF-1.4\n%âãÏÓ\n');
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, '<< /Type /Pages /Count 1 /Kids [3 0 R] >>');
  object(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${widthPt.toFixed(4)} ${heightPt.toFixed(4)}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
  offsets[4] = length;
  addText(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${jpeg.widthPx} /Height ${jpeg.heightPx} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.bytes.length} >>\nstream\n`);
  addBytes(jpeg.bytes); addText('\nendstream\nendobj\n');
  object(5, `<< /Length ${encoder.encode(content).length} >>\nstream\n${content}\nendstream`);
  const xrefOffset = length;
  addText('xref\n0 6\n0000000000 65535 f \n');
  for (let index = 1; index <= 5; index += 1) addText(String(offsets[index]).padStart(10, '0') + ' 00000 n \n');
  addText(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new Blob([bytes], { type: 'application/pdf' });
}

function sendToPrinter(pdfBlob, fileName, settings, quantity) {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('begin_page', '1'); form.append('end_page', '1');
    form.append('file', pdfBlob, fileName || 'etiqueta.pdf');
    form.append('height', String(settings.height)); form.append('orientation', '1');
    form.append('repeat_times', String(quantity)); form.append('scale', '100'); form.append('width', String(settings.width));
    const request = new XMLHttpRequest();
    request.open('POST', 'https://printproxy.wms.shopeemobile.com:21317/api/v2/print_pdf_file', true);
    request.onload = () => {
      if (request.status < 200 || request.status >= 300) return reject(new Error(`Serviço de impressão retornou HTTP ${request.status}.`));
      try { const response = JSON.parse(request.responseText || '{}'); if (response.retcode !== undefined && response.retcode !== 0) return reject(new Error(response.message || `Serviço de impressão retornou retcode ${response.retcode}.`)); } catch {}
      resolve(request.responseText);
    };
    request.onerror = () => reject(new Error('Falha ao enviar para a impressora. Verifique se o serviço de impressão SPX está aberto.'));
    request.send(form);
  });
}

async function printActiveLabel() {
  if (!activeLabel || printing) return;
  const settings = LABEL_TYPES[activeLabelType] || LABEL_TYPES.small;
  const quantity = getQty();
  try {
    setLoading(true); setProgress(15, `Preparando ${settings.labelType.toLowerCase()} ${settings.width}×${settings.height} mm...`);
    const jpeg = await renderToJpeg(activeLabel, settings);
    setProgress(48, 'Montando arquivo de impressão...');
    const pdf = makePdfFromJpeg(jpeg, settings.width, settings.height);
    setProgress(72, 'Enviando para a impressora...');
    await sendToPrinter(pdf, `${activeLabel.name}.pdf`, settings, quantity);
    setProgress(100, `Enviado para impressão: ${quantity}x • ${settings.labelType} ${settings.width}×${settings.height} mm.`);
    setLoading(false); closeModal(); toast('Etiqueta enviada para impressão.');
    setTimeout(() => setProgress(0, 'Selecione uma etiqueta para imprimir.'), 3500);
  } catch (error) {
    setProgress(0, error?.message || 'Erro ao imprimir etiqueta.'); toast(error?.message || 'Erro ao imprimir etiqueta.'); setLoading(false);
  }
}

$('reloadLabels').addEventListener('click', renderLabels);
$('labelModalClose').addEventListener('click', closeModal);
$('labelModalCancel').addEventListener('click', closeModal);
$('labelTypeSmall').addEventListener('click', () => setType('small'));
$('labelTypeLarge').addEventListener('click', () => setType('large'));
$('labelQtyMinus').addEventListener('click', () => setQty(getQty() - 1));
$('labelQtyPlus').addEventListener('click', () => setQty(getQty() + 1));
$('labelQtyInput').addEventListener('change', getQty);
$('labelModalPrint').addEventListener('click', printActiveLabel);
$('labelPrintModal').addEventListener('click', event => { if (event.target === $('labelPrintModal')) closeModal(); });
window.addEventListener('keydown', event => { if (event.key === 'Escape') closeModal(); });
renderLabels();
