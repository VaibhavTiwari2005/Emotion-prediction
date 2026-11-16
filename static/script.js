(() => {
  // Same origin by default. Set window.API_BASE before this script to point elsewhere.
  const API = window.API_BASE || "";

  const EMOTIONS = {
    sadness:  { emoji: "😢", color: "#3e6fb0" },
    joy:      { emoji: "😄", color: "#d99a00" },
    love:     { emoji: "❤️", color: "#d6457a" },
    anger:    { emoji: "😠", color: "#c8372d" },
    fear:     { emoji: "😨", color: "#6b4fa3" },
    surprise: { emoji: "😲", color: "#1e9e8f" },
  };

  const EXAMPLES = [
    { label: "Passed the exam", emotion: "joy",      text: "I just found out I passed my exam and I feel amazing" },
    { label: "Missing home",    emotion: "sadness",  text: "I miss my family so much and the house feels empty without them" },
    { label: "Unfair deadline", emotion: "anger",    text: "I am furious that they changed the deadline again without telling anyone" },
    { label: "Late-night noise",emotion: "fear",     text: "I heard footsteps downstairs and I am too scared to move" },
    { label: "Surprise visit",  emotion: "surprise", text: "I opened the door and felt so surprised to see my friend" },
    { label: "Anniversary",     emotion: "love",     text: "Every day with you makes me feel more grateful and more in love" },
  ];

  const $ = (id) => document.getElementById(id);
  const el = {
    text: $("text"), count: $("count"), analyze: $("analyze"), btnText: $("btn-text"),
    clear: $("clear"), chips: $("chips"), result: $("result"), empty: $("empty"),
    error: $("error"), output: $("output"), emoji: $("emoji"), emotion: $("emotion"),
    conf: $("conf"), quote: $("quote"), bars: $("bars"), status: $("status"),
    statusText: $("status-text"), historyWrap: $("history-wrap"), history: $("history"),
    clearHistory: $("clear-history"),
  };

  let history = [];
  let busy = false;

  /* Example chips */
  EXAMPLES.forEach((ex) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip";
    b.style.setProperty("--c", EMOTIONS[ex.emotion].color);
    b.innerHTML = "<i></i>";
    b.append(ex.label);
    b.addEventListener("click", () => {
      el.text.value = ex.text;
      updateCount();
      analyze();
    });
    el.chips.appendChild(b);
  });

  /* Server status */
  async function checkHealth() {
    try {
      const res = await fetch(`${API}/health`);
      const data = await res.json();
      if (res.ok && data.model_loaded) setStatus("online", "Model ready");
      else setStatus("offline", "Model loading");
    } catch {
      setStatus("offline", "Server unreachable");
    }
  }
  function setStatus(state, label) {
    el.status.className = `status ${state}`;
    el.statusText.textContent = label;
  }

  /* Input helpers */
  function updateCount() { el.count.textContent = el.text.value.length; }
  el.text.addEventListener("input", updateCount);
  el.text.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); analyze(); }
  });
  el.analyze.addEventListener("click", analyze);
  el.clear.addEventListener("click", () => {
    el.text.value = "";
    updateCount();
    el.output.hidden = true;
    el.error.hidden = true;
    el.empty.hidden = false;
    el.result.style.setProperty("--accent", "#16202b");
    el.text.focus();
  });

  function setBusy(state) {
    busy = state;
    el.analyze.disabled = state;
    el.analyze.classList.toggle("loading", state);
    el.btnText.textContent = state ? "Analyzing" : "Analyze text";
  }

  function showError(message) {
    el.empty.hidden = true;
    el.output.hidden = true;
    el.error.hidden = false;
    el.error.textContent = message;
  }

  /* Prediction */
  async function analyze() {
    if (busy) return;
    const text = el.text.value.trim();
    if (!text) {
      showError("Enter some text first. The model needs at least one word to read.");
      el.text.focus();
      return;
    }

    setBusy(true);
    try {
      const res = await fetch(`${API}/predict`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });

      if (res.status === 503) throw new Error("The model is still loading. Wait a few seconds and try again.");
      if (res.status === 422) throw new Error("The text was rejected. Keep it between 1 and 2000 characters.");
      if (!res.ok) throw new Error(`The server returned an error (${res.status}). Try again in a moment.`);

      const data = await res.json();
      render(data);
      addHistory(data);
      setStatus("online", "Model ready");
    } catch (err) {
      if (err instanceof TypeError) {
        setStatus("offline", "Server unreachable");
        showError("Can’t reach the server. Check that the API is running, then try again.");
      } else {
        showError(err.message);
      }
    } finally {
      setBusy(false);
    }
  }

  function pct(p) { return (p * 100).toFixed(1) + "%"; }

  function render(data) {
    const meta = EMOTIONS[data.predicted_emotion] || { emoji: "🙂", color: "#16202b" };

    el.empty.hidden = true;
    el.error.hidden = true;
    el.output.hidden = false;
    el.result.style.setProperty("--accent", meta.color);

    el.emoji.textContent = meta.emoji;
    el.emotion.textContent = data.predicted_emotion;
    el.conf.textContent = pct(data.confidence);
    el.quote.textContent = data.text;

    el.bars.innerHTML = "";
    const rows = Object.entries(data.all_probabilities).sort((a, b) => b[1] - a[1]);
    const fills = [];

    rows.forEach(([label, p], i) => {
      const li = document.createElement("li");
      li.className = "bar" + (i === 0 ? " top" : "");
      li.style.setProperty("--c", (EMOTIONS[label] || meta).color);
      li.innerHTML =
        `<span class="name"></span><div class="track"><div class="fill"></div></div><span class="pct"></span>`;
      li.querySelector(".name").textContent = label;
      li.querySelector(".pct").textContent = pct(p);
      el.bars.appendChild(li);
      fills.push([li.querySelector(".fill"), p]);
    });

    requestAnimationFrame(() => requestAnimationFrame(() => {
      fills.forEach(([f, p]) => { f.style.width = (p * 100) + "%"; });
    }));
  }

  /* History */
  function addHistory(data) {
    history.unshift({ text: data.text, emotion: data.predicted_emotion, confidence: data.confidence, full: data });
    history = history.slice(0, 6);
    renderHistory();
  }

  function renderHistory() {
    el.historyWrap.hidden = history.length === 0;
    el.history.innerHTML = "";
    history.forEach((h) => {
      const li = document.createElement("li");
      const b = document.createElement("button");
      b.type = "button";
      b.className = "h-item";
      b.style.setProperty("--c", EMOTIONS[h.emotion].color);
      b.innerHTML = `<span>${EMOTIONS[h.emotion].emoji}</span><span class="h-text"></span><span class="h-meta"><b></b></span>`;
      b.querySelector(".h-text").textContent = h.text;
      b.querySelector("b").textContent = h.emotion;
      b.querySelector(".h-meta").append(" " + pct(h.confidence));
      b.addEventListener("click", () => {
        el.text.value = h.text;
        updateCount();
        render(h.full);
        window.scrollTo({ top: 0, behavior: "smooth" });
      });
      li.appendChild(b);
      el.history.appendChild(li);
    });
  }

  el.clearHistory.addEventListener("click", () => { history = []; renderHistory(); });

  checkHealth();
})();
