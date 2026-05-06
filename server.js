const express = require('express');
const multer  = require('multer');
const xml2js  = require('xml2js');

const app    = express();
const PORT   = 3000;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } });

let processos   = [];
let revistaMeta = {};
let carregado   = false;
let carregando  = false;

function parsearXML(buffer, callback) {
  carregando = true;
  carregado  = false;
  processos  = [];
  revistaMeta = {};

  xml2js.parseString(buffer.toString('utf8'), { explicitArray: true }, (err, resultado) => {
    if (err) { carregando = false; return callback(err); }

    const revista = resultado.revista;
    if (!revista) { carregando = false; return callback(new Error('Formato de XML inválido: elemento <revista> não encontrado')); }

    revistaMeta = { numero: revista.$.numero || '', data: revista.$.data || '' };

    processos = (revista.processo || []).map((p) => {
      const attrs = p.$ || {};
      const despachos = (p.despachos || []).flatMap((d) =>
        (d.despacho || []).map((dp) => ({ codigo: dp.$.codigo, nome: dp.$.nome }))
      );
      const titulares = (p.titulares || []).flatMap((t) =>
        (t.titular || []).map((tl) => ({
          nome: tl.$['nome-razao-social'] || '',
          pais: tl.$.pais || '',
          uf: tl.$.uf || '',
        }))
      );
      const marcaEl = p.marca ? p.marca[0] : null;
      const marca = marcaEl ? {
        nome: marcaEl.nome ? marcaEl.nome[0] : '',
        apresentacao: marcaEl.$ ? marcaEl.$.apresentacao || '' : '',
        natureza:     marcaEl.$ ? marcaEl.$.natureza     || '' : '',
      } : null;
      const classesNice = (p['lista-classe-nice'] || []).flatMap((ln) =>
        (ln['classe-nice'] || []).map((cn) => ({
          codigo:        cn.$.codigo,
          especificacao: cn.especificacao ? cn.especificacao[0].trim() : '',
          status:        cn.status ? cn.status[0] : '',
        }))
      );

      return {
        numero:        attrs.numero           || '',
        dataDeposito:  attrs['data-deposito'] || '',
        dataConcessao: attrs['data-concessao']|| '',
        dataVigencia:  attrs['data-vigencia'] || '',
        despachos,
        titulares,
        marca,
        classesNice,
        procurador: p.procurador ? p.procurador[0] : '',
      };
    });

    carregado  = true;
    carregando = false;
    console.log(`XML carregado: ${processos.length} processos`);
    callback(null);
  });
}

app.use(express.static(__dirname));

app.get('/status', (req, res) => {
  res.json({ carregado, carregando, total: processos.length, revista: revistaMeta });
});

app.post('/upload', upload.single('arquivo'), (req, res) => {
  if (!req.file) return res.status(400).json({ erro: 'Nenhum arquivo enviado.' });
  if (!req.file.originalname.toLowerCase().endsWith('.xml')) {
    return res.status(400).json({ erro: 'O arquivo deve ser um .xml' });
  }

  parsearXML(req.file.buffer, (err) => {
    if (err) return res.status(422).json({ erro: `Erro ao processar XML: ${err.message}` });
    res.json({ ok: true, total: processos.length, revista: revistaMeta });
  });
});

app.get('/buscar', (req, res) => {
  if (!carregado) return res.json({ carregado: false, resultados: [], total: 0 });

  const termo = (req.query.q || '').trim().toLowerCase();
  if (!termo) return res.json({ carregado: true, resultados: [], total: 0 });

  const resultados = processos.filter((p) => {
    return p.titulares.some((t) => t.nome.toLowerCase().includes(termo))
        || (p.marca && p.marca.nome.toLowerCase().includes(termo))
        || p.procurador.toLowerCase().includes(termo);
  });

  res.json({ carregado: true, resultados, total: resultados.length });
});

app.listen(PORT, () => console.log(`Servidor rodando em http://localhost:${PORT}`));
