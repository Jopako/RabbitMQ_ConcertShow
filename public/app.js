const grid = document.getElementById("grid");
const statusEl = document.getElementById("status");
const refreshBtn = document.getElementById("refresh");
const userNameInput = document.getElementById("userName");

function setStatus(message, tone = "") {
  statusEl.textContent = message || "";
  if (tone) statusEl.dataset.tone = tone;
  else delete statusEl.dataset.tone;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function artistCard(artist) {
  const remaining = Number(artist.remaining ?? 0);
  const isOut = remaining <= 0;
  const remainingText = isOut ? "Fora de estoque" : `${remaining} disponível`;

  return `
    <article class="card" data-artist-id="${escapeHtml(artist.id)}">
      <h2 class="card__name">${escapeHtml(artist.name)}</h2>
      <div class="card__meta">
        <span class="pill ${isOut ? "pill--out" : ""}">
          <span class="pill__dot" aria-hidden="true"></span>
          ${escapeHtml(remainingText)}
        </span>
      </div>
      <div class="card__actions">
        <button class="btn btn--primary" type="button" data-action="buy" ${isOut ? "disabled" : ""}>
          Comprar
        </button>
      </div>
    </article>
  `.trim();
}

async function loadArtists() {
  grid.setAttribute("aria-busy", "true");
  setStatus("Carregando artistas...");
  try {
    const res = await fetch("/api/artists");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    grid.innerHTML = data.artists.map(artistCard).join("\n");
    setStatus("Pronto. Escolha um artista e clique em comprar.");
  } catch (err) {
    setStatus("Não consegui carregar os artistas. Verifique o servidor/consumer.", "bad");
    grid.innerHTML = "";
    console.error(err);
  } finally {
    grid.setAttribute("aria-busy", "false");
  }
}

async function buy(artistId) {
  const userName = (userNameInput.value || "").trim();
  if (!userName) {
    userNameInput.focus();
    setStatus("Coloca seu nome aí antes de comprar :)", "warn");
    return;
  }

  setStatus("Enviando pedido...", "");
  try {
    const res = await fetch("/api/buy", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: userName, artistId }),
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      const msg = data?.error || `Erro (HTTP ${res.status})`;
      setStatus(msg, "bad");
      return;
    }

    if (data.ok) {
      setStatus(`Compra aprovada para ${userName}! Restante: ${data.remaining}`, "ok");
    } else if (data.reason === "sold_out") {
      setStatus(`Foi mal, ${userName} — está fora de estoque.`, "bad");
    } else {
      setStatus("Não consegui finalizar. Tenta de novo.", "bad");
    }
  } catch (err) {
    setStatus("Falha na compra. O servidor está rodando?", "bad");
    console.error(err);
  } finally {
    await loadArtists();
  }
}

grid.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-action='buy']");
  if (!btn) return;
  const card = btn.closest("[data-artist-id]");
  if (!card) return;
  const artistId = card.getAttribute("data-artist-id");
  buy(artistId);
});

refreshBtn.addEventListener("click", () => loadArtists());

loadArtists();
