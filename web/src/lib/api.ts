import axios, { AxiosError, type InternalAxiosRequestConfig } from "axios";

const BASE = import.meta.env.VITE_API_URL || "";

export const TOKEN_KEY = "hrp.accessToken";
export const REFRESH_KEY = "hrp.refreshToken";

/** The technical-admin console keeps its session under its own keys. */
const TECH_TOKEN_KEY = "hrp.techAdmin.accessToken";
const TECH_REFRESH_KEY = "hrp.techAdmin.refreshToken";

/**
 * Which portal this tab is showing.
 *
 * The technical-admin console and the employee portal are two different
 * sign-ins served from one origin, so they shared one pair of localStorage
 * keys and one session: signing into either overwrote the other, and the tab
 * left behind started failing on its next request. localStorage is shared
 * across every tab of an origin, so this was not even limited to one window
 * -- opening the console logged you out of the portal next door.
 *
 * Reading the path per call rather than once at module load: these keys are
 * asked for after navigation, and a value captured at import time would still
 * name whichever portal the tab happened to open on.
 */
function onTechAdminRoute(): boolean {
  try {
    return window.location.pathname.startsWith("/tech-admin");
  } catch {
    return false;
  }
}

const accessKey = () => (onTechAdminRoute() ? TECH_TOKEN_KEY : TOKEN_KEY);
const refreshKey = () => (onTechAdminRoute() ? TECH_REFRESH_KEY : REFRESH_KEY);

export const tokenStore = {
  get access() {
    return localStorage.getItem(accessKey());
  },
  get refresh() {
    return localStorage.getItem(refreshKey());
  },
  set(access: string, refresh: string) {
    localStorage.setItem(accessKey(), access);
    localStorage.setItem(refreshKey(), refresh);
  },
  clear() {
    // Only this portal's session. Signing out of the console must not sign
    // you out of the employee portal in the next tab.
    localStorage.removeItem(accessKey());
    localStorage.removeItem(refreshKey());
  }
};

export const api = axios.create({
  baseURL: `${BASE}/api`,
  headers: { "Content-Type": "application/json" }
});

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = tokenStore.access;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

/**
 * Whether a JWT's own expiry has passed.
 *
 * Read straight from the token's payload — no verification, which is fine
 * because this only decides whether to keep a session on screen. The server
 * still checks the signature on every request.
 *
 * Anything unreadable counts as expired: a token this cannot parse is not one
 * worth holding a session open for.
 */
export function tokenExpired(token: string | null): boolean {
  if (!token) return true;
  try {
    const [, payload] = token.split(".");
    if (!payload) return true;
    const { exp } = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    if (typeof exp !== "number") return true;
    // Thirty seconds of slack so a token about to lapse is treated as gone
    // rather than sending one more request that is certain to fail.
    return exp * 1000 <= Date.now() + 30_000;
  } catch {
    return true;
  }
}

// Single-flight refresh so concurrent 401s don't trigger multiple refreshes.
let refreshing: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = tokenStore.refresh;
  if (!refreshToken) return null;
  try {
    const res = await axios.post(`${BASE}/api/auth/refresh`, { refreshToken });
    const pair = res.data?.data ?? res.data;
    if (pair?.accessToken) {
      tokenStore.set(pair.accessToken, pair.refreshToken ?? refreshToken);
      return pair.accessToken;
    }
    return null;
  } catch {
    return null;
  }
}

api.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const original = error.config as InternalAxiosRequestConfig & { _retry?: boolean };
    const status = error.response?.status;
    const isAuthCall = original?.url?.includes("/auth/");

    if (status === 401 && original && !original._retry && !isAuthCall) {
      if (tokenStore.access?.startsWith("mock-token-")) {
        return Promise.reject(error);
      }
      original._retry = true;
      refreshing = refreshing ?? refreshAccessToken();
      const newToken = await refreshing;
      refreshing = null;
      if (newToken) {
        original.headers.Authorization = `Bearer ${newToken}`;
        return api(original);
      }

      /*
       * A session with no refresh token cannot be refreshed, and that is not
       * the same thing as being over.
       *
       * The technical-admin sign-in returns an access token alone and stores ""
       * for the refresh token, so refreshAccessToken() gives up immediately.
       * The old code read that as "session finished" and cleared everything —
       * meaning a single 401 from any one request ended a session whose token
       * was still valid for hours. That is the early sign-out.
       *
       * A 401 on one request is now allowed to be about that request. The
       * session ends when its four-hour token actually expires, at which point
       * every request 401s and the guard below sends them to sign in again.
       */
      const canRefresh = Boolean(tokenStore.refresh);
      const onTechAdmin = location.pathname.startsWith("/tech-admin");

      /*
       * One refused request in the technical-admin section is about that
       * request. That area is full of endpoints a technical admin may not call
       * — /auth/me among them, since they are not an employee — and treating
       * any of those refusals as the end of the session cleared a token that
       * was still valid, which is what made reload behave like sign-out.
       *
       * The session ends when its own four-hour token expires, checked below.
       */
      if (onTechAdmin && !tokenExpired(tokenStore.access)) {
        return Promise.reject(error);
      }

      if (!canRefresh && !tokenExpired(tokenStore.access)) {
        // Still inside the token's lifetime — leave the session alone and let
        // the caller handle its own 401.
        return Promise.reject(error);
      }

      tokenStore.clear();
      // Sending a technical admin to the employee login stranded them on a form
      // their credentials do not work against.
      const signIn = onTechAdmin ? "/tech-admin/login" : "/login";
      if (location.pathname !== signIn) location.href = signIn;
    }
    return Promise.reject(error);
  }
);

/** Pull a human-friendly message out of the API error envelope. */
export function apiMessage(err: unknown, fallback = "Something went wrong") {
  const e = err as AxiosError<{ message?: string }>;
  return e?.response?.data?.message || e?.message || fallback;
}
