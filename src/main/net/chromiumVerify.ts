// RiuPlay M3: checks the effective proxy on Chromium's side the way the player, posters and
// sign-in windows actually use it - a page load in a hidden, sandboxed window of the default
// session (session.fetch() does not raise proxy "login" events, so it can't verify an
// authenticating proxy). Nothing is shown, no preload, no Node; the window is destroyed afterwards.
import { BrowserWindow, session } from "electron";

export async function verifyChromiumPath(url: string, timeoutMs: number): Promise<{ ok: boolean; code: string | null }> {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { session: session.defaultSession, sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false },
  });
  let status: number | null = null;
  win.webContents.on("did-navigate", (_event, _url, code) => {
    status = code;
  });
  const timer = setTimeout(() => win.webContents.stop(), timeoutMs);
  try {
    await win.loadURL(url);
    return { ok: status === 200, code: status === 200 ? null : `http-${status ?? "?"}` };
  } catch (error) {
    return { ok: false, code: (error as { code?: string }).code ?? (error instanceof Error ? error.name : "error") };
  } finally {
    clearTimeout(timer);
    win.destroy();
  }
}
