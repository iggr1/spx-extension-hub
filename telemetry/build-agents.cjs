const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const core = fs.readFileSync(path.join(root, 'shared/hub-usage.js'), 'utf8');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'catalog.json'), 'utf8'));
for (const id of ['spx-dock-flow-autoadd', 'assistente-de-devolucoes']) {
  const module = catalog.modules.find(item => item.id === id);
  const code = core + '\nSpxHubUsage.startSpxAgent(' + JSON.stringify(id) + ', ' + JSON.stringify(module.version) + ');\n';
  fs.writeFileSync(path.join(root, 'shared/usage-agents', id + '.js'), code);
}
