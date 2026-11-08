// RiuPlay: the app's identity and profile folder, fixed before any other main-process module loads.
// main/index.ts imports this FIRST: several modules compute paths under userData when they are
// imported (db/index.ts's DB_PATH, backup.ts, ...), and ES modules run their imports in order, so
// anything set later in index.ts itself would come too late for them.
//
// The folder is pinned explicitly rather than derived from the package/app name: a development run
// under an upstream name once opened another app's real profile (hibiki's) on the same machine.
// RiuPlay must only ever read and write %APPDATA%\RiuPlay.
import path from "node:path";
import { app } from "electron";

export const APP_NAME = "RiuPlay";
export const APP_USER_MODEL_ID = "io.github.tessarion.riuplay";

app.setName(APP_NAME);
// Keep the taskbar identity independent from Electron's development executable name.
app.setAppUserModelId(APP_USER_MODEL_ID);
// RIUPLAY_USER_DATA_DIR (an absolute path) runs the app on a separate, disposable profile - for tests
// and verification runs that must not touch the user's real profile. Never set by the app itself.
const isolatedProfile = process.env.RIUPLAY_USER_DATA_DIR;
app.setPath("userData", isolatedProfile && path.isAbsolute(isolatedProfile) ? isolatedProfile : path.join(app.getPath("appData"), APP_NAME));
