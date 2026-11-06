// Lembrete diário da contagem: corre no GitHub Actions e avisa os telemóveis da equipa.
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";

const HORA = 16; // hora de Lisboa a partir da qual se avisa
const OWNER = "igorrobertorbr@gmail.com";
const APP_URL = "https://preps-collect-lx-factory.web.app/";
const TESTE = process.env.TESTE === "true";

initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
const db = getFirestore();

const lisboa = (d, opts) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Lisbon", ...opts }).format(d);
const dia = d => lisboa(d, { year: "numeric", month: "2-digit", day: "2-digit" });
const agora = new Date();
const hoje = dia(agora);
const hora = Number(lisboa(agora, { hour: "2-digit", hour12: false }));

const estadoRef = db.doc("notifyState/contagem");

async function deveAvisar() {
  if (TESTE) return true;
  if (hora < HORA) { console.log(`Ainda são ${hora}h em Lisboa.`); return false; }
  if ((await estadoRef.get()).data()?.dia === hoje) { console.log("O aviso de hoje já foi enviado."); return false; }
  const ultima = await db.collection("counts").orderBy("at", "desc").limit(1).get();
  const at = ultima.docs[0]?.data().at;
  if (at && dia(new Date(at)) === hoje) { console.log("A contagem de hoje já foi feita."); return false; }
  return true;
}

async function destinatarios() {
  const membros = (await db.doc("config/team").get()).data()?.members || {};
  const permitidos = new Set([OWNER, ...Object.keys(membros).map(e => e.toLowerCase())]);
  const lista = [];
  for (const d of (await db.collection("tokens").get()).docs) {
    const { email, tokens } = d.data();
    if (!permitidos.has((email || "").toLowerCase())) continue;
    for (const token of tokens || []) lista.push({ token, ref: d.ref });
  }
  return lista;
}

if (await deveAvisar()) {
  const lista = await destinatarios();
  console.log(`${lista.length} aparelho(s) registado(s).`);
  if (lista.length) {
    const res = await getMessaging().sendEach(lista.map(({ token }) => ({
      token,
      notification: TESTE
        ? { title: "Collect Preps", body: "Aviso de teste: os avisos estão a funcionar." }
        : { title: "Contagem por fazer", body: "Ainda não há contagem de hoje. Conte o stock e o bar antes de produzir." },
      webpush: {
        notification: { icon: APP_URL + "icons/icon-192.png" },
        fcmOptions: { link: APP_URL }
      }
    })));
    console.log(`Enviados: ${res.successCount}. Falhados: ${res.failureCount}.`);
    // aparelhos que já não existem saem da lista
    const { FieldValue } = await import("firebase-admin/firestore");
    await Promise.all(res.responses.map(async (r, i) => {
      const code = r.error?.code || "";
      if (r.error) console.log("Falha:", code);
      if (code === "messaging/registration-token-not-registered") {
        await lista[i].ref.update({ tokens: FieldValue.arrayRemove(lista[i].token) });
      }
    }));
    if (!TESTE && res.successCount) await estadoRef.set({ dia: hoje, at: agora.toISOString() });
    if (res.failureCount && !res.successCount) process.exitCode = 1;
  }
}
