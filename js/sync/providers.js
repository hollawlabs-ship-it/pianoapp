/* ===== 저장 드라이브 공급자 =====
   백업을 어디에 쓸지에 대한 얇은 추상화. 공급자는 파일 몇 개만 다룰 줄 알면 된다.
   공급자 인터페이스:
     id, label, note, available(), isConnected(), connect(), disconnect(),
     putFile(path, blob), getFile(path) -> Blob|null,
     listFiles(prefix) -> [{path,size,modified}], deleteFile(path), info()

   두 가지를 넣었다.
     dropbox : 앱 폴더(App folder)로 범위를 제한한 PKCE OAuth. 아이패드에서도 된다.
     folder  : 브라우저가 로컬 폴더에 직접 쓴다. 등록 절차가 아예 없고,
               드롭박스/원드라이브/구글드라이브 동기화 폴더를 고르면 그대로 클라우드로 간다. */
window.PA = window.PA || {};

(function (PA) {
  'use strict';

  /* ================= 공통 ================= */

  const b64url = (bytes) => btoa(String.fromCharCode.apply(null, bytes))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  async function sha256(text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return new Uint8Array(buf);
  }

  function randomVerifier() {
    const a = new Uint8Array(64);
    crypto.getRandomValues(a);
    return b64url(a);
  }

  /* ================= 1. 드롭박스 (앱 폴더 · PKCE) ================= */
  /* ID/PW는 절대 다루지 않는다. 앱 폴더 권한이므로 드롭박스의 나머지 파일에는
     접근할 수 없고, 앱 키(client_id)는 비밀이 아니라 공개 식별자다.
     PKCE라서 client_secret 없이 정적 호스팅에서 동작한다. */

  const DBX = {
    LS_KEY: 'pianoapp.dropbox',        // { refreshToken, appKey, account }
    VERIFIER: 'pianoapp.dbxVerifier',
    AUTH: 'https://www.dropbox.com/oauth2/authorize',
    TOKEN: 'https://api.dropboxapi.com/oauth2/token',
    RPC: 'https://api.dropboxapi.com/2',
    CONTENT: 'https://content.dropboxapi.com/2',
  };

  let dbxAccess = { token: null, expiresAt: 0 };

  const dbxSaved = () => {
    try { return JSON.parse(localStorage.getItem(DBX.LS_KEY) || 'null') || {}; }
    catch (e) { return {}; }
  };
  const dbxSave = (patch) => {
    const next = Object.assign(dbxSaved(), patch);
    try { localStorage.setItem(DBX.LS_KEY, JSON.stringify(next)); } catch (e) {}
    return next;
  };

  /** 리디렉트 주소는 드롭박스 앱 콘솔에 등록된 값과 정확히 같아야 한다.
      쿼리·해시를 뗀 현재 페이지 주소를 쓴다. */
  function dbxRedirectUri() {
    return location.origin + location.pathname;
  }

  async function dbxBeginAuth(appKey) {
    if (!appKey) throw new Error('드롭박스 앱 키가 필요합니다.');
    const verifier = randomVerifier();
    const challenge = b64url(await sha256(verifier));
    try {
      sessionStorage.setItem(DBX.VERIFIER, verifier);
      localStorage.setItem(DBX.VERIFIER, verifier);   // 모바일에서 탭이 갈릴 때 대비
    } catch (e) {}
    dbxSave({ appKey });

    const q = new URLSearchParams({
      client_id: appKey,
      response_type: 'code',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      token_access_type: 'offline',      // refresh_token 발급
      redirect_uri: dbxRedirectUri(),
    });
    location.href = `${DBX.AUTH}?${q.toString()}`;
  }

  /** 리디렉트로 돌아왔을 때 ?code= 를 토큰으로 교환한다. */
  async function dbxFinishAuth() {
    const params = new URLSearchParams(location.search);
    const code = params.get('code');
    if (!code) return false;

    const verifier = (() => {
      try { return sessionStorage.getItem(DBX.VERIFIER) || localStorage.getItem(DBX.VERIFIER); }
      catch (e) { return null; }
    })();
    const appKey = dbxSaved().appKey;

    // 주소창에서 code를 즉시 지운다 — 새로고침 시 재사용 시도를 막는다
    history.replaceState(null, '', location.origin + location.pathname + location.hash);

    if (!verifier || !appKey) throw new Error('인증 상태가 유실됐습니다. 다시 연결해 주세요.');

    const res = await fetch(DBX.TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        grant_type: 'authorization_code',
        client_id: appKey,
        code_verifier: verifier,
        redirect_uri: dbxRedirectUri(),
      }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data) {
      throw new Error('드롭박스 인증에 실패했습니다: ' + ((data && data.error_description) || res.status));
    }
    try { sessionStorage.removeItem(DBX.VERIFIER); localStorage.removeItem(DBX.VERIFIER); } catch (e) {}

    dbxAccess = { token: data.access_token, expiresAt: Date.now() + (data.expires_in || 14400) * 1000 };
    dbxSave({ refreshToken: data.refresh_token || null });
    try { await dbxRefreshAccount(); } catch (e) {}
    return true;
  }

  async function dbxToken() {
    if (dbxAccess.token && Date.now() < dbxAccess.expiresAt - 60000) return dbxAccess.token;
    const { refreshToken, appKey } = dbxSaved();
    if (!refreshToken || !appKey) throw new Error('드롭박스에 연결돼 있지 않습니다.');

    const res = await fetch(DBX.TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: appKey,
      }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || !data.access_token) {
      throw new Error('드롭박스 연결이 만료됐습니다. 다시 연결해 주세요.');
    }
    dbxAccess = { token: data.access_token, expiresAt: Date.now() + (data.expires_in || 14400) * 1000 };
    return dbxAccess.token;
  }

  async function dbxRpc(path, body) {
    const token = await dbxToken();
    const res = await fetch(DBX.RPC + path, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: body === undefined ? 'null' : JSON.stringify(body),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`드롭박스 오류 ${res.status}${t ? ': ' + t.slice(0, 160) : ''}`);
    }
    return res.json().catch(() => null);
  }

  async function dbxRefreshAccount() {
    const acc = await dbxRpc('/users/get_current_account');
    dbxSave({ account: (acc && acc.email) || (acc && acc.name && acc.name.display_name) || '연결됨' });
  }

  /** Dropbox-API-Arg 헤더는 ASCII만 허용한다. 비ASCII는 \uXXXX로 이스케이프. */
  const asciiArg = (obj) =>
    JSON.stringify(obj).replace(/[-￿]/g, (c) =>
      '\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4));

  const dropbox = {
    id: 'dropbox',
    label: '드롭박스',
    note: '앱 폴더에만 접근합니다. 다른 파일은 보이지 않습니다.',
    available: () => true,
    needsSetup: () => !dbxSaved().appKey,
    isConnected: () => !!dbxSaved().refreshToken,
    info: () => ({ account: dbxSaved().account || null, appKey: dbxSaved().appKey || null }),

    beginAuth: dbxBeginAuth,
    finishAuth: dbxFinishAuth,
    redirectUri: dbxRedirectUri,

    async connect(appKey) { await dbxBeginAuth(appKey); },

    disconnect() {
      dbxAccess = { token: null, expiresAt: 0 };
      const keep = dbxSaved().appKey;
      try { localStorage.removeItem(DBX.LS_KEY); } catch (e) {}
      if (keep) dbxSave({ appKey: keep });   // 앱 키는 남겨 재연결을 쉽게 한다
    },

    async putFile(path, blob) {
      const token = await dbxToken();
      const res = await fetch(DBX.CONTENT + '/files/upload', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/octet-stream',
          'Dropbox-API-Arg': asciiArg({ path: '/' + path, mode: 'overwrite', mute: true }),
        },
        body: blob,
      });
      if (!res.ok) {
        const t = await res.text().catch(() => '');
        throw new Error(`업로드 실패 (${res.status}) ${t.slice(0, 120)}`);
      }
      return res.json().catch(() => null);
    },

    async getFile(path) {
      const token = await dbxToken();
      const res = await fetch(DBX.CONTENT + '/files/download', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + token,
          'Dropbox-API-Arg': asciiArg({ path: '/' + path }),
        },
      });
      if (res.status === 409) return null;      // 파일 없음
      if (!res.ok) throw new Error(`내려받기 실패 (${res.status})`);
      return res.blob();
    },

    async listFiles(prefix) {
      const folder = prefix ? '/' + prefix.replace(/\/$/, '') : '';
      let out = [];
      let page;
      try {
        page = await dbxRpc('/files/list_folder', { path: folder, recursive: true });
      } catch (e) {
        if (/not_found/.test(e.message)) return [];
        throw e;
      }
      while (page) {
        (page.entries || []).forEach((e) => {
          if (e['.tag'] === 'file') {
            out.push({
              path: e.path_display.replace(/^\//, ''),
              size: e.size,
              modified: e.server_modified,
            });
          }
        });
        if (!page.has_more) break;
        page = await dbxRpc('/files/list_folder/continue', { cursor: page.cursor });
      }
      return out;
    },

    async deleteFile(path) {
      try { await dbxRpc('/files/delete_v2', { path: '/' + path }); }
      catch (e) { if (!/not_found/.test(e.message)) throw e; }
    },
  };

  /* ================= 2. 로컬 폴더 (File System Access) ================= */
  /* 사용자가 고른 폴더에 브라우저가 직접 쓴다. 등록도 토큰도 없다.
     드롭박스/원드라이브/구글드라이브 동기화 폴더를 고르면 그쪽 앱이 알아서 올려 준다.
     크롬·엣지에서만 동작한다(사파리·파이어폭스 미지원). */

  const HANDLE_DB = 'pianoapp-fs';
  const HANDLE_STORE = 'handles';

  function handleDb() {
    return new Promise((res, rej) => {
      const req = indexedDB.open(HANDLE_DB, 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains(HANDLE_STORE)) d.createObjectStore(HANDLE_STORE);
      };
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
  }
  async function saveHandle(h) {
    const d = await handleDb();
    return new Promise((res) => {
      const tx = d.transaction(HANDLE_STORE, 'readwrite');
      tx.objectStore(HANDLE_STORE).put(h, 'root');
      tx.oncomplete = () => res();
      tx.onerror = () => res();
    });
  }
  async function loadHandle() {
    try {
      const d = await handleDb();
      return await new Promise((res) => {
        const tx = d.transaction(HANDLE_STORE, 'readonly');
        const r = tx.objectStore(HANDLE_STORE).get('root');
        r.onsuccess = () => res(r.result || null);
        r.onerror = () => res(null);
      });
    } catch (e) { return null; }
  }
  async function clearHandle() {
    try {
      const d = await handleDb();
      const tx = d.transaction(HANDLE_STORE, 'readwrite');
      tx.objectStore(HANDLE_STORE).delete('root');
    } catch (e) {}
  }

  let rootHandle = null;

  /** 저장된 폴더 권한을 되살린다. 사용자 제스처 없이는 재요청이 막힐 수 있다. */
  async function ensureHandle(interactive) {
    if (!rootHandle) rootHandle = await loadHandle();
    if (!rootHandle) return null;
    const opts = { mode: 'readwrite' };
    let perm = await rootHandle.queryPermission(opts);
    if (perm === 'granted') return rootHandle;
    if (!interactive) return null;
    perm = await rootHandle.requestPermission(opts);
    return perm === 'granted' ? rootHandle : null;
  }

  /** 'recordings/xxx.webm' 같은 경로를 따라 내려가며 필요한 폴더를 만든다. */
  async function walk(root, path, create) {
    const parts = path.split('/').filter(Boolean);
    const name = parts.pop();
    let dir = root;
    for (const p of parts) {
      dir = await dir.getDirectoryHandle(p, { create: !!create });
    }
    return { dir, name };
  }

  const folder = {
    id: 'folder',
    label: '로컬 폴더',
    note: '드롭박스·원드라이브 동기화 폴더를 고르면 그대로 클라우드로 올라갑니다.',
    available: () => typeof window.showDirectoryPicker === 'function',
    needsSetup: () => false,
    isConnected: () => !!rootHandle,
    info: () => ({ account: rootHandle ? rootHandle.name : null }),

    async restore() {           // 앱 시작 시 조용히 권한 확인
      const h = await ensureHandle(false);
      return !!h;
    },

    async connect() {
      if (!folder.available()) throw new Error('이 브라우저는 폴더 연결을 지원하지 않습니다. 크롬이나 엣지를 쓰거나 드롭박스를 이용하세요.');
      const h = await window.showDirectoryPicker({ mode: 'readwrite', id: 'pianoapp-backup' });
      const perm = await h.requestPermission({ mode: 'readwrite' });
      if (perm !== 'granted') throw new Error('폴더 쓰기 권한이 필요합니다.');
      rootHandle = h;
      await saveHandle(h);
      return h.name;
    },

    async disconnect() {
      rootHandle = null;
      await clearHandle();
    },

    async putFile(path, blob) {
      const root = await ensureHandle(true);
      if (!root) throw new Error('폴더 권한이 없습니다. 다시 연결해 주세요.');
      const { dir, name } = await walk(root, path, true);
      const fh = await dir.getFileHandle(name, { create: true });
      const w = await fh.createWritable();
      await w.write(blob);
      await w.close();
    },

    async getFile(path) {
      const root = await ensureHandle(true);
      if (!root) throw new Error('폴더 권한이 없습니다. 다시 연결해 주세요.');
      try {
        const { dir, name } = await walk(root, path, false);
        const fh = await dir.getFileHandle(name, { create: false });
        return await fh.getFile();
      } catch (e) {
        return null;         // 없는 파일은 오류가 아니다
      }
    },

    async listFiles(prefix) {
      const root = await ensureHandle(true);
      if (!root) return [];
      const out = [];
      async function walkDir(dir, base) {
        for await (const [name, handle] of dir.entries()) {
          const p = base ? base + '/' + name : name;
          if (handle.kind === 'file') {
            const f = await handle.getFile();
            out.push({ path: p, size: f.size, modified: new Date(f.lastModified).toISOString() });
          } else {
            await walkDir(handle, p);
          }
        }
      }
      let start = root, base = '';
      if (prefix) {
        try {
          for (const p of prefix.split('/').filter(Boolean)) start = await start.getDirectoryHandle(p, { create: false });
          base = prefix.replace(/\/$/, '');
        } catch (e) { return []; }
      }
      await walkDir(start, base);
      return out;
    },

    async deleteFile(path) {
      const root = await ensureHandle(true);
      if (!root) return;
      try {
        const { dir, name } = await walk(root, path, false);
        await dir.removeEntry(name);
      } catch (e) { /* 없으면 그만 */ }
    },
  };

  PA.providers = { dropbox, folder, list: [dropbox, folder] };
})(window.PA);
