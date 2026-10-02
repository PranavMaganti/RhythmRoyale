/** localStorage can be unavailable (private mode, blocked cookies); never let that break the game. */
export function load<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(`rr:${key}`);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function save(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(`rr:${key}`, JSON.stringify(value));
  } catch {
    // Progress just won't persist.
  }
}

/** Whether pressing a pad plays its note. Off suits Bluetooth headphones, where it sounds late. */
export function loadTapSounds(): boolean {
  return load("tapSounds", true);
}

export function saveTapSounds(on: boolean): void {
  save("tapSounds", on);
}

export function loadName(): string {
  return load("name", "");
}

export function saveName(name: string): void {
  save("name", name.trim().slice(0, 16));
}

/** Anonymous id so the daily leaderboard keeps one entry per browser. */
export function playerToken(): string {
  let token = load<string>("token", "");
  if (!token) {
    token = Array.from({ length: 24 }, () => Math.floor(Math.random() * 36).toString(36)).join("");
    save("token", token);
  }
  return token;
}
