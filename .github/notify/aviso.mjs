// Envia uma mensagem escrita à mão para todos os aparelhos da equipa com avisos ativos.
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";

const OWNER = "igorrobertorbr@gmail.com";
const APP_URL = "https://preps-collect-lx-factory.web.app/";
const mensagem = (process.env.MENSAGEM || "").trim();
if (!mensagem) throw new Error("Falta a mensagem.");

initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
const db = getFirestore();

const membros = (await db.doc("config/team").get()).data()?.members || {};
const permitidos = new Set([OWNER, ...Object.keys(membros).map(e => e.toLowerCase())]);
const lista = [];
for (const d of (await db.collection("tokens").get()).docs) {
  const { email, tokens } = d.data();
  if (!permitidos.has((email || "").toLowerCase())) continue;
  for (const token of tokens || []) lista.push({ token, ref: d.ref });
}
console.log(`${lista.length} aparelho(s) registado(s).`);

if (lista.length) {
  const res = await getMessaging().sendEach(lista.map(({ token }) => ({
    token,
    notification: { title: "Collect Preps", body: mensagem },
    webpush: {
      notification: { icon: APP_URL + "icons/icon-192.png" },
      fcmOptions: { link: APP_URL }
    }
  })));
  console.log(`Enviados: ${res.successCount}. Falhados: ${res.failureCount}.`);
  await Promise.all(res.responses.map(async (r, i) => {
    const code = r.error?.code || "";
    if (r.error) console.log("Falha:", code);
    if (code === "messaging/registration-token-not-registered") {
      await lista[i].ref.update({ tokens: FieldValue.arrayRemove(lista[i].token) });
    }
  }));
  if (res.failureCount && !res.successCount) process.exitCode = 1;
}
