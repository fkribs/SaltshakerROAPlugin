const ROA_RESOURCE = "roaSaveFile";

// IP:port pattern that ROA writes into the save file as ConnectionString
const CONNECTION_STRING_RE = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}:\d{2,5})/;
const MARKER = "ConnectionString";

function extractConnectionString(buf) {
  for (let i = 0; i < buf.length - MARKER.length; i++) {
    let match = true;
    for (let j = 0; j < MARKER.length; j++) {
      if (buf[i + j] !== MARKER.charCodeAt(j)) { match = false; break; }
    }
    if (!match) continue;

    // Search the next 256 bytes for an IP:port pattern
    const slice = buf.slice(i, i + 256).toString("latin1");
    const m = slice.match(CONNECTION_STRING_RE);
    if (m) return m[1];
  }
  return null;
}

// djb2 hash — no imports needed
function hashConnectionString(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (((hash << 5) + hash) ^ str.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

const ROAPlugin = {
  async onInit(api) {
    api.log("[ROAPlugin] Initializing...");

    let currentRoomCode = null;
    let disposing = false;

    async function checkSaveFile() {
      if (disposing) return;
      try {
        const buf = await api.host.file.readBinary(ROA_RESOURCE);
        const connectionString = extractConnectionString(buf);

        if (!connectionString) {
          if (currentRoomCode) {
            const roomCode = currentRoomCode;
            currentRoomCode = null;
            api.log(`[ROAPlugin] No ConnectionString found; disconnect(${roomCode})`);
            api.sendEvent("disconnect", roomCode);
          }
          return;
        }

        const roomCode = hashConnectionString(connectionString);
        api.log(`[ROAPlugin] ConnectionString="${connectionString}" → roomCode=${roomCode}`);

        if (currentRoomCode === roomCode) return;

        if (currentRoomCode) {
          api.log(`[ROAPlugin] Connection changed; disconnect(${currentRoomCode})`);
          api.sendEvent("disconnect", currentRoomCode);
        }

        currentRoomCode = roomCode;
        api.log(`[ROAPlugin] connect(${roomCode}) — ${connectionString}`);
        api.sendEvent("connect", roomCode);
      } catch (e) {
        api.log("[ROAPlugin] Error reading save file (non-fatal):", e?.message || e);
      }
    }

    await api.host.file.watchFile(ROA_RESOURCE);

    // Initial read so we catch an already-running match on plugin start
    await checkSaveFile();

    const disposeFileChanged = api.on("file:changed", async ({ resourceId }) => {
      if (resourceId !== ROA_RESOURCE) return;
      await checkSaveFile();
    });

    this._dispose = async () => {
      if (disposing) return;
      disposing = true;

      if (currentRoomCode) {
        const roomCode = currentRoomCode;
        currentRoomCode = null;
        api.log(`[ROAPlugin] Disposing; disconnect(${roomCode})`);
        api.sendEvent("disconnect", roomCode);
      }

      try { disposeFileChanged(); } catch (e) { api.log("[ROAPlugin] disposeFileChanged error", e); }

      try {
        await api.host.file.unwatchFile(ROA_RESOURCE);
      } catch (e) {
        api.log("[ROAPlugin] unwatchFile failed (non-fatal):", e?.message || e);
      }

      api.log("[ROAPlugin] Disposed.");
    };
  },

  async onDispose() {
    if (typeof this._dispose === "function") return this._dispose();
  }
};

module.exports = ROAPlugin;
