const login = document.getElementById("coach-login");
const report = document.getElementById("coach-report");
const status = document.getElementById("coach-status");
const message = document.getElementById("coach-message");

async function loadCoach() {
  status.textContent = "Préparation de ton plan…";
  try {
    const response = await fetch("/api/coach", { cache: "no-store", credentials: "same-origin" });
    if (response.status === 404) {
      login.hidden = false;
      report.hidden = true;
      message.textContent = "";
      status.textContent = "Identifie-toi pour consulter ton coaching.";
      return;
    }
    if (!response.ok) throw new Error("Le coaching est temporairement indisponible. Réessaie dans un instant.");
    const plan = await response.json();
    message.textContent = plan.message;
    login.hidden = true;
    report.hidden = false;
    status.textContent = `Semaine ${plan.week} · ${plan.team} · actualisé ${new Date(plan.generatedAt).toLocaleString("fr-FR")}`;
  } catch (error) {
    status.textContent = error.message;
  }
}

login.addEventListener("submit", async event => {
  event.preventDefault();
  const field = document.getElementById("coach-password");
  const button = login.querySelector("button");
  button.disabled = true;
  try {
    const response = await fetch("/api/coach-session", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: field.value }), credentials: "same-origin"
    });
    field.value = "";
    if (!response.ok) {
      status.textContent = response.status === 429 ? "Trop de tentatives. Réessaie dans 15 minutes." : response.status === 503 ? "Accès privé non encore configuré." : "Mot de passe incorrect.";
      return;
    }
    await loadCoach();
  } catch {
    status.textContent = "Connexion impossible. Réessaie.";
  } finally {
    button.disabled = false;
  }
});
document.getElementById("coach-refresh").addEventListener("click", loadCoach);
document.getElementById("coach-logout").addEventListener("click", async () => {
  try {
    const response = await fetch("/api/coach-session?logout=1", { method: "POST", credentials: "same-origin" });
    if (!response.ok) throw new Error();
    message.textContent = "";
    report.hidden = true;
    login.hidden = false;
    status.textContent = "Déconnecté.";
  } catch {
    status.textContent = "Déconnexion impossible. Réessaie.";
  }
});
loadCoach();
