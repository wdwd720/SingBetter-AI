const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { app, BrowserWindow, shell, dialog } = require("electron");
const { autoUpdater } = require("electron-updater");

const APP_HOST = "127.0.0.1";
const APP_PORT = 5510;
const SERVER_READY_TIMEOUT_MS = 20000;
const UPDATE_CHECK_DELAY_MS = 5000;
let updaterInitialized = false;

const logDesktop = (message) => {
  console.log(`[desktop] ${message}`);
};

const ensureDir = (targetPath) => {
  fs.mkdirSync(targetPath, { recursive: true });
};

const resolveFileDatabasePath = (databaseUrl) => {
  if (!databaseUrl || typeof databaseUrl !== "string") return null;
  if (!databaseUrl.startsWith("file:") && !databaseUrl.startsWith("sqlite:")) return null;

  const raw = databaseUrl
    .replace(/^file:/, "")
    .replace(/^sqlite:/, "")
    .trim();

  if (!raw) return null;
  return path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
};

const migrateDatabaseToUserData = (destinationPath, candidatePaths) => {
  try {
    if (fs.existsSync(destinationPath)) return;

    const uniqueCandidates = [...new Set(candidatePaths.filter(Boolean))].filter(
      (candidate) => candidate !== destinationPath,
    );

    for (const sourcePath of uniqueCandidates) {
      if (!fs.existsSync(sourcePath)) continue;
      fs.copyFileSync(sourcePath, destinationPath);
      logDesktop(`Migrated DB to userData: ${destinationPath}`);
      logDesktop(`Migration source: ${sourcePath}`);
      return;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logDesktop(`DB migration skipped due to error: ${message}`);
  }
};

const loadOrCreateSessionSecret = (secretPath) => {
  if (fs.existsSync(secretPath)) {
    const existing = fs.readFileSync(secretPath, "utf8").trim();
    if (existing.length >= 32) {
      return existing;
    }
  }

  const generated = crypto.randomBytes(48).toString("hex");
  fs.writeFileSync(secretPath, generated, "utf8");
  return generated;
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const waitForServer = async (url) => {
  const start = Date.now();
  while (Date.now() - start < SERVER_READY_TIMEOUT_MS) {
    try {
      const response = await fetch(`${url}/api/health`, {
        method: "GET",
      });
      if (response.ok || response.status === 401 || response.status === 403) {
        return;
      }
    } catch (_error) {
      // Ignore startup race and retry.
    }
    await wait(300);
  }
  throw new Error("Timed out while waiting for desktop server startup");
};

const readUpdatePublishTarget = () => {
  try {
    const packageJsonPath = path.resolve(__dirname, "..", "package.json");
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
    const publishField = packageJson?.build?.publish;
    const publishConfig = Array.isArray(publishField) ? publishField[0] : publishField;
    if (!publishConfig || typeof publishConfig !== "object") return "not-configured";

    if (publishConfig.provider === "github") {
      const owner = publishConfig.owner || "unknown-owner";
      const repo = publishConfig.repo || "unknown-repo";
      return `github:${owner}/${repo}`;
    }

    if (publishConfig.provider === "generic") {
      return `generic:${publishConfig.url || "unknown-url"}`;
    }

    return String(publishConfig.provider || "unknown");
  } catch (_error) {
    return "unreadable";
  }
};

const initAutoUpdates = (mainWindow) => {
  if (updaterInitialized) return;
  if (!app.isPackaged) return;
  if (process.env.DESKTOP_APP !== "1") return;
  updaterInitialized = true;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  logDesktop(
    `Updater diagnostics version=${app.getVersion()} packaged=${app.isPackaged} provider=${readUpdatePublishTarget()} channel=${autoUpdater.channel || "latest"}`,
  );

  let lastPercentLogged = -1;

  autoUpdater.on("checking-for-update", () => {
    logDesktop("Auto-update: checking for updates");
  });

  autoUpdater.on("update-available", (info) => {
    logDesktop(`Auto-update: update available ${info?.version || "unknown-version"}`);
  });

  autoUpdater.on("update-not-available", (info) => {
    logDesktop(`Auto-update: no update available (current ${info?.version || app.getVersion()})`);
  });

  autoUpdater.on("error", (error) => {
    const message = error instanceof Error ? error.message : String(error);
    logDesktop(`Auto-update: error ${message}`);
  });

  autoUpdater.on("download-progress", (progress) => {
    const percent = Math.round(progress?.percent || 0);
    if (percent !== lastPercentLogged && (percent % 10 === 0 || percent >= 99)) {
      lastPercentLogged = percent;
      logDesktop(`Auto-update: download progress ${percent}%`);
    }
  });

  autoUpdater.on("update-downloaded", async (info) => {
    logDesktop(`Auto-update: update downloaded ${info?.version || "unknown-version"}`);
    try {
      const response = await dialog.showMessageBox(mainWindow, {
        type: "info",
        title: "Update Ready",
        message: "A new SingBetter AI update has been downloaded.",
        detail: "Restart now to apply it, or choose Later to apply on your next app restart.",
        buttons: ["Restart now", "Later"],
        defaultId: 0,
        cancelId: 1,
      });

      if (response.response === 0) {
        autoUpdater.quitAndInstall();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logDesktop(`Auto-update: restart prompt failed ${message}`);
    }
  });

  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      logDesktop(`Auto-update: check failed ${message}`);
    });
  }, UPDATE_CHECK_DELAY_MS);
};

const resolveDesktopIconPath = () => {
  const candidates = app.isPackaged
    ? [
        path.join(process.resourcesPath, "app.asar", "build", "icon.png"),
        path.join(process.resourcesPath, "build", "icon.png"),
        path.join(__dirname, "..", "build", "icon.png"),
      ]
    : [
        path.resolve(__dirname, "..", "build", "icon.png"),
        path.resolve(process.cwd(), "build", "icon.png"),
      ];

  for (const iconPath of candidates) {
    if (fs.existsSync(iconPath)) {
      return iconPath;
    }
  }
  return null;
};

const configureDesktopEnvironment = () => {
  const dataDir = app.getPath("userData");
  const uploadsDir = path.join(dataDir, "uploads");
  const dbPath = path.join(dataDir, "singbetter.db");
  const legacyDesktopDbPath = path.join(dataDir, "desktop.db");
  const secretPath = path.join(dataDir, "session.secret");

  ensureDir(dataDir);
  ensureDir(uploadsDir);

  const envDatabasePath = resolveFileDatabasePath(process.env.DATABASE_URL);
  const legacyProjectDbPath = path.resolve(process.cwd(), "dev.db");
  const legacyProdDbPath = path.resolve(process.cwd(), "prod-local.db");

  migrateDatabaseToUserData(dbPath, [
    envDatabasePath,
    legacyProjectDbPath,
    legacyProdDbPath,
    legacyDesktopDbPath,
  ]);

  process.env.NODE_ENV = "production";
  process.env.DESKTOP_APP = "1";
  process.env.HOST = APP_HOST;
  process.env.PORT = String(APP_PORT);
  process.env.DATABASE_URL = `file:${dbPath}`;
  process.env.USE_JSON_DB = "false";
  process.env.AUTH_PROVIDER = process.env.AUTH_PROVIDER || "local";
  process.env.UPLOADS_DRIVER = process.env.UPLOADS_DRIVER || "local";
  
  if (String(process.env.UPLOADS_DRIVER).toLowerCase() === "local") {
    process.env.ALLOW_LOCAL_UPLOADS_IN_PROD = "true";
  }
  process.env.UPLOADS_DIR = uploadsDir;
  process.env.SESSION_SECRET = loadOrCreateSessionSecret(secretPath);

  logDesktop(
    `Runtime paths desktopApp=${process.env.DESKTOP_APP} userData=${dataDir} db=${dbPath} uploads=${uploadsDir}`,
  );
};

const getServerEntryPath = () => path.resolve(__dirname, "..", "dist", "index.js");

const startEmbeddedServer = async () => {
  const serverEntry = getServerEntryPath();
  if (!fs.existsSync(serverEntry)) {
    throw new Error(
      `Desktop bundle is missing server build at: ${serverEntry}. Run 'npm run build' first.`,
    );
  }
  await import(pathToFileURL(serverEntry).href);
};

const createMainWindow = async () => {
  const windowIconPath = resolveDesktopIconPath();
  const mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1024,
    minHeight: 720,
    title: "SingBetter AI",
    autoHideMenuBar: true,
    ...(windowIconPath ? { icon: windowIconPath } : {}),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      devTools: !app.isPackaged,
    },
  });

  const appUrl = `http://${APP_HOST}:${APP_PORT}`;
  const appOrigin = new URL(appUrl).origin;
  await waitForServer(appUrl);
  await mainWindow.loadURL(appUrl);

  mainWindow.webContents.on("will-navigate", (event, url) => {
    const targetOrigin = (() => {
      try {
        return new URL(url).origin;
      } catch {
        return "";
      }
    })();
    if (targetOrigin !== appOrigin) {
      event.preventDefault();
      if (url.startsWith("http://") || url.startsWith("https://")) {
        shell.openExternal(url);
      }
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });

  return mainWindow;
};

const bootstrap = async () => {
  configureDesktopEnvironment();
  await startEmbeddedServer();
  const mainWindow = await createMainWindow();
  initAutoUpdates(mainWindow);
};

app.whenReady().then(async () => {
  try {
    await bootstrap();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    dialog.showErrorBox("Desktop Startup Error", message);
    app.quit();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", async () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    try {
      await createMainWindow();
    } catch (_error) {
      app.quit();
    }
  }
});
