(function () {
  'use strict';
  const STORAGE_KEY = 'pptLocalInteractivePlot.model.v1';
  const MAX_PERSIST_BYTES = 8 * 1024 * 1024;
  let renderer;
  let officeReady = false;

  const $ = id => document.getElementById(id);
  function setStatus(text, kind='') { const el=$('status'); el.textContent=text; el.dataset.kind=kind; }
  function showPlot(show){ $('plotShell').classList.toggle('hidden',!show); $('emptyState').classList.toggle('hidden',show); }

  function utf8Bytes(obj) { return new TextEncoder().encode(JSON.stringify(obj)).byteLength; }

  function persistModel(model) {
    if (!officeReady || !window.Office || !Office.context || !Office.context.document) {
      setStatus('Pré-visualização: não está dentro do PowerPoint; gráfico não será salvo no PPT.', 'warn');
      return;
    }
    const bytes = utf8Bytes(model);
    if (bytes > MAX_PERSIST_BYTES) {
      setStatus(`Gráfico carregado, mas não persistido: modelo seguro tem ${(bytes/1048576).toFixed(1)} MB (> 8 MB).`, 'warn');
      return;
    }
    try {
      Office.context.document.settings.set(STORAGE_KEY, model);
      Office.context.document.settings.saveAsync(result => {
        if (result.status === Office.AsyncResultStatus.Succeeded) setStatus('Gráfico salvo dentro deste objeto do PowerPoint.', 'ok');
        else setStatus(`Gráfico exibido, mas o PowerPoint não conseguiu persistir: ${result.error && result.error.message ? result.error.message : 'erro desconhecido'}`, 'warn');
      });
    } catch (e) { setStatus(`Gráfico exibido, mas não persistido: ${e.message}`, 'warn'); }
  }

  function restoreModel() {
    if (!officeReady || !window.Office || !Office.context || !Office.context.document) return false;
    try {
      const raw = Office.context.document.settings.get(STORAGE_KEY);
      if (!raw) return false;
      const model = window.SafePlotParser.validateSavedModel(raw);
      renderer.setModel(model); showPlot(true); setStatus('Gráfico restaurado do próprio PowerPoint.', 'ok'); return true;
    } catch (e) { setStatus(`Dados salvos inválidos: ${e.message}`, 'warn'); return false; }
  }

  function clearSaved() {
    renderer.clear(); showPlot(false);
    if (officeReady && window.Office && Office.context && Office.context.document) {
      try {
        Office.context.document.settings.remove(STORAGE_KEY);
        Office.context.document.settings.saveAsync(result => {
          setStatus(result.status === Office.AsyncResultStatus.Succeeded ? 'Gráfico removido deste objeto.' : 'Falha ao remover dados salvos.', result.status === Office.AsyncResultStatus.Succeeded ? 'ok':'warn');
        });
      } catch (e) { setStatus(`Falha ao remover: ${e.message}`, 'warn'); }
    } else setStatus('Pré-visualização limpa.');
  }

  async function openFile(file) {
    if (!file) return;
    if (!/\.html?$/i.test(file.name)) { setStatus('Escolha um arquivo .html ou .htm.', 'warn'); return; }
    if (file.size > window.SafePlotParser.MAX_FILE_BYTES) { setStatus('Arquivo maior que 25 MB.', 'warn'); return; }
    setStatus('Lendo arquivo local…');
    try {
      const text = await file.text();
      const model = window.SafePlotParser.parsePlotlyHtml(text);
      renderer.setModel(model); showPlot(true); persistModel(model);
    } catch (e) { showPlot(false); setStatus(`Arquivo rejeitado pelo modo seguro: ${e.message}`, 'error'); }
  }

  function bindUi(){
    renderer = new window.PlotRenderer($('plotCanvas'),$('tooltip'),$('legend'),$('zoomBox'));
    $('fileInput').addEventListener('change',e=>openFile(e.target.files && e.target.files[0]));
    $('zoomBtn').addEventListener('click',()=>{renderer.setMode('zoom');$('zoomBtn').classList.add('active');$('panBtn').classList.remove('active');});
    $('panBtn').addEventListener('click',()=>{renderer.setMode('pan');$('panBtn').classList.add('active');$('zoomBtn').classList.remove('active');});
    $('resetBtn').addEventListener('click',()=>renderer.reset());
    $('clearBtn').addEventListener('click',clearSaved);
  }

  document.addEventListener('DOMContentLoaded',()=>{
    bindUi(); showPlot(false);
    if (window.Office && typeof Office.onReady === 'function') {
      let settled=false;
      Office.onReady().then(()=>{settled=true;officeReady=true;if(!restoreModel())setStatus('Pronto. Escolha um HTML Plotly local.');}).catch(()=>{});
      setTimeout(()=>{if(!settled)setStatus('Modo de pré-visualização no navegador. No PowerPoint, os dados podem ser persistidos no arquivo.', 'warn');},2500);
    } else setStatus('Modo de pré-visualização no navegador.', 'warn');
  });
}());
