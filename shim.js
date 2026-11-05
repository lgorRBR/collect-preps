/* Collect Preps — ligação ao Firebase.
   Substitui o window.claude.use(...) da versão Claude por Firebase (login Google + Firestore),
   para o resto da app funcionar sem alterações. */
(function () {
  const OWNER = "igorrobertorbr@gmail.com";
  firebase.initializeApp({
    apiKey: "AIzaSyAdojLWudrq036VReTt1SSyOl2gSYPhmzk",
    authDomain: "preps-collect-lx-factory.firebaseapp.com",
    projectId: "preps-collect-lx-factory",
    storageBucket: "preps-collect-lx-factory.firebasestorage.app",
    messagingSenderId: "669168836322",
    appId: "1:669168836322:web:33a9371890208becea08bb"
  });
  const auth = firebase.auth();
  const db = firebase.firestore();
  try { db.enablePersistence({ synchronizeTabs: true }).catch(() => {}); } catch (e) {}

  let me = null, role = null;            // role: "owner" | "admin" | "staff"
  let readyRes; const ready = new Promise(r => (readyRes = r));
  const profCache = {};

  /* ---------- ecrãs de entrada ---------- */
  const SEAL = '<span class="seal" style="width:92px;height:92px"><b style="font-size:24px">collect</b><span style="font-size:8.5px">LX FACTORY</span></span>';
  function gate(html) {
    let g = document.getElementById("gate");
    if (!g) { g = document.createElement("div"); g.id = "gate"; document.body.append(g); }
    g.innerHTML = `<div class="welcome" style="max-width:420px;margin:40px auto">${SEAL}${html}</div>`;
    g.style.cssText = "position:fixed;inset:0;z-index:30;background:var(--bg);overflow:auto;padding:16px";
  }
  const closeGate = () => { const g = document.getElementById("gate"); if (g) g.remove(); };

  function loginScreen(err) {
    gate(`<h2>Preps do bar</h2><p>Entre com a sua conta Google para usar a app da equipa.</p>
      <button class="wbtn main" id="g-in">Entrar com Google</button>
      ${err ? `<p style="font-size:13px">${err}</p>` : ""}`);
    document.getElementById("g-in").onclick = signIn;
  }
  async function signIn() {
    const p = new firebase.auth.GoogleAuthProvider();
    p.setCustomParameters({ prompt: "select_account" });
    try { await auth.signInWithPopup(p); }
    catch (e) {
      if (e && /popup|operation-not-supported/.test(e.code || "")) { try { await auth.signInWithRedirect(p); return; } catch (e2) { e = e2; } }
      if (e && e.code !== "auth/cancelled-popup-request" && e.code !== "auth/popup-closed-by-user") loginScreen("Não foi possível entrar. Tente outra vez.");
    }
  }
  auth.getRedirectResult().catch(() => {});

  function waitScreen(u) {
    gate(`<h2>Pedido enviado</h2><p>Olá ${esc(u.displayName || "")}. O gerente tem de aprovar o seu acesso (${esc(u.email)}). Esta página abre sozinha quando ele aprovar.</p>
      <button class="wbtn alt" id="g-out">Entrar com outra conta</button>`);
    document.getElementById("g-out").onclick = () => auth.signOut();
  }
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  let unsubAccess = null, started = false;
  auth.onAuthStateChanged(async u => {
    if (unsubAccess) { unsubAccess(); unsubAccess = null; }
    if (!u) { if (started) location.reload(); else loginScreen(); return; }
    const isOwner = (u.email || "").toLowerCase() === OWNER && u.emailVerified;
    // perfil público dentro da equipa (nome + foto), usado para mostrar quem fez cada contagem
    const prof = { name: u.displayName || u.email, photo: u.photoURL || "", email: (u.email || "").toLowerCase() };
    let r = isOwner ? "owner" : null;
    if (!r) {
      try { const t = await db.doc("config/team").get(); r = (t.data()?.members || {})[prof.email] || null; } catch (e) { r = null; }
    }
    if (!r) {
      await db.doc("access/" + u.uid).set({ ...prof, at: new Date().toISOString() }, { merge: true }).catch(() => {});
      waitScreen(u);
      unsubAccess = db.doc("access/" + u.uid).onSnapshot(s => { if (s.data()?.ok) location.reload(); }, () => {});
      return;
    }
    await db.doc("users/" + u.uid).set(prof, { merge: true }).catch(() => {});
    me = u; role = r; started = true;
    closeGate(); readyRes(); setupMenu();
  });

  /* ---------- o que a app pede com claude.use(...) ---------- */
  const userNS = {
    isOwner: async () => role === "owner",
    canEdit: async () => role === "owner" || role === "admin",
    can: async () => true,
    id: async () => me.uid,
    me: async () => ({ id: me.uid, name: me.displayName || me.email, avatarUrl: me.photoURL || "" }),
    profiles: async ids => {
      const out = {};
      await Promise.all([...new Set(ids || [])].filter(Boolean).map(async id => {
        if (!profCache[id]) {
          profCache[id] = db.doc("users/" + id).get().then(s => s.exists ? s.data() : null).catch(() => null);
        }
        const d = await profCache[id];
        out[id] = { id, name: d?.name || "", avatarUrl: d?.photo || "", guest: false };
      }));
      return out;
    }
  };
  const downloadsNS = {
    save: async ({ filename, data }) => {
      const blob = data instanceof Blob ? data : new Blob([data]);
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = filename;
      document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    }
  };
  window.claude = {
    use: async name => {
      await ready;
      if (name === "db") return db;
      if (name === "user") return userNS;
      if (name === "downloads") return downloadsNS;
      return null; // Google Drive (mcp) não existe nesta versão: a app oferece descarregar os ficheiros
    }
  };

  /* ---------- menu da conta (toque na foto, no topo) ---------- */
  function setupMenu() {
    const who = document.getElementById("who");
    if (!who || who.dataset.menu) return;
    who.dataset.menu = "1"; who.style.cursor = "pointer";
    who.addEventListener("click", () => role === "owner" ? teamPanel() : accountPanel());
  }
  function sheet(html) {
    const o = document.createElement("div"); o.className = "fin"; o.innerHTML = `<div class="fbox">${html}</div>`;
    o.addEventListener("click", e => { if (e.target === o || e.target.closest("[data-close]")) o.remove(); });
    document.body.append(o); return o;
  }
  function accountPanel() {
    const o = sheet(`<div class="fhd"><h2>${esc(me.displayName || "")}</h2><p>${esc(me.email)}</p></div>
      <div class="qact"><button class="btn sec grow" data-close>Fechar</button><button class="btn grow" id="m-out">Sair</button></div>`);
    o.querySelector("#m-out").onclick = () => auth.signOut();
  }
  async function teamPanel() {
    const o = sheet(`<div class="fhd"><h2>Equipa</h2><p>Quem pode usar a app</p></div><div id="tp" class="qs"><p class="note">A carregar…</p></div>
      <div class="qact"><button class="btn sec grow" data-close>Fechar</button><button class="btn sec grow" id="m-imp">Importar dados</button><button class="btn grow" id="m-out">Sair</button></div>`);
    o.querySelector("#m-out").onclick = () => auth.signOut();
    o.querySelector("#m-imp").onclick = () => importBackup();
    const paint = async () => {
      const [t, a] = await Promise.all([db.doc("config/team").get(), db.collection("access").get()]);
      const mem = t.data()?.members || {};
      const pend = a.docs.filter(d => !d.data().ok && !mem[d.data().email]);
      const roleTxt = r => r === "admin" ? "Gerente" : "Equipa";
      o.querySelector("#tp").innerHTML =
        (pend.length ? `<div class="gt">Pedidos de acesso</div>` + pend.map(d => `<div class="q"><p>${esc(d.data().name)}<br><small class="muted">${esc(d.data().email)}</small></p>
          <div class="yn"><button data-ok="${d.id}" data-r="staff">Aprovar · Equipa</button><button data-ok="${d.id}" data-r="admin">Aprovar · Gerente</button></div><button class="link" data-no="${d.id}">Recusar</button></div>`).join("") : `<p class="note">Sem pedidos novos. Quem abrir a app e entrar com o Gmail aparece aqui para aprovar.</p>`) +
        `<div class="gt">Com acesso</div>` + (Object.keys(mem).length ? Object.entries(mem).map(([e, r]) => `<div class="q"><p>${esc(e)} · <span class="muted">${roleTxt(r)}</span></p>
          <div class="yn"><button data-role="${esc(e)}" data-r="${r === "admin" ? "staff" : "admin"}">Mudar para ${r === "admin" ? "Equipa" : "Gerente"}</button><button data-rm="${esc(e)}">Tirar acesso</button></div></div>`).join("") : `<p class="note">Ainda ninguém além de si.</p>`);
      o.querySelectorAll("[data-ok]").forEach(b => b.onclick = async () => {
        const d = a.docs.find(x => x.id === b.dataset.ok).data();
        await db.doc("config/team").set({ members: { [d.email]: b.dataset.r } }, { merge: true });
        await db.doc("access/" + b.dataset.ok).set({ ok: true }, { merge: true }); paint();
      });
      o.querySelectorAll("[data-no]").forEach(b => b.onclick = async () => { await db.doc("access/" + b.dataset.no).delete(); paint(); });
      o.querySelectorAll("[data-role]").forEach(b => b.onclick = async () => { await db.doc("config/team").set({ members: { [b.dataset.role]: b.dataset.r } }, { merge: true }); paint(); });
      o.querySelectorAll("[data-rm]").forEach(b => b.onclick = async () => {
        if (!confirm("Tirar o acesso a " + b.dataset.rm + "?")) return;
        await db.doc("config/team").update(new firebase.firestore.FieldPath("members", b.dataset.rm), firebase.firestore.FieldValue.delete());
        paint();
      });
    };
    paint().catch(() => { o.querySelector("#tp").innerHTML = `<p class="note">Não foi possível carregar a equipa.</p>`; });
  }

  /* ---------- importar a cópia de segurança da versão Claude ---------- */
  function importBackup() {
    const inp = document.createElement("input"); inp.type = "file"; inp.accept = ".json,application/json";
    inp.onchange = async () => {
      const f = inp.files[0]; if (!f) return;
      let data; try { data = JSON.parse(await f.text()); } catch (e) { alert("Ficheiro inválido."); return; }
      const docs = data.docs || [];
      if (!docs.length || !confirm(`Importar ${docs.length} registos para a app? Os registos com o mesmo nome são substituídos.`)) return;
      let n = 0;
      for (let i = 0; i < docs.length; i += 400) {
        const b = db.batch();
        for (const d of docs.slice(i, i + 400)) { if (/^[a-z]+\/[^/]+$/.test(d.path)) { b.set(db.doc(d.path), d.data); n++; } }
        await b.commit();
      }
      for (const [id, name] of Object.entries(data.people || {})) await db.doc("users/" + id).set({ name, legacy: true }, { merge: true });
      alert(`${n} registos importados.`); location.reload();
    };
    inp.click();
  }
})();
