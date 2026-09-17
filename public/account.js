(() => {
  "use strict";

  const listEl = document.getElementById("board-list");
  const guestEl = document.getElementById("account-guest");
  const userEl = document.getElementById("account-user");
  const loginForm = document.getElementById("login-form");
  const codeForm = document.getElementById("code-form");
  const emailEl = document.getElementById("login-email");
  const nameEl = document.getElementById("login-name");
  const codeEl = document.getElementById("login-code");
  const msgEl = document.getElementById("account-msg");
  const accountNameEl = document.getElementById("account-name");
  const avatarImg = document.getElementById("avatar-img");
  const avatarFile = document.getElementById("avatar-file");
  const logoutBtn = document.getElementById("logout");
  const sendBtn = document.getElementById("login-send");

  let me = null;
  let pendingEmail = "";
  let pendingName = "";

  function showMsg(text, isError) {
    if (!msgEl) return;
    msgEl.hidden = !text;
    msgEl.textContent = text || "";
    msgEl.classList.toggle("is-error", !!isError);
  }

  async function api(path, opts) {
    const res = await fetch(path, Object.assign({ credentials: "same-origin" }, opts));
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || "Er ging iets mis.");
      err.status = res.status;
      throw err;
    }
    return data;
  }

  function avatarUrl(user) {
    if (!user || !user.id || !user.hasAvatar) return "assets/icon-192.png";
    return "/api/avatar/" + encodeURIComponent(user.id) + "?v=" + encodeURIComponent(user.updatedAt || "0");
  }

  function emblem(rank) {
    if (rank === 1) return { cls: "gold", label: "Goud" };
    if (rank === 2) return { cls: "silver", label: "Zilver" };
    if (rank === 3) return { cls: "bronze", label: "Brons" };
    return null;
  }

  function renderBoard(rows) {
    if (!listEl) return;
    listEl.innerHTML = "";
    if (!rows || !rows.length) {
      const empty = document.createElement("li");
      empty.className = "board-empty";
      empty.textContent = "Nog geen scores. Log in en speel.";
      listEl.appendChild(empty);
      return;
    }
    rows.forEach((row) => {
      const li = document.createElement("li");
      li.className = "board-row";
      const badge = emblem(row.rank);
      const medal = badge
        ? `<span class="emblem ${badge.cls}" title="${badge.label}" aria-label="${badge.label}">★</span>`
        : `<span class="emblem-gap"></span>`;
      li.innerHTML = `
        <span class="board-rank">${row.rank}</span>
        ${medal}
        <img class="board-avatar" alt="" width="32" height="32" src="${avatarUrl(row)}" />
        <span class="board-name"></span>
        <span class="board-score">${row.bestScore}</span>
      `;
      li.querySelector(".board-name").textContent = row.name || "Speler";
      listEl.appendChild(li);
    });
  }

  function renderAccount() {
    if (!guestEl || !userEl) return;
    if (me) {
      guestEl.hidden = true;
      userEl.hidden = false;
      accountNameEl.textContent = me.name || me.email;
      avatarImg.src = avatarUrl(me);
      avatarImg.alt = me.name || "Profielfoto";
    } else {
      guestEl.hidden = false;
      userEl.hidden = true;
    }
  }

  async function refreshMe() {
    try {
      const data = await api("/api/me");
      me = data.user || null;
    } catch (err) {
      me = null;
      if (err.status !== 401 && err.status !== 404) {
        showMsg("Accountserver is nog niet bereikbaar.", true);
      }
    }
    renderAccount();
    return me;
  }

  async function refreshBoard() {
    try {
      const data = await api("/api/leaderboard");
      renderBoard(data.players || []);
    } catch {
      renderBoard([]);
    }
  }

  async function submitScore(score) {
    const n = Number(score) || 0;
    if (!me || n < 1) return;
    try {
      await api("/api/score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ score: n }),
      });
      await refreshBoard();
      await refreshMe();
    } catch {
      /* ranking is best-effort */
    }
  }

  function resizeAvatar(file) {
    return new Promise((resolve, reject) => {
      if (!file || !file.type || !file.type.startsWith("image/")) {
        reject(new Error("Kies een afbeelding."));
        return;
      }
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const size = 192;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        const side = Math.min(img.width, img.height);
        const sx = (img.width - side) / 2;
        const sy = (img.height - side) / 2;
        ctx.fillStyle = "#112d63";
        ctx.fillRect(0, 0, size, size);
        ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
        const data = canvas.toDataURL("image/jpeg", 0.84);
        resolve(data);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Deze foto kon niet worden gelezen."));
      };
      img.src = url;
    });
  }

  if (loginForm) {
    loginForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      showMsg("");
      const email = (emailEl.value || "").trim().toLowerCase();
      const name = (nameEl.value || "").trim();
      if (!email) {
        showMsg("Vul je e-mailadres in.", true);
        return;
      }
      sendBtn.disabled = true;
      try {
        const data = await api("/api/auth/request", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, name }),
        });
        pendingEmail = email;
        pendingName = name;
        codeForm.hidden = false;
        codeEl.value = data.devCode || "";
        codeEl.focus();
        showMsg(data.devCode ? `Dev-code: ${data.devCode}` : "Code is verstuurd. Check je e-mail.");
      } catch (err) {
        showMsg(err.message, true);
      } finally {
        sendBtn.disabled = false;
      }
    });
  }

  if (codeForm) {
    codeForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      showMsg("");
      try {
        const data = await api("/api/auth/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: pendingEmail || (emailEl.value || "").trim().toLowerCase(),
            name: pendingName || (nameEl.value || "").trim(),
            code: (codeEl.value || "").trim(),
          }),
        });
        me = data.user;
        codeForm.hidden = true;
        showMsg("");
        renderAccount();
        await refreshBoard();
      } catch (err) {
        showMsg(err.message, true);
      }
    });
  }

  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      try {
        await api("/api/auth/logout", { method: "POST" });
      } catch {
        /* ignore */
      }
      me = null;
      renderAccount();
    });
  }

  if (avatarFile) {
    avatarFile.addEventListener("change", async () => {
      const file = avatarFile.files && avatarFile.files[0];
      avatarFile.value = "";
      if (!file) return;
      showMsg("");
      try {
        const image = await resizeAvatar(file);
        const data = await api("/api/me/avatar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image }),
        });
        me = data.user;
        renderAccount();
        await refreshBoard();
      } catch (err) {
        showMsg(err.message, true);
      }
    });
  }

  refreshMe().then(refreshBoard);

  window.HagroAccount = {
    submitScore,
    refreshBoard,
    me: () => me,
  };
})();
