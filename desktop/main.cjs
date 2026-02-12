const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const net = require("net");
const { spawn } = require("child_process");
const { app, BrowserWindow, shell, dialog } = require("electron");
const { autoUpdater } = require("electron-updater");

const APP_HOST = "127.0.0.1";
const APP_PORT = 5510;
const SERVER_READY_TIMEOUT_MS = 60000;
const SERVER_READY_RETRY_MS = 300;
const UPDATE_CHECK_DELAY_MS = 5000;
const DESKTOP_STARTUP_LOG_FILENAME = "desktop-startup.log";
const STARTUP_LOG_PREVIEW_LINES = 20;
let updaterInitialized = false;
let selectedPort = APP_PORT;
let startupLogPath = path.resolve(process.cwd(), DESKTOP_STARTUP_LOG_FILENAME);
let embeddedServerProcess = null;
let isQuittingApp = false;
let bootstrapCompleted = false;
const startupDebugEnabled = process.env.SINGBETTER_DEBUG_STARTUP === "1";

const logDesktop = (message) => {
  console.log(`[desktop] ${message}`);
};

const ensureDir = (targetPath) => {
  fs.mkdirSync(targetPath, { recursive: true });
};

const getStartupLogPath = () => {
  if (startupLogPath) return startupLogPath;
  try {
    const userDataDir = app.getPath("userData");
    ensureDir(userDataDir);
    startupLogPath = path.join(userDataDir, DESKTOP_STARTUP_LOG_FILENAME);
    return startupLogPath;
  } catch (_error) {
    // ignore and fallback
  }
  startupLogPath = path.resolve(process.cwd(), DESKTOP_STARTUP_LOG_FILENAME);
  return startupLogPath;
};

const appendStartupLog = (message, error) => {
  try {
    const logPath = getStartupLogPath();
    ensureDir(path.dirname(logPath));
    const errorSuffix = error
      ? ` | error=${error instanceof Error ? error.stack || error.message : String(error)}`
      : "";
    fs.appendFileSync(
      logPath,
      `[${new Date().toISOString()}] ${message}${errorSuffix}\n`,
      "utf8",
    );
  } catch (_err) {
    // Never fail desktop startup because logging failed.
  }
};

const readStartupLogTail = (lineCount = STARTUP_LOG_PREVIEW_LINES) => {
  try {
    const logPath = getStartupLogPath();
    if (!fs.existsSync(logPath)) return "(log file does not exist yet)";
    const lines = fs
      .readFileSync(logPath, "utf8")
      .split(/\r?\n/)
      .filter(Boolean);
    if (lines.length === 0) return "(log file is empty)";
    return lines.slice(-lineCount).join("\n");
  } catch (error) {
    return `Unable to read startup log tail: ${error instanceof Error ? error.message : String(error)}`;
  }
};

const showStartupFailureDialog = (error, title = "Desktop failed to start embedded server") => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  appendStartupLog(title, error);
  const details = [
    title,
    `Log file: ${getStartupLogPath()}`,
    "",
    "Recent log lines:",
    readStartupLogTail(),
  ].join("\n");
  dialog.showErrorBox("Desktop Startup Error", `${message}\n\n${details}`);
};

const installGlobalCrashHandlers = () => {
  process.on("uncaughtException", (error) => {
    appendStartupLog("Main process uncaughtException", error);
    showStartupFailureDialog(error);
    if (!bootstrapCompleted) {
      app.quit();
    }
  });

  process.on("unhandledRejection", (reason) => {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    appendStartupLog("Main process unhandledRejection", error);
    showStartupFailureDialog(error);
    if (!bootstrapCompleted) {
      app.quit();
    }
  });
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

const resolveDatabaseSource = (destinationPath, candidatePaths) => {
  if (fs.existsSync(destinationPath)) {
    return { source: "existing", migratedFrom: null };
  }

  try {
    const uniqueCandidates = [...new Set(candidatePaths.filter(Boolean))].filter(
      (candidate) => candidate !== destinationPath,
    );

    for (const sourcePath of uniqueCandidates) {
      if (!fs.existsSync(sourcePath)) continue;
      fs.copyFileSync(sourcePath, destinationPath);
      return { source: "migrated", migratedFrom: sourcePath };
    }
  } catch (_error) {
    // Fall through to fresh DB path creation.
  }

  // Ensure file path exists for first-time startup. Server schema init will populate tables.
  fs.closeSync(fs.openSync(destinationPath, "w"));
  return { source: "fresh", migratedFrom: null };
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

const isPortAvailable = (host, port) =>
  new Promise((resolve) => {
    const tester = net.createServer();
    tester.once("error", () => resolve(false));
    tester.once("listening", () => {
      tester.close(() => resolve(true));
    });
    tester.listen({ host, port });
  });

const resolveDesktopPort = async (host, preferredPort) => {
  if (await isPortAvailable(host, preferredPort)) return preferredPort;
  for (let offset = 1; offset <= 25; offset += 1) {
    const candidatePort = preferredPort + offset;
    if (await isPortAvailable(host, candidatePort)) {
      appendStartupLog(`Port ${preferredPort} is busy, using ${candidatePort} instead`);
      return candidatePort;
    }
  }
  throw new Error(
    `No free port found near ${preferredPort}. Close any process using localhost ports ${preferredPort}-${preferredPort + 25}.`,
  );
};

const waitForServer = async (url, serverProcess) => {
  const start = Date.now();
  appendStartupLog(`Waiting for server readiness at ${url}/api/health`);
  while (Date.now() - start < SERVER_READY_TIMEOUT_MS) {
    if (serverProcess && serverProcess.exitCode !== null) {
      throw new Error(
        `Embedded server exited before readiness (code=${serverProcess.exitCode}, signal=${serverProcess.signalCode || "none"})`,
      );
    }
    try {
      const response = await fetch(`${url}/api/health`, {
        method: "GET",
      });
      if (response.ok || response.status === 401 || response.status === 403) {
        appendStartupLog(`Embedded server ready at ${url}/api/health (status ${response.status})`);
        return;
      }
    } catch (error) {
      if (startupDebugEnabled) {
        appendStartupLog("Server health probe failed; retrying", error);
      }
    }
    await wait(SERVER_READY_RETRY_MS);
  }
  throw new Error(
    `Timed out while waiting for desktop server startup at ${url}/api/health after ${SERVER_READY_TIMEOUT_MS}ms`,
  );
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
  startupLogPath = path.join(dataDir, DESKTOP_STARTUP_LOG_FILENAME);

  ensureDir(dataDir);
  ensureDir(uploadsDir);
  appendStartupLog(`Desktop startup initialized userData=${dataDir}`);

  const envDatabasePath = resolveFileDatabasePath(process.env.DATABASE_URL);
  const legacyProjectDbPath = path.resolve(process.cwd(), "dev.db");
  const legacyProdDbPath = path.resolve(process.cwd(), "prod-local.db");

  let dbSource = "fresh";
  let migratedFrom = null;
  try {
    const resolved = resolveDatabaseSource(dbPath, [
      envDatabasePath,
      legacyProjectDbPath,
      legacyProdDbPath,
      legacyDesktopDbPath,
    ]);
    dbSource = resolved.source;
    migratedFrom = resolved.migratedFrom;
  } catch (error) {
    appendStartupLog("DB source resolution failed; continuing with fresh DB path", error);
    try {
      if (!fs.existsSync(dbPath)) {
        fs.closeSync(fs.openSync(dbPath, "w"));
      }
    } catch (fileError) {
      appendStartupLog("Failed to create fresh DB placeholder file", fileError);
    }
  }

  process.env.NODE_ENV = "production";
  process.env.DESKTOP_APP = "1";
  process.env.HOST = APP_HOST;
  process.env.PORT = String(selectedPort);
  process.env.DATABASE_URL = `file:${dbPath}`;
  process.env.USE_JSON_DB = "false";
  process.env.AUTH_PROVIDER = process.env.AUTH_PROVIDER || "local";
  process.env.UPLOADS_DRIVER = process.env.UPLOADS_DRIVER || "local";
  
  if (String(process.env.UPLOADS_DRIVER).toLowerCase() === "local") {
    process.env.ALLOW_LOCAL_UPLOADS_IN_PROD = "true";
  }
  process.env.UPLOADS_DIR = uploadsDir;
  process.env.SESSION_SECRET = loadOrCreateSessionSecret(secretPath);
  process.env.STARTUP_LOG_PATH = startupLogPath;
  process.env.CORS_ALLOWED_ORIGINS = `http://${APP_HOST}:${selectedPort}`;

  if (migratedFrom) {
    logDesktop(`DB resolved at: ${dbPath} (source: migrated)`);
    logDesktop(`DB migration source: ${migratedFrom}`);
  } else {
    logDesktop(`DB resolved at: ${dbPath} (source: ${dbSource})`);
  }
  logDesktop(
    `Runtime paths desktopApp=${process.env.DESKTOP_APP} userData=${dataDir} db=${dbPath} uploads=${uploadsDir} port=${selectedPort}`,
  );
  appendStartupLog(
    `Runtime configured host=${APP_HOST} port=${selectedPort} db=${dbPath} uploads=${uploadsDir} debug=${startupDebugEnabled ? "1" : "0"}`,
  );

  if (startupDebugEnabled) {
    appendStartupLog(
      `Debug startup details cwd=${process.cwd()} resourcesPath=${process.resourcesPath} appPath=${app.getAppPath()}`,
    );
  }
};

const getServerEntryPath = () => {
  const candidates = app.isPackaged
    ? [
        path.join(process.resourcesPath, "app.asar", "dist", "index.js"),
        path.join(process.resourcesPath, "dist", "index.js"),
        path.resolve(__dirname, "..", "dist", "index.js"),
      ]
    : [path.resolve(__dirname, "..", "dist", "index.js")];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return candidates[0];
};

const startEmbeddedServer = async () => {
  const serverEntry = getServerEntryPath();
  if (!fs.existsSync(serverEntry)) {
    throw new Error(
      `Desktop bundle is missing server build at: ${serverEntry}. Run 'npm run build' first.`,
    );
  }

  const serverEnv = {
    ...process.env,
    NODE_ENV: "production",
    DESKTOP_APP: "1",
    HOST: APP_HOST,
    PORT: String(selectedPort),
    ELECTRON_RUN_AS_NODE: "1",
  };
  const serverCwd = app.isPackaged
    ? process.resourcesPath
    : path.resolve(__dirname, "..");

  appendStartupLog(
    `Spawning embedded server command=${process.execPath} arg=${serverEntry} cwd=${serverCwd} host=${APP_HOST} port=${selectedPort}`,
  );

  const child = spawn(process.execPath, [serverEntry], {
    cwd: serverCwd,
    env: serverEnv,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  embeddedServerProcess = child;

  child.stdout.on("data", (chunk) => {
    const output = chunk.toString().trim();
    if (!output) return;
    appendStartupLog(`[server:stdout] ${output}`);
    if (startupDebugEnabled) {
      logDesktop(`[server:stdout] ${output}`);
    }
  });

  child.stderr.on("data", (chunk) => {
    const output = chunk.toString().trim();
    if (!output) return;
    appendStartupLog(`[server:stderr] ${output}`);
    logDesktop(`[server:stderr] ${output}`);
  });

  child.on("error", (error) => {
    appendStartupLog("Embedded server child process error", error);
    if (!bootstrapCompleted) {
      showStartupFailureDialog(error);
      app.quit();
    }
  });

  child.on("exit", (code, signal) => {
    appendStartupLog(`Embedded server child exited code=${code ?? "null"} signal=${signal ?? "null"}`);
    if (!bootstrapCompleted && !isQuittingApp) {
      showStartupFailureDialog(
        new Error(`Embedded server exited before startup completed (code=${code ?? "null"}, signal=${signal ?? "null"})`),
      );
      app.quit();
    }
  });

  return child;
};

const createMainWindow = async (serverUrl) => {
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
      devTools: !app.isPackaged || startupDebugEnabled,
    },
  });

  const appOrigin = new URL(serverUrl).origin;
  await mainWindow.loadURL(serverUrl);

  if (startupDebugEnabled) {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }

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
  selectedPort = await resolveDesktopPort(APP_HOST, APP_PORT);
  configureDesktopEnvironment();
  const serverUrl = `http://${APP_HOST}:${selectedPort}`;
  const child = await startEmbeddedServer();
  await waitForServer(serverUrl, child);
  const mainWindow = await createMainWindow(serverUrl);
  bootstrapCompleted = true;
  appendStartupLog(`Desktop startup completed successfully at ${serverUrl}`);
  initAutoUpdates(mainWindow);
};

app.whenReady().then(async () => {
  try {
    await bootstrap();
  } catch (error) {
    showStartupFailureDialog(error);
    app.quit();
  }
});

installGlobalCrashHandlers();

app.on("before-quit", () => {
  isQuittingApp = true;
  if (embeddedServerProcess && embeddedServerProcess.exitCode === null) {
    appendStartupLog("Stopping embedded server process");
    embeddedServerProcess.kill();
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
      const serverUrl = `http://${APP_HOST}:${selectedPort}`;
      await waitForServer(serverUrl, embeddedServerProcess);
      await createMainWindow(serverUrl);
    } catch (_error) {
      app.quit();
    }
  }
});
