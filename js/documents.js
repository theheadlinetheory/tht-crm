// ═══════════════════════════════════════════════════════════
// DOCUMENTS — Client document library (folders, upload, download)
// ═══════════════════════════════════════════════════════════
import { sbListFolders, sbCreateFolder, sbUpdateFolder, sbDeleteFolder,
         sbListDocuments, sbCreateDocument, sbDeleteDocument,
         sbUploadFile, sbDeleteFile, sbGetSignedUrl, showToast } from './api.js';
import { esc, str, uid, svgIcon } from './utils.js';
import { isAdmin, isClient, isEmployee, currentUser } from './auth.js';

// Per-client UI state: which folder tab is selected
const _selectedFolder = {}; // { clientId: folderId|'all'|'unfiled' }
// Cached data to avoid re-fetching on every render
const _foldersCache = {};   // { clientId: [folder, ...] }
const _docsCache = {};      // { clientId: [doc, ...] }

const ALLOWED_TYPES = [
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'application/pdf',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain', 'text/csv'
];
const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB

function isImage(mimeType) {
  return mimeType && mimeType.startsWith('image/');
}

function fileIcon(mimeType) {
  if (mimeType === 'application/pdf') return '\uD83D\uDCC4';
  if (mimeType && mimeType.includes('word')) return '\uD83D\uDCC3';
  if (mimeType && (mimeType.includes('sheet') || mimeType.includes('excel'))) return '\uD83D\uDCCA';
  if (mimeType === 'text/plain' || mimeType === 'text/csv') return '\uD83D\uDCC1';
  return '\uD83D\uDCCE';
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

async function loadDocumentsData(clientId) {
  const [folders, docs] = await Promise.all([
    sbListFolders(clientId),
    sbListDocuments(clientId)
  ]);
  _foldersCache[clientId] = folders || [];
  _docsCache[clientId] = docs || [];
  if (!_selectedFolder[clientId]) _selectedFolder[clientId] = 'all';
}

function getFilteredDocs(clientId) {
  const docs = _docsCache[clientId] || [];
  const sel = _selectedFolder[clientId] || 'all';
  if (sel === 'all') return docs;
  if (sel === 'unfiled') return docs.filter(d => !d.folder_id);
  return docs.filter(d => d.folder_id === sel);
}

export function renderDocumentsSection(client) {
  const clientId = client.id;
  const folders = _foldersCache[clientId] || [];
  const sel = _selectedFolder[clientId] || 'all';
  const docs = getFilteredDocs(clientId);
  const canUpload = isAdmin() || (isClient() && currentUser.clientName === client.name);
  const canDelete = isAdmin();
  const canDeleteOwn = isClient() && currentUser.clientName === client.name;
  const canManageFolders = isAdmin() || (isClient() && currentUser.clientName === client.name);

  let h = `<div style="margin-top:12px;padding:12px;background:#f8fafc;border:1px solid var(--border);border-radius:8px" id="docs-section-${esc(clientId)}">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
      <div style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px">${svgIcon('clipboard',10)} Documents</div>
      <div style="display:flex;gap:6px">
        ${canManageFolders ? `<button onclick="docNewFolder('${esc(clientId)}')" style="padding:3px 8px;font-size:10px;font-weight:600;border:1px solid var(--border);border-radius:5px;background:var(--card);color:var(--text);cursor:pointer;font-family:var(--font)">+ Folder</button>` : ''}
        ${canUpload ? `<label style="padding:3px 8px;font-size:10px;font-weight:600;border:1px solid #059669;border-radius:5px;background:#ecfdf5;color:#059669;cursor:pointer;font-family:var(--font)">
          Upload <input type="file" multiple accept="${ALLOWED_TYPES.join(',')}" onchange="docUploadFiles('${esc(clientId)}',this.files)" style="display:none">
        </label>` : ''}
      </div>
    </div>`;

  // Folder tabs
  const tabStyle = (active) => `padding:4px 10px;font-size:10px;font-weight:${active ? '700' : '500'};border-radius:5px;cursor:pointer;border:1px solid ${active ? '#059669' : 'var(--border)'};background:${active ? '#ecfdf5' : 'var(--card)'};color:${active ? '#059669' : 'var(--text-muted)'};font-family:var(--font)`;
  h += `<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:10px">`;
  h += `<button onclick="docSelectFolder('${esc(clientId)}','all')" style="${tabStyle(sel === 'all')}">All Files</button>`;
  for (const f of folders) {
    h += `<button onclick="docSelectFolder('${esc(clientId)}','${esc(f.id)}')" style="${tabStyle(sel === f.id)};position:relative">
      ${esc(f.name)}
      ${canManageFolders ? `<span onclick="event.stopPropagation();docFolderMenu('${esc(clientId)}','${esc(f.id)}','${esc(f.name)}')" style="margin-left:4px;font-size:8px;color:var(--text-muted);cursor:pointer">\u22EF</span>` : ''}
    </button>`;
  }
  h += `<button onclick="docSelectFolder('${esc(clientId)}','unfiled')" style="${tabStyle(sel === 'unfiled')}">Unfiled</button>`;
  h += `</div>`;

  // Drop zone
  if (canUpload) {
    h += `<div id="doc-dropzone-${esc(clientId)}" ondragover="event.preventDefault();this.style.borderColor='#059669';this.style.background='#ecfdf5'" ondragleave="this.style.borderColor='var(--border)';this.style.background='transparent'" ondrop="event.preventDefault();this.style.borderColor='var(--border)';this.style.background='transparent';docUploadFiles('${esc(clientId)}',event.dataTransfer.files)" onclick="this.querySelector('input[type=file]').click()"
      style="border:2px dashed var(--border);border-radius:8px;padding:${docs.length ? '8px' : '24px'};text-align:center;margin-bottom:8px;transition:all .15s;cursor:pointer">
      <input type="file" multiple accept="${ALLOWED_TYPES.join(',')}" onchange="docUploadFiles('${esc(clientId)}',this.files);this.value=''" onclick="event.stopPropagation()" style="display:none">
      ${docs.length ? '' : '<div style="font-size:11px;color:var(--text-muted)">Drag files here or click to upload</div>'}
    </div>`;
  }

  // File grid
  if (docs.length) {
    h += `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:8px">`;
    for (const doc of docs) {
      const isImg = isImage(doc.mime_type);
      const canDeleteThis = canDelete || (canDeleteOwn && doc.uploaded_by === currentUser.uid);
      h += `<div style="border:1px solid var(--border);border-radius:8px;overflow:hidden;background:var(--card);position:relative">
        <div onclick="${isImg ? `docPreviewImage('${esc(doc.file_path)}','${esc(doc.name)}')` : `docDownload('${esc(doc.file_path)}','${esc(doc.name)}')`}"
          style="height:80px;display:flex;align-items:center;justify-content:center;background:#f1f5f9;cursor:pointer;overflow:hidden">
          ${isImg
            ? `<img src="" data-doc-path="${esc(doc.file_path)}" class="doc-thumb" style="max-width:100%;max-height:100%;object-fit:cover" alt="${esc(doc.name)}">`
            : `<span style="font-size:28px">${fileIcon(doc.mime_type)}</span>`}
        </div>
        <div style="padding:6px 8px">
          <div style="font-size:10px;font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(doc.name)}">${esc(doc.name)}</div>
          <div style="font-size:9px;color:var(--text-muted);margin-top:2px">${formatSize(doc.file_size)} \u00B7 ${new Date(doc.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>
          <div style="display:flex;gap:4px;margin-top:4px">
            <button onclick="docDownload('${esc(doc.file_path)}','${esc(doc.name)}')" style="flex:1;padding:2px;font-size:9px;border:1px solid var(--border);border-radius:4px;background:var(--card);cursor:pointer;font-family:var(--font);color:var(--text)">Download</button>
            ${canDeleteThis ? `<button onclick="docDeleteFile('${esc(clientId)}','${esc(doc.id)}','${esc(doc.file_path)}','${esc(doc.name)}')" style="padding:2px 6px;font-size:9px;border:1px solid #fecaca;border-radius:4px;background:#fef2f2;cursor:pointer;font-family:var(--font);color:#dc2626">\u2715</button>` : ''}
          </div>
        </div>
      </div>`;
    }
    h += `</div>`;
  } else if (_docsCache[clientId]) {
    h += `<div style="text-align:center;padding:12px;font-size:11px;color:var(--text-muted)">No documents${sel !== 'all' ? ' in this folder' : ''}</div>`;
  } else {
    h += `<div style="text-align:center;padding:12px;font-size:11px;color:var(--text-muted)">Loading...</div>`;
  }

  h += `</div>`;
  return h;
}

// ─── Refresh the documents section in-place ───

async function refreshDocsSection(clientId) {
  await loadDocumentsData(clientId);
  const container = document.getElementById('docs-section-' + clientId);
  if (!container) return;
  const { state } = await import('./app.js');
  const client = state.clients.find(c => c.id === clientId);
  if (!client) return;
  const newHtml = renderDocumentsSection(client);
  const temp = document.createElement('div');
  temp.innerHTML = newHtml;
  container.replaceWith(temp.firstElementChild);
  loadThumbnails(clientId);
}

async function loadThumbnails(clientId) {
  const thumbs = document.querySelectorAll(`#docs-section-${clientId} .doc-thumb`);
  for (const img of thumbs) {
    const path = img.dataset.docPath;
    if (path && !img.src.startsWith('http')) {
      try {
        const url = await sbGetSignedUrl(path, 300);
        img.src = url;
      } catch (e) {
        img.style.display = 'none';
      }
    }
  }
}

// ─── Global handlers (attached to window) ───

export function initDocumentHandlers() {
  window.docSelectFolder = async (clientId, folderId) => {
    _selectedFolder[clientId] = folderId;
    await refreshDocsSection(clientId);
  };

  window.docNewFolder = async (clientId) => {
    const name = prompt('Folder name:');
    if (!name || !name.trim()) return;
    const folders = _foldersCache[clientId] || [];
    await sbCreateFolder(clientId, name.trim(), folders.length);
    showToast('Folder created', 'success');
    await refreshDocsSection(clientId);
  };

  window.docFolderMenu = async (clientId, folderId, folderName) => {
    const action = prompt(`Folder "${folderName}":\nType "rename" to rename or "delete" to delete`);
    if (!action) return;
    if (action.toLowerCase() === 'rename') {
      const newName = prompt('New folder name:', folderName);
      if (newName && newName.trim() && newName.trim() !== folderName) {
        await sbUpdateFolder(folderId, { name: newName.trim() });
        showToast('Folder renamed', 'success');
        await refreshDocsSection(clientId);
      }
    } else if (action.toLowerCase() === 'delete') {
      if (confirm(`Delete folder "${folderName}"? Files will be moved to Unfiled.`)) {
        await sbDeleteFolder(folderId);
        if (_selectedFolder[clientId] === folderId) _selectedFolder[clientId] = 'all';
        showToast('Folder deleted', 'success');
        await refreshDocsSection(clientId);
      }
    }
  };

  window.docUploadFiles = async (clientId, fileList) => {
    if (!fileList || !fileList.length) return;
    const folderId = _selectedFolder[clientId];
    const folderPath = (folderId && folderId !== 'all' && folderId !== 'unfiled') ? folderId : 'unfiled';

    let uploaded = 0;
    for (const file of fileList) {
      if (file.size > MAX_FILE_SIZE) {
        showToast(`${file.name} exceeds 25MB limit`, 'error');
        continue;
      }
      if (!ALLOWED_TYPES.includes(file.type)) {
        showToast(`${file.name}: file type not allowed`, 'error');
        continue;
      }
      const uniqueName = uid() + '-' + file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const storagePath = `${clientId}/${folderPath}/${uniqueName}`;
      try {
        await sbUploadFile(storagePath, file);
        await sbCreateDocument({
          client_id: clientId,
          folder_id: (folderId && folderId !== 'all' && folderId !== 'unfiled') ? folderId : null,
          name: file.name,
          file_path: storagePath,
          file_size: file.size,
          mime_type: file.type,
          uploaded_by: currentUser.uid || ''
        });
        uploaded++;
      } catch (e) {
        showToast(`Failed to upload ${file.name}`, 'error');
      }
    }
    if (uploaded > 0) {
      showToast(`${uploaded} file${uploaded > 1 ? 's' : ''} uploaded`, 'success');
      await refreshDocsSection(clientId);
    }
  };

  window.docDownload = async (filePath, fileName) => {
    try {
      const url = await sbGetSignedUrl(filePath, 60);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      showToast('Download failed', 'error');
    }
  };

  window.docDeleteFile = async (clientId, docId, filePath, fileName) => {
    if (!confirm(`Delete "${fileName}"?`)) return;
    try {
      await sbDeleteFile(filePath);
      await sbDeleteDocument(docId);
      showToast('File deleted', 'success');
      await refreshDocsSection(clientId);
    } catch (e) {
      showToast('Delete failed', 'error');
    }
  };

  window.docPreviewImage = async (filePath, fileName) => {
    try {
      const url = await sbGetSignedUrl(filePath, 300);
      const overlay = document.createElement('div');
      overlay.id = 'doc-lightbox';
      overlay.style.cssText = 'position:fixed;inset:0;z-index:100001;background:rgba(0,0,0,.85);display:flex;align-items:center;justify-content:center;cursor:pointer';
      overlay.onclick = () => overlay.remove();
      overlay.innerHTML = `
        <div style="max-width:90vw;max-height:90vh;position:relative" onclick="event.stopPropagation()">
          <img src="${esc(url)}" alt="${esc(fileName)}" style="max-width:90vw;max-height:85vh;border-radius:8px;box-shadow:0 8px 32px rgba(0,0,0,.5)">
          <div style="text-align:center;margin-top:8px;color:#fff;font-size:13px;font-weight:600">${esc(fileName)}</div>
          <button onclick="document.getElementById('doc-lightbox').remove()" style="position:absolute;top:-12px;right:-12px;width:28px;height:28px;border-radius:50%;border:none;background:#fff;color:#000;font-size:16px;cursor:pointer;font-weight:700;box-shadow:0 2px 8px rgba(0,0,0,.3)">\u00D7</button>
        </div>`;
      document.body.appendChild(overlay);
    } catch (e) {
      showToast('Preview failed', 'error');
    }
  };

  window.docLoadForClient = async (clientId) => {
    if (!_docsCache[clientId]) {
      await loadDocumentsData(clientId);
      await refreshDocsSection(clientId);
    }
  };
}
