import { useEffect, useState, type FormEvent } from "react";
import "./App.css";
import {
  getDeviceId,
  registerServiceWorker,
  subscribePush,
  testPush,
  unsubscribePush,
} from "./pushClient";

type Meta = {
  sprint?: number;
  sources?: number;
  articles?: number;
  alertRules?: number;
  alertWebhookConfigured?: boolean;
  pushConfigured?: boolean;
  lastFetchAt?: string | null;
};

type AlertRule = {
  id: number;
  name: string;
  keywords: string[];
  uf: string | null;
  active: boolean;
};

type AlertEvent = {
  id: number;
  ruleName: string;
  matchedOn: string;
  status: string;
  title: string;
  url: string;
  source: string | null;
  createdAt: string;
};

type DigestItem = {
  id: number;
  title: string;
  url: string;
  source: string | null;
  theme?: string | null;
  publishedAt: string | null;
  fetchedAt: string | null;
};

type Digest = {
  date: string;
  today?: string;
  yesterday?: string;
  label?: string;
  count?: number;
  bySource?: { name: string; count: number }[];
  byTheme?: { name: string; count: number }[];
  items: DigestItem[];
  note?: string | null;
};

const PREF_THEMES = [
  "política",
  "economia",
  "segurança",
  "saúde",
  "educação",
  "meio ambiente",
];

const THEME_CHIPS = [
  "todos",
  ...PREF_THEMES,
  "outros",
];

function fmtTime(iso: string | null | undefined) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleTimeString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

function fmtWhen(iso: string | null | undefined) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export default function App() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [digest, setDigest] = useState<Digest | null>(null);
  const [anchors, setAnchors] = useState<{ today: string; yesterday: string } | null>(null);
  const [day, setDay] = useState<"today" | "yesterday">("today");
  const [theme, setTheme] = useState("todos");
  const [q, setQ] = useState("");
  const [qDraft, setQDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [events, setEvents] = useState<AlertEvent[]>([]);
  const [ruleName, setRuleName] = useState("");
  const [ruleKeywords, setRuleKeywords] = useState("");
  const [prefThemes, setPrefThemes] = useState<string[]>(["política"]);
  const [prefPeople, setPrefPeople] = useState("");
  const [pushOn, setPushOn] = useState(false);
  const [installEvt, setInstallEvt] = useState<{ prompt: () => Promise<void> } | null>(null);

  const loadMeta = () => fetch("/api/meta").then((r) => r.json()).then(setMeta);

  const loadAlerts = async () => {
    const [r, e] = await Promise.all([
      fetch("/api/alerts/rules").then((x) => x.json()),
      fetch("/api/alerts/events?limit=12").then((x) => x.json()),
    ]);
    setRules(Array.isArray(r) ? r.filter((x: AlertRule) => x.active) : []);
    setEvents(Array.isArray(e) ? e : []);
  };

  const digestUrl = (date: string, themeVal: string, query: string) => {
    const params = new URLSearchParams({ uf: "PE", date });
    if (themeVal && themeVal !== "todos") params.set("theme", themeVal);
    if (query.trim()) params.set("q", query.trim());
    return `/api/digest?${params}`;
  };

  const loadDigest = async (
    which: "today" | "yesterday",
    opts?: { theme?: string; q?: string; base?: Digest }
  ) => {
    const themeVal = opts?.theme ?? theme;
    const query = opts?.q ?? q;
    const info =
      opts?.base ||
      anchors ||
      (await fetch("/api/digest?uf=PE").then((r) => r.json()));
    if (!anchors && info.today && info.yesterday) {
      setAnchors({ today: info.today, yesterday: info.yesterday });
    }
    const date = which === "today" ? info.today : info.yesterday;
    const d = await fetch(digestUrl(date, themeVal, query)).then((r) => r.json());
    setDigest(d);
  };

  useEffect(() => {
    registerServiceWorker().catch(() => {});
    const onbip = (e: Event) => {
      e.preventDefault();
      const ev = e as Event & { prompt: () => Promise<void> };
      setInstallEvt({ prompt: () => ev.prompt() });
    };
    window.addEventListener("beforeinstallprompt", onbip);
    Promise.all([
      loadMeta(),
      fetch("/api/digest?uf=PE").then((r) => r.json()),
      loadAlerts(),
      fetch(`/api/push/me?deviceId=${encodeURIComponent(getDeviceId())}`)
        .then((r) => r.json())
        .then((me) => {
          if (me?.active) {
            setPushOn(true);
            if (Array.isArray(me.themes) && me.themes.length) setPrefThemes(me.themes);
            if (Array.isArray(me.keywords) && me.keywords.length) {
              setPrefPeople(me.keywords.join(", "));
            }
          }
        })
        .catch(() => {}),
    ])
      .then(async ([, base]) => {
        if (base.today && base.yesterday) {
          setAnchors({ today: base.today, yesterday: base.yesterday });
        }
        await loadDigest("today", { base });
      })
      .catch((e) => setError(String(e)));
    return () => window.removeEventListener("beforeinstallprompt", onbip);
  }, []);

  const selectDay = async (which: "today" | "yesterday") => {
    setDay(which);
    setError(null);
    try {
      await loadDigest(which);
      await loadMeta();
    } catch (e) {
      setError(String(e));
    }
  };

  const selectTheme = async (next: string) => {
    setTheme(next);
    setError(null);
    try {
      await loadDigest(day, { theme: next });
    } catch (e) {
      setError(String(e));
    }
  };

  const applySearch = async (e?: FormEvent) => {
    e?.preventDefault();
    const next = qDraft.trim();
    setQ(next);
    setError(null);
    try {
      await loadDigest(day, { q: next });
    } catch (err) {
      setError(String(err));
    }
  };

  const runIngest = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/ingest/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ uf: "PE" }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || r.statusText);
      setFlash(`Coleta: ${j.inserted} novas · ${j.skipped} já existiam · ${j.errors} erros${j.alerts ? ` · ${j.alerts} alertas` : ""}`);
      await selectDay(day);
      await loadAlerts();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const createRule = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const r = await fetch("/api/alerts/rules", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: ruleName.trim(),
          keywords: ruleKeywords,
          uf: "PE",
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || r.statusText);
      setRuleName("");
      setRuleKeywords("");
      setFlash(`Regra criada: ${j.name}`);
      await loadAlerts();
      await loadMeta();
    } catch (err) {
      setError(String(err));
    }
  };

  const rematchAlerts = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/alerts/rematch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ limit: 200 }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || r.statusText);
      setFlash(`Rematch: ${j.matched} novos eventos em ${j.scanned} artigos`);
      await loadAlerts();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const testAlert = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/alerts/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ matchedOn: "teste" }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || r.statusText);
      const st = j.dispatch?.status || j.dispatch?.queued ? "queued" : j.dispatch?.error || "ok";
      setFlash(`Teste alerta #${j.eventId}: ${st}`);
      await loadAlerts();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const togglePrefTheme = (t: string) => {
    setPrefThemes((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]
    );
  };

  const savePushPrefs = async () => {
    setBusy(true);
    setError(null);
    try {
      const keywords = prefPeople
        .split(/[,;|/]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      await subscribePush(prefThemes, keywords, "PE");
      setPushOn(true);
      setFlash("Alertas no celular ativados — só o que você escolheu.");
      await loadMeta();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const stopPush = async () => {
    setBusy(true);
    setError(null);
    try {
      await unsubscribePush();
      setPushOn(false);
      setFlash("Push desativado neste aparelho.");
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const sendTestPush = async () => {
    setBusy(true);
    setError(null);
    try {
      const j = await testPush();
      setFlash(`Push teste: ${j.dispatch?.status || "ok"}`);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const installApp = async () => {
    if (!installEvt) {
      setFlash("No Android/Chrome: menu ⋮ → Instalar app. No iPhone: Compartilhar → Tela de Início.");
      return;
    }
    await installEvt.prompt();
    setInstallEvt(null);
  };

  const items = digest?.items || [];
  const topSources = (digest?.bySource || []).slice(0, 5);

  return (
    <div className="shell">
      <div className="sky" aria-hidden />

      <header className="top">
        <div>
          <p className="brand">Farol</p>
          <p className="tag">Digest do dia — o que a imprensa de PE publicou</p>
        </div>
        <div className="kpis">
          <div className="kpi">
            <span>No dia</span>
            <strong>{digest?.count ?? 0}</strong>
          </div>
          <div className="kpi">
            <span>Fontes</span>
            <strong>{meta?.sources ?? 0}</strong>
          </div>
          <div className="kpi">
            <span>Base</span>
            <strong>{meta?.articles ?? 0}</strong>
          </div>
          <div className="kpi">
            <span>Alertas</span>
            <strong>{meta?.alertRules ?? rules.length}</strong>
          </div>
          <div className="kpi">
            <span>Sprint</span>
            <strong>{meta?.sprint ?? 6}</strong>
          </div>
        </div>
      </header>

      <section className="hero-line">
        <div>
          <h1>{digest?.label || "Digest"} · Pernambuco</h1>
          <p>
            {digest?.date || ""}
            {meta?.lastFetchAt ? ` · última coleta ${fmtWhen(meta.lastFetchAt)}` : ""}
          </p>
        </div>
        <div className="actions">
          <div className="day-tabs" role="tablist" aria-label="Dia">
            <button
              type="button"
              className={day === "today" ? "tab on" : "tab"}
              onClick={() => selectDay("today")}
            >
              Hoje
            </button>
            <button
              type="button"
              className={day === "yesterday" ? "tab on" : "tab"}
              onClick={() => selectDay("yesterday")}
            >
              Ontem
            </button>
          </div>
          <button type="button" className="btn" onClick={runIngest} disabled={busy}>
            {busy ? "Coletando…" : "Coletar agora"}
          </button>
        </div>
      </section>

      <section className="filters" aria-label="Filtros">
        <div className="theme-tabs" role="tablist" aria-label="Tema">
          {THEME_CHIPS.map((t) => (
            <button
              key={t}
              type="button"
              className={theme === t ? "tab on" : "tab"}
              onClick={() => selectTheme(t)}
            >
              {t === "todos" ? "Todos" : t}
            </button>
          ))}
        </div>
        <form className="search" onSubmit={applySearch}>
          <input
            type="search"
            placeholder="Buscar título, resumo ou veículo…"
            value={qDraft}
            onChange={(e) => setQDraft(e.target.value)}
            aria-label="Busca"
          />
          <button type="submit" className="btn ghost">
            Buscar
          </button>
        </form>
      </section>

      {error && <p className="err">{error}</p>}
      {(flash || digest?.note) && <p className="note">{flash || digest?.note}</p>}

      {topSources.length > 0 && (
        <div className="source-strip">
          {topSources.map((s) => (
            <span key={s.name} className="chip">
              {s.name} <b>{s.count}</b>
            </span>
          ))}
        </div>
      )}

      <section className="board">
        {items.length === 0 ? (
          <div className="empty">
            <p className="empty-title">Sem matérias neste filtro</p>
            <p>
              Ajuste o tema/busca, troque o dia ou rode <strong>Coletar agora</strong>.
            </p>
          </div>
        ) : (
          <ul className="feed">
            {items.map((it) => (
              <li key={it.id} className="row">
                <time dateTime={it.publishedAt || it.fetchedAt || undefined}>
                  {fmtTime(it.publishedAt || it.fetchedAt)}
                </time>
                <div className="row-body">
                  <a href={it.url} target="_blank" rel="noreferrer">
                    {it.title}
                  </a>
                  <span className="meta-line">
                    <span className="vehicle">{it.source || "Fonte"}</span>
                    {it.theme ? <span className="theme-tag">{it.theme}</span> : null}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="notify" aria-label="Instalar e alertas">
        <div className="alerts-head">
          <div>
            <h2>No celular</h2>
            <p>
              Instale o Farol e escolha temas ou personalidades. Notificação do sistema — sem
              WhatsApp.
              {meta?.pushConfigured === false ? " (VAPID ainda não configurado no servidor.)" : ""}
            </p>
          </div>
          <div className="actions">
            <button type="button" className="btn ghost" onClick={installApp}>
              {installEvt ? "Instalar app" : "Como instalar"}
            </button>
            {pushOn ? (
              <>
                <button type="button" className="btn ghost" onClick={sendTestPush} disabled={busy}>
                  Testar push
                </button>
                <button type="button" className="btn ghost" onClick={stopPush} disabled={busy}>
                  Desativar
                </button>
              </>
            ) : null}
          </div>
        </div>

        <div className="theme-tabs" role="group" aria-label="Temas para alertar">
          {PREF_THEMES.map((t) => (
            <button
              key={t}
              type="button"
              className={prefThemes.includes(t) ? "tab on" : "tab"}
              onClick={() => togglePrefTheme(t)}
            >
              {t}
            </button>
          ))}
        </div>

        <form
          className="rule-form"
          onSubmit={(e) => {
            e.preventDefault();
            savePushPrefs();
          }}
        >
          <input
            type="text"
            placeholder="Personalidades / keywords (ex.: Raquel, Cabrobó)"
            value={prefPeople}
            onChange={(e) => setPrefPeople(e.target.value)}
            aria-label="Personalidades"
          />
          <button type="submit" className="btn" disabled={busy || meta?.pushConfigured === false}>
            {pushOn ? "Atualizar alertas" : "Ativar alertas"}
          </button>
        </form>
        {pushOn ? (
          <p className="notify-status">
            Ativo · temas: {prefThemes.join(", ") || "—"}
            {prefPeople.trim() ? ` · pessoas: ${prefPeople}` : ""}
          </p>
        ) : null}
      </section>

      <section className="alerts" aria-label="Alertas">
        <div className="alerts-head">
          <div>
            <h2>Alertas</h2>
            <p>
              {meta?.alertWebhookConfigured
                ? "Webhook n8n configurado — disparo ativo na coleta."
                : "Defina N8N_ALERT_WEBHOOK no Easypanel para disparar no WhatsApp/n8n."}
            </p>
          </div>
          <div className="actions">
            <button type="button" className="btn ghost" onClick={rematchAlerts} disabled={busy}>
              Rematch
            </button>
            <button type="button" className="btn ghost" onClick={testAlert} disabled={busy}>
              Testar disparo
            </button>
          </div>
        </div>

        <form className="rule-form" onSubmit={createRule}>
          <input
            type="text"
            placeholder="Nome da regra"
            value={ruleName}
            onChange={(e) => setRuleName(e.target.value)}
            required
          />
          <input
            type="text"
            placeholder="Keywords (vírgula)"
            value={ruleKeywords}
            onChange={(e) => setRuleKeywords(e.target.value)}
            required
          />
          <button type="submit" className="btn">
            Criar regra
          </button>
        </form>

        {rules.length > 0 && (
          <div className="source-strip">
            {rules.map((r) => (
              <span key={r.id} className="chip">
                {r.name} <b>{(r.keywords || []).join(", ")}</b>
              </span>
            ))}
          </div>
        )}

        {events.length > 0 && (
          <ul className="event-list">
            {events.map((ev) => (
              <li key={ev.id}>
                <span className={`st ${ev.status}`}>{ev.status}</span>
                <a href={ev.url} target="_blank" rel="noreferrer">
                  {ev.title}
                </a>
                <span className="vehicle">
                  {ev.ruleName} · “{ev.matchedOn}” · {ev.source || "Fonte"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer className="foot">
        Farol · Sprint {meta?.sprint ?? 6} · paralelo ao Radar Imprensa
      </footer>
    </div>
  );
}
