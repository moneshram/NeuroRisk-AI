export type Theme = "dark" | "light";

function themeKey() {
  try {
    if (window.location.pathname.startsWith("/admin") || window.location.pathname === "/admin-login") return "stroke_theme_admin";
    const raw = localStorage.getItem("stroke_user");
    const user = raw ? JSON.parse(raw) : null;
    return user?.role === "admin" ? "stroke_theme_admin" : "stroke_theme_user";
  } catch {
    return "stroke_theme_user";
  }
}

export function getTheme(): Theme {
  return localStorage.getItem(themeKey()) === "light" ? "light" : "dark";
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(themeKey(), theme);
}

export function initializeTheme() {
  applyTheme(getTheme());
}
