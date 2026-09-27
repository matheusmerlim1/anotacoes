'use strict';

/* =========================================================
   Anotações — bloco de notas estilo dontpad hospedado no GitHub Pages.
   Cada página vive em #/nome (ou #/pasta/nome) e é salva como
   notas/<nome>.md num repositório do GitHub, via API.
   Sem token configurado, funciona em modo local (localStorage).
   ========================================================= */

const PASTA = 'notas';
const ESPERA_SALVAR = 1200;   // ms sem digitar antes de salvar
const ESPERA_RETENTAR = 10000;
const MAX_RECENTES = 12;

const $ = (s) => document.querySelector(s);

const LS = {
  get(k, padrao = null) {
    try { const v = localStorage.getItem(k); return v === null ? padrao : JSON.parse(v); }
    catch { return padrao; }
  },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sem espaço ou bloqueado */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignora */ } },
  chaves(prefixo) {
    const out = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(prefixo)) out.push(k);
      }
    } catch { /* ignora */ }
    return out;
  },
};

let cfg = Object.assign({ owner: '', repo: '', branch: 'main', token: '' }, LS.get('anot:cfg', {}));

/* ---------- utilidades ---------- */

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// "Faculdade/Cálculo I" -> "faculdade/calculo-i"
function normalizarId(bruto) {
  let s = bruto || '';
  try { s = decodeURIComponent(s); } catch { /* mantém como veio */ }
  return s.split('/')
    .map((seg) => seg.normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().trim()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9._-]/g, '')
      .replace(/^\.+/, ''))
    .filter(Boolean)
    .join('/');
}

function b64enc(texto) {
  const bytes = new TextEncoder().encode(texto);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

function b64dec(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

let toastTimer;
function toast(msg, ms = 2600) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

function msgErro(e) {
  if (!navigator.onLine) return 'Sem conexão com a internet.';
  if (e && e.status === 401) return 'Token inválido ou expirado. Revise nas configurações (⚙).';
  if (e && e.status === 403) return 'Acesso negado pelo GitHub (permissão do token ou limite de uso).';
  if (e && e.status === 404) return 'Repositório não encontrado. Confira usuário, nome e se o token tem acesso a ele.';
  return (e && e.message) || 'Erro desconhecido.';
}

/* ---------- armazenamento ---------- */

class ErroConflito extends Error {}
class ErroApi extends Error {
  constructor(msg, status) { super(msg); this.status = status; }
}

const github = {
  local: false,
  url(p) { return `https://api.github.com/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}${p}`; },
  async req(p, opts = {}) {
    const headers = {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${cfg.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (opts.body) headers['Content-Type'] = 'application/json';
    const r = await fetch(this.url(p), { ...opts, headers, cache: 'no-store' });
    if (!r.ok) {
      let msg = r.statusText;
      try { msg = (await r.json()).message || msg; } catch { /* corpo vazio */ }
      throw new ErroApi(msg, r.status);
    }
    return r.status === 204 ? null : r.json();
  },
  caminho(id) { return `${PASTA}/${id}.md`.split('/').map(encodeURIComponent).join('/'); },
  async ler(id) {
    try {
      const d = await this.req(`/contents/${this.caminho(id)}?ref=${encodeURIComponent(cfg.branch)}`);
      return { texto: b64dec(d.content), sha: d.sha };
    } catch (e) {
      if (e.status === 404) {
        // 404 pode ser "arquivo não existe" (ok) ou "repo inacessível" (erro).
        await this.req('');
        return { texto: '', sha: null };
      }
      throw e;
    }
  },
  async salvar(id, texto, sha) {
    const body = { message: `${sha ? 'Atualiza' : 'Cria'} ${id}`, content: b64enc(texto), branch: cfg.branch };
    if (sha) body.sha = sha;
    try {
      const d = await this.req(`/contents/${this.caminho(id)}`, { method: 'PUT', body: JSON.stringify(body) });
      return d.content.sha;
    } catch (e) {
      if (e.status === 409 || (e.status === 422 && /sha/i.test(e.message))) throw new ErroConflito(e.message);
      throw e;
    }
  },
  async excluir(id, sha) {
    await this.req(`/contents/${this.caminho(id)}`, {
      method: 'DELETE',
      body: JSON.stringify({ message: `Exclui ${id}`, sha, branch: cfg.branch }),
    });
  },
  async listar() {
    try {
      const d = await this.req(`/git/trees/${encodeURIComponent(cfg.branch)}?recursive=1`);
      return d.tree
        .filter((t) => t.type === 'blob' && t.path.startsWith(PASTA + '/') && t.path.endsWith('.md'))
        .map((t) => ({ id: t.path.slice(PASTA.length + 1, -3), sha: t.sha }));
    } catch (e) {
      if (e.status === 404 || e.status === 409) return []; // repositório vazio / branch ainda não existe
      throw e;
    }
  },
  async lerConteudo(item) {
    const d = await this.req(`/git/blobs/${item.sha}`);
    return b64dec(d.content);
  },
};

const local = {
  local: true,
  chave(id) { return 'anot:local:' + id; },
  async ler(id) {
    const d = LS.get(this.chave(id));
    return d ? { texto: d.texto, sha: d.sha } : { texto: '', sha: null };
  },
  async salvar(id, texto, sha) {
    const atual = LS.get(this.chave(id));
    if ((atual ? atual.sha : null) !== (sha || null)) throw new ErroConflito('Alterada em outra aba.');
    const novo = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    LS.set(this.chave(id), { texto, sha: novo });
    return novo;
  },
  async excluir(id) { LS.del(this.chave(id)); },
  async listar() {
    return LS.chaves('anot:local:').map((k) => ({ id: k.slice('anot:local:'.length), sha: (LS.get(k) || {}).sha }));
  },
  async lerConteudo(item) { return (await this.ler(item.id)).texto; },
};

function conectado() { return Boolean(cfg.token && cfg.owner && cfg.repo); }
function backend() { return conectado() ? github : local; }

/* ---------- estado ---------- */

const est = {
  id: null,          // página aberta
  sha: null,         // versão remota que o editor tem como base
  remoto: '',        // texto salvo dessa versão
  carregando: false,
  salvando: null,    // Promise do salvamento em andamento
  pendente: false,   // houve digitação durante o salvamento
  erro: null,
  conflito: false,
  timer: null,
  lista: null,       // cache da lista de páginas
  seq: 0,            // descarta respostas de navegações antigas
  modo: LS.get('anot:modo', 'editar'),
};
const textos = new Map(); // conteúdo por sha, para a busca

const editor = $('#editor');
const leitura = $('#leitura');

const chaveRasc = (id) => 'anot:rasc:' + id;
const sujo = () => est.id !== null && !est.carregando && editor.value !== est.remoto;

/* ---------- rotas ---------- */

function mostrarTela(nome) {
  $('#tela-inicio').hidden = nome !== 'inicio';
  $('#tela-nota').hidden = nome !== 'nota';
}

function irPara(bruto) {
  const id = normalizarId(bruto);
  if (!id) return;
  location.hash = '#/' + id;
}

async function rotear() {
  const bruto = location.hash.replace(/^#\/?/, '');
  const id = normalizarId(bruto);
  if (bruto !== id) {
    let decod = bruto;
    try { decod = decodeURIComponent(bruto); } catch { /* ignora */ }
    if (decod !== id) history.replaceState(null, '', id ? '#/' + id : location.pathname + location.search);
  }
  if (id === est.id) return;
  await sairDaNota();
  if (id) abrirNota(id);
  else mostrarInicio();
}

async function sairDaNota() {
  clearTimeout(est.timer);
  if (est.salvando) await est.salvando.catch(() => {});
  if (sujo() && !est.conflito) await salvarAgora();
  esconderBanner();
}

/* ---------- página inicial ---------- */

async function mostrarInicio() {
  est.seq++;
  est.id = null;
  document.title = 'Anotações';
  mostrarTela('inicio');
  renderRecentes();
  $('#novo-input').value = '';
  if (matchMedia('(pointer: fine)').matches) $('#novo-input').focus();
  await renderLista();
}

function renderRecentes() {
  const rec = LS.get('anot:recentes', []);
  $('#bloco-recentes').hidden = rec.length === 0;
  $('#lista-recentes').innerHTML = rec.map((id) => `<li><a href="#/${esc(id)}">${esc(id)}</a></li>`).join('');
}

function registrarRecente(id) {
  const rec = LS.get('anot:recentes', []).filter((x) => x !== id);
  rec.unshift(id);
  LS.set('anot:recentes', rec.slice(0, MAX_RECENTES));
}

function removerRecente(id) {
  LS.set('anot:recentes', LS.get('anot:recentes', []).filter((x) => x !== id));
}

async function obterLista(forcar = false) {
  if (!est.lista || forcar) {
    const lista = await backend().listar();
    lista.sort((a, b) => a.id.localeCompare(b.id, 'pt-BR'));
    est.lista = lista;
  }
  return est.lista;
}

function nomeComPasta(id, prefixo = '') {
  const rel = id.slice(prefixo.length);
  const i = rel.lastIndexOf('/');
  return i < 0 ? esc(rel) : `<span class="pasta">${esc(rel.slice(0, i + 1))}</span>${esc(rel.slice(i + 1))}`;
}

function trecho(texto, termo) {
  const i = texto.toLowerCase().indexOf(termo);
  if (i < 0) return '';
  const ini = Math.max(0, i - 40);
  const antes = (ini > 0 ? '…' : '') + texto.slice(ini, i);
  const achado = texto.slice(i, i + termo.length);
  const depois = texto.slice(i + termo.length, i + termo.length + 80);
  return `<span class="trecho">${esc(antes)}<mark>${esc(achado)}</mark>${esc(depois)}</span>`
    .replace(/\n/g, ' ');
}

async function carregarTextos(lista) {
  const faltam = lista.filter((it) => !textos.has(it.sha));
  let i = 0;
  const trabalhador = async () => {
    while (i < faltam.length) {
      const it = faltam[i++];
      try { textos.set(it.sha, await backend().lerConteudo(it)); } catch { textos.set(it.sha, ''); }
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, faltam.length) }, trabalhador));
}

let seqLista = 0;
async function renderLista(forcar = false) {
  const minha = ++seqLista;
  const ul = $('#lista-notas');
  const msg = $('#lista-msg');
  msg.classList.remove('erro');

  let lista;
  try {
    if (!est.lista || forcar) { msg.hidden = false; msg.textContent = 'Carregando…'; }
    lista = await obterLista(forcar);
  } catch (e) {
    if (minha !== seqLista) return;
    ul.innerHTML = '';
    msg.hidden = false;
    msg.classList.add('erro');
    msg.textContent = 'Não foi possível carregar a lista: ' + msgErro(e);
    return;
  }
  if (minha !== seqLista) return;

  const termo = $('#filtro').value.trim().toLowerCase();
  const noConteudo = $('#filtro-conteudo').checked && termo !== '';
  if (noConteudo) {
    msg.hidden = false;
    msg.textContent = 'Buscando no conteúdo…';
    await carregarTextos(lista);
    if (minha !== seqLista) return;
  }

  const itens = [];
  for (const it of lista) {
    const noNome = !termo || it.id.includes(termo) || it.id.includes(normalizarId(termo));
    const texto = noConteudo ? (textos.get(it.sha) || '') : '';
    const noTexto = noConteudo && texto.toLowerCase().includes(termo);
    if (!noNome && !noTexto) continue;
    itens.push(`<li><a href="#/${esc(it.id)}">${nomeComPasta(it.id)}${noTexto ? trecho(texto, termo) : ''}</a></li>`);
  }

  ul.innerHTML = itens.join('');
  $('#contagem').textContent = lista.length ? `(${lista.length})` : '';
  msg.hidden = itens.length > 0;
  if (!lista.length) msg.textContent = 'Nenhuma anotação ainda. Digite um nome acima para criar a primeira.';
  else if (!itens.length) msg.textContent = 'Nada encontrado.';
}

/* ---------- página de anotação ---------- */

function renderMigalhas(id) {
  const partes = id.split('/');
  const html = ['<a href="#/">início</a>'];
  partes.forEach((p, i) => {
    const alvo = partes.slice(0, i + 1).join('/');
    html.push('<span class="sep">/</span>');
    html.push(i === partes.length - 1
      ? `<span class="atual">${esc(p)}</span>`
      : `<a href="#/${esc(alvo)}">${esc(p)}</a>`);
  });
  $('#migalhas').innerHTML = html.join('');
}

async function abrirNota(id) {
  const minha = ++est.seq;
  Object.assign(est, { id, sha: null, remoto: '', carregando: true, erro: null, conflito: false });
  document.title = `${id} · Anotações`;
  mostrarTela('nota');
  renderMigalhas(id);
  esconderBanner();
  editor.value = '';
  editor.disabled = true;
  aplicarModo();
  atualizarStatus();
  $('#bloco-sub').hidden = true;

  let r;
  try {
    r = await backend().ler(id);
  } catch (e) {
    if (minha !== est.seq) return;
    est.carregando = false;
    est.erro = msgErro(e);
    atualizarStatus();
    mostrarBanner(`Não foi possível abrir a página. ${est.erro}`, [
      ['Tentar de novo', () => { est.id = null; rotear(); }],
      ['Configurações', abrirConfig],
    ]);
    return;
  }
  if (minha !== est.seq) return;

  est.sha = r.sha;
  est.remoto = r.texto;
  est.carregando = false;
  if (r.sha) registrarRecente(id);
  editor.value = r.texto;
  editor.disabled = false;

  const rasc = LS.get(chaveRasc(id));
  if (rasc && rasc.texto !== r.texto) {
    if ((rasc.base || null) === (r.sha || null)) {
      // edição que não chegou a ser salva (aba fechada, sem internet…): retoma
      editor.value = rasc.texto;
      agendarSalvar(300);
    } else {
      mostrarBanner('Existe um rascunho não salvo desta página neste aparelho, mas ela foi alterada em outro lugar depois disso.', [
        ['Restaurar meu rascunho', () => { editor.value = rasc.texto; esconderBanner(); aoDigitar(); }],
        ['Copiar rascunho', () => copiar(rasc.texto, 'Rascunho copiado.')],
        ['Descartar rascunho', () => { LS.del(chaveRasc(id)); esconderBanner(); }],
      ]);
    }
  } else if (rasc) {
    LS.del(chaveRasc(id));
  }

  atualizarStatus();
  renderLeitura();
  if (est.modo === 'editar' && matchMedia('(pointer: fine)').matches) editor.focus();
  renderSubpaginas(id, minha);
}

async function renderSubpaginas(id, minha) {
  let lista;
  try { lista = await obterLista(); } catch { return; }
  if (minha !== est.seq) return;
  const prefixo = id + '/';
  const filhos = lista.filter((it) => it.id.startsWith(prefixo));
  $('#bloco-sub').hidden = filhos.length === 0;
  $('#lista-sub').innerHTML = filhos
    .map((it) => `<li><a href="#/${esc(it.id)}">${nomeComPasta(it.id, prefixo)}</a></li>`).join('');
}

function atualizarStatus() {
  const el = $('#status');
  let texto, tipo = 'ok';
  if (est.carregando) { texto = 'Carregando…'; tipo = 'vazio'; }
  else if (est.conflito) { texto = 'Conflito'; tipo = 'erro'; }
  else if (est.salvando) { texto = 'Salvando…'; tipo = 'pendente'; }
  else if (est.erro && est.id) { texto = sujo() ? 'Não salvo — tentando de novo' : 'Erro'; tipo = 'erro'; }
  else if (sujo()) { texto = 'Não salvo'; tipo = 'pendente'; }
  else if (!est.sha) { texto = 'Página nova'; tipo = 'vazio'; }
  else texto = backend().local ? 'Salvo neste navegador' : 'Salvo';
  el.textContent = texto;
  el.dataset.tipo = tipo;
  el.title = est.erro || '';
  $('#btn-excluir').disabled = !est.sha;
}

function aoDigitar() {
  if (!est.id || est.carregando) return;
  LS.set(chaveRasc(est.id), { texto: editor.value, base: est.sha, ts: Date.now() });
  atualizarStatus();
  agendarSalvar();
}

function agendarSalvar(ms = ESPERA_SALVAR) {
  clearTimeout(est.timer);
  est.timer = setTimeout(salvarAgora, ms);
}

function salvarAgora() {
  clearTimeout(est.timer);
  if (est.salvando) { est.pendente = true; return est.salvando; }
  if (!sujo() || est.conflito) { atualizarStatus(); return Promise.resolve(); }

  const id = est.id;
  const texto = editor.value;
  est.salvando = (async () => {
    try {
      const sha = await backend().salvar(id, texto, est.sha);
      est.erro = null;
      est.lista = null;
      const rasc = LS.get(chaveRasc(id));
      if (rasc && rasc.texto === texto) LS.del(chaveRasc(id));
      else if (rasc) LS.set(chaveRasc(id), { ...rasc, base: sha });
      registrarRecente(id);
      if (est.id === id) { est.sha = sha; est.remoto = texto; }
    } catch (e) {
      if (est.id !== id) return;
      if (e instanceof ErroConflito) {
        est.conflito = true;
        mostrarConflito();
      } else {
        est.erro = msgErro(e);
        toast('Não foi possível salvar: ' + est.erro, 4000);
        agendarSalvar(ESPERA_RETENTAR);
      }
    } finally {
      est.salvando = null;
      atualizarStatus();
      if (est.pendente) { est.pendente = false; if (est.id === id && sujo()) agendarSalvar(300); }
    }
  })();
  atualizarStatus();
  return est.salvando;
}

function mostrarConflito() {
  const id = est.id;
  mostrarBanner('Esta página foi alterada em outro lugar (outro aparelho ou aba) enquanto você editava.', [
    ['Manter a minha versão', async () => {
      try {
        const r = await backend().ler(id);
        if (est.id !== id) return;
        est.sha = r.sha;
        est.remoto = r.texto;
        est.conflito = false;
        esconderBanner();
        salvarAgora();
      } catch (e) { toast(msgErro(e), 4000); }
    }],
    ['Carregar a outra versão', async () => {
      try {
        const minha = editor.value;
        const r = await backend().ler(id);
        if (est.id !== id) return;
        await copiar(minha, 'Seu texto foi copiado para a área de transferência.');
        Object.assign(est, { sha: r.sha, remoto: r.texto, conflito: false, erro: null });
        editor.value = r.texto;
        LS.del(chaveRasc(id));
        esconderBanner();
        atualizarStatus();
        renderLeitura();
      } catch (e) { toast(msgErro(e), 4000); }
    }],
  ]);
}

function mostrarBanner(texto, botoes) {
  $('#banner-texto').textContent = texto;
  const box = $('#banner-botoes');
  box.innerHTML = '';
  for (const [rotulo, acao] of botoes) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = rotulo;
    b.addEventListener('click', acao);
    box.appendChild(b);
  }
  $('#banner').hidden = false;
}

function esconderBanner() { $('#banner').hidden = true; }

// Recarrega a página aberta se ela mudou em outro aparelho e não há edição local.
async function sincronizarSeLimpo() {
  if (!est.id || est.carregando || est.salvando || est.conflito || sujo()) return;
  const id = est.id;
  const minha = est.seq;
  try {
    const r = await backend().ler(id);
    if (minha !== est.seq || sujo() || est.salvando || r.sha === est.sha) return;
    Object.assign(est, { sha: r.sha, remoto: r.texto });
    editor.value = r.texto;
    renderLeitura();
    atualizarStatus();
    toast('Página atualizada com a versão mais recente.');
  } catch { /* tenta de novo na próxima vez */ }
}

/* ---------- modo leitura ---------- */

const RE_LINK = /\bhttps?:\/\/[^\s<>"']+|\bwww\.[^\s<>"']+|(?:^|(?<=\s))#\/[a-z0-9._/-]+/gi;

function linkificar(texto) {
  let out = '';
  let ult = 0;
  for (const m of texto.matchAll(RE_LINK)) {
    let url = m[0];
    const sobra = url.match(/[.,;:!?)\]]+$/);
    if (sobra && !(sobra[0].startsWith(')') && url.includes('('))) url = url.slice(0, -sobra[0].length);
    out += esc(texto.slice(ult, m.index));
    const href = url.startsWith('www.') ? 'https://' + url : url;
    const externo = !url.startsWith('#');
    out += `<a href="${esc(href)}"${externo ? ' target="_blank" rel="noopener noreferrer"' : ''}>${esc(url)}</a>`;
    ult = m.index + url.length;
  }
  return out + esc(texto.slice(ult));
}

function renderLeitura() {
  if (est.modo === 'ler') leitura.innerHTML = linkificar(editor.value);
}

function aplicarModo() {
  const ler = est.modo === 'ler';
  editor.hidden = ler;
  leitura.hidden = !ler;
  $('#btn-modo').textContent = ler ? 'Editar' : 'Ler';
  $('#btn-modo').title = ler ? 'Voltar a editar (Ctrl+E)' : 'Ver com links clicáveis (Ctrl+E)';
  renderLeitura();
}

function alternarModo() {
  est.modo = est.modo === 'ler' ? 'editar' : 'ler';
  LS.set('anot:modo', est.modo);
  aplicarModo();
  if (est.modo === 'editar') editor.focus();
}

/* ---------- ações ---------- */

async function copiar(texto, msg) {
  try { await navigator.clipboard.writeText(texto); toast(msg); }
  catch { toast('Não foi possível copiar automaticamente.'); }
}

async function excluirNota() {
  const id = est.id;
  if (!id || !est.sha) return;
  if (!confirm(`Excluir a página "${id}"?${backend().local ? '' : '\n\n(O conteúdo continua no histórico de commits do repositório.)'}`)) return;
  clearTimeout(est.timer);
  try {
    if (est.salvando) await est.salvando;
    await backend().excluir(id, est.sha);
  } catch (e) {
    toast('Não foi possível excluir: ' + msgErro(e), 4000);
    return;
  }
  LS.del(chaveRasc(id));
  removerRecente(id);
  est.lista = null;
  est.remoto = editor.value; // evita salvar de novo ao sair
  toast(`"${id}" excluída.`);
  location.hash = '#/';
}

/* ---------- configurações ---------- */

function abrirConfig() {
  $('#cfg-owner').value = cfg.owner;
  $('#cfg-repo').value = cfg.repo;
  $('#cfg-branch').value = cfg.branch || 'main';
  $('#cfg-token').value = cfg.token;
  $('#cfg-msg').hidden = true;
  $('#dlg-config').showModal();
}

function msgConfig(texto, erro = false) {
  const el = $('#cfg-msg');
  el.textContent = texto;
  el.classList.toggle('erro', erro);
  el.hidden = false;
}

async function salvarConfig(ev) {
  ev.preventDefault();
  const novo = {
    owner: $('#cfg-owner').value.trim(),
    repo: $('#cfg-repo').value.trim().replace(/\.git$/, ''),
    branch: $('#cfg-branch').value.trim() || 'main',
    token: $('#cfg-token').value.trim(),
  };
  if (!novo.owner || !novo.repo || !novo.token) { msgConfig('Preencha usuário, repositório e token.', true); return; }

  const botao = $('#cfg-salvar');
  botao.disabled = true;
  msgConfig('Testando conexão…');
  const anterior = cfg;
  cfg = novo;
  try {
    const repo = await github.req('');
    if (repo.permissions && !repo.permissions.push) throw new Error('O token só tem permissão de leitura. Dê "Contents: Read and write".');
  } catch (e) {
    cfg = anterior;
    msgConfig(e instanceof ErroApi ? msgErro(e) : e.message, true);
    botao.disabled = false;
    return;
  }
  botao.disabled = false;
  LS.set('anot:cfg', cfg);
  $('#dlg-config').close();
  await enviarLocaisParaGithub();
  recomecar();
  toast('Conectado ao GitHub.');
}

async function enviarLocaisParaGithub() {
  const locais = await local.listar();
  if (!locais.length) return;
  if (!confirm(`Há ${locais.length} anotação(ões) salvas só neste navegador. Enviar para o GitHub?`)) return;
  let ok = 0;
  const puladas = [];
  for (const it of locais) {
    try {
      const { texto } = await local.ler(it.id);
      const remoto = await github.ler(it.id);
      if (remoto.sha && remoto.texto !== texto) { puladas.push(it.id); continue; }
      if (!remoto.sha) await github.salvar(it.id, texto, null);
      await local.excluir(it.id);
      ok++;
    } catch { puladas.push(it.id); }
  }
  alert(`${ok} anotação(ões) enviada(s).` +
    (puladas.length ? `\n\nFicaram só no navegador (já existem no GitHub com outro conteúdo, ou deu erro):\n${puladas.join('\n')}` : ''));
}

function usarLocal() {
  if (!confirm('Desconectar do GitHub e usar só este navegador? As anotações do GitHub continuam lá.')) return;
  cfg = { ...cfg, token: '' };
  LS.set('anot:cfg', cfg);
  $('#dlg-config').close();
  recomecar();
}

function recomecar() {
  est.lista = null;
  textos.clear();
  $('#faixa-local').hidden = conectado();
  est.id = null;
  rotear();
}

/* ---------- eventos ---------- */

editor.addEventListener('input', aoDigitar);

editor.addEventListener('keydown', (e) => {
  if (e.key === 'Tab' && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
    e.preventDefault();
    if (!document.execCommand('insertText', false, '\t')) {
      editor.setRangeText('\t', editor.selectionStart, editor.selectionEnd, 'end');
      aoDigitar();
    }
  }
});

document.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (!mod || est.id === null) return;
  if (e.key.toLowerCase() === 's') { e.preventDefault(); salvarAgora(); }
  if (e.key.toLowerCase() === 'e') { e.preventDefault(); alternarModo(); }
});

$('#btn-modo').addEventListener('click', alternarModo);
$('#btn-link').addEventListener('click', () => copiar(location.href, 'Link copiado.'));
$('#btn-excluir').addEventListener('click', excluirNota);

$('#form-ir').addEventListener('submit', (e) => {
  e.preventDefault();
  irPara($('#ir-input').value);
  $('#ir-input').value = '';
  $('#ir-input').blur();
});

$('#form-novo').addEventListener('submit', (e) => {
  e.preventDefault();
  irPara($('#novo-input').value);
});

let filtroTimer;
$('#filtro').addEventListener('input', () => { clearTimeout(filtroTimer); filtroTimer = setTimeout(() => renderLista(), 200); });
$('#filtro-conteudo').addEventListener('change', () => renderLista());
$('#btn-atualizar').addEventListener('click', () => { textos.clear(); renderLista(true); });

$('#btn-config').addEventListener('click', abrirConfig);
document.querySelectorAll('[data-abrir-config]').forEach((b) => b.addEventListener('click', abrirConfig));
$('#form-config').addEventListener('submit', salvarConfig);
$('#cfg-local').addEventListener('click', usarLocal);
document.querySelector('#dlg-config [data-fechar]').addEventListener('click', () => $('#dlg-config').close());

window.addEventListener('hashchange', rotear);

window.addEventListener('beforeunload', (e) => {
  if (sujo() || est.salvando) { salvarAgora(); e.preventDefault(); e.returnValue = ''; }
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') { if (sujo()) salvarAgora(); }
  else sincronizarSeLimpo();
});

window.addEventListener('online', () => { if (sujo()) salvarAgora(); });

/* ---------- início ---------- */

$('#faixa-local').hidden = conectado();
rotear();
