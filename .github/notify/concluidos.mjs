// Avisa a equipa quando uma contagem ou uma checklist é concluída na app.
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";

const OWNER = "igorrobertorbr@gmail.com";
const APP_URL = "https://preps-collect-lx-factory.web.app/";
const TURNOS = { abertura: "a abertura", fecho: "o fecho" };
const AREAS = { bar: "do bar", sala: "da sala" };

initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
const db = getFirestore();
const estadoRef = db.doc("notifyState/concluidos");

const estadoSnap = await estadoRef.get();
const primeiraVez = !estadoSnap.exists;
const estado = estadoSnap.data() || { counts: {}, checks: {} };

const counts = (await db.collection("counts").orderBy("at", "desc").limit(10).get()).docs;
const checks = (await db.collection("checks").orderBy("day", "desc").limit(20).get()).docs;

const novoEstado = { counts: {}, checks: {} };
const eventos = [];
for (const d of counts) {
  novoEstado.counts[d.id] = true;
  if (!estado.counts?.[d.id]) eventos.push({ tipo: "contagem", by: d.data().by });
}
for (const d of checks) {
  const fin = d.data().fin;
  if (!fin?.at) continue;
  novoEstado.checks[d.id] = fin.at;
  if (estado.checks?.[d.id] !== fin.at) eventos.push({ tipo: "checklist", by: fin.by, a: d.data().a, t: d.id.split("_")[2], x: fin.x || 0 });
}

if (primeiraVez) {
  // o que já estava feito antes de ligar os avisos não gera notificação
  await estadoRef.set(novoEstado);
  console.log("Estado inicial guardado.");
} else if (!eventos.length) {
  console.log("Nada novo.");
} else {
  const nome = async uid => {
    if (!uid) return "Alguém";
    return (await db.doc("users/" + uid).get()).data()?.name || "Alguém";
  };
  const mensagens = [];
  for (const e of eventos) {
    const quem = await nome(e.by);
    if (e.tipo === "contagem") {
      mensagens.push({ title: "Contagem feita", body: `${quem} concluiu a contagem.` });
    } else {
      const falta = e.x ? ` ${e.x} ${e.x > 1 ? "itens não feitos" : "item não feito"}, com justificação.` : "";
      mensagens.push({ title: "Checklist concluída", body: `${quem} concluiu ${TURNOS[e.t] || e.t} ${AREAS[e.a] || e.a}.${falta}` });
    }
  }

  const membros = (await db.doc("config/team").get()).data()?.members || {};
  const permitidos = new Set([OWNER, ...Object.keys(membros).map(e => e.toLowerCase())]);
  const lista = [];
  for (const d of (await db.collection("tokens").get()).docs) {
    const { email, tokens } = d.data();
    if (!permitidos.has((email || "").toLowerCase())) continue;
    for (const token of tokens || []) lista.push({ token, ref: d.ref });
  }
  console.log(`${mensagens.length} aviso(s) para ${lista.length} aparelho(s).`);

  let enviados = 0, falhados = 0;
  for (const notification of mensagens) {
    if (!lista.length) break;
    const res = await getMessaging().sendEach(lista.map(({ token }) => ({
      token,
      notification,
      webpush: {
        notification: { icon: APP_URL + "icons/icon-192.png" },
        fcmOptions: { link: APP_URL }
      }
    })));
    enviados += res.successCount;
    falhados += res.failureCount;
    await Promise.all(res.responses.map(async (r, i) => {
      if (r.error) console.log("Falha:", r.error.code);
      if (r.error?.code === "messaging/registration-token-not-registered") {
        await lista[i].ref.update({ tokens: FieldValue.arrayRemove(lista[i].token) });
      }
    }));
  }
  console.log(`Enviados: ${enviados}. Falhados: ${falhados}.`);
  if (lista.length && !enviados) throw new Error("Nenhum aviso foi aceite; tenta de novo na próxima execução.");
  await estadoRef.set(novoEstado);
}
