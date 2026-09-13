import { GOOGLE_CLIENT_ID, DRIVE_SCOPES, DRIVE_FOLDER_NAME, DRIVE_API_KEY } from "./config.js";

// Thin wrapper around Google Identity Services (auth) + the Drive v3 REST
// API (file CRUD), called directly via fetch so no gapi client is needed.

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const FOLDER_MIME = "application/vnd.google-apps.folder";

let tokenClient = null;
let accessToken = null;
let folderId = null;
let signedInListeners = [];

// The access token itself is never persisted (it's short-lived and GIS
// gives no way to store/reuse one across a page load anyway) — only
// whether the user had actively chosen Drive, so boot() knows whether it's
// worth attempting a silent reauth at all.
const WAS_SIGNED_IN_KEY = "engnb-drive-signed-in";

export function wasSignedIn() {
  return localStorage.getItem(WAS_SIGNED_IN_KEY) === "1";
}

export function onSignedInChange(fn) {
  signedInListeners.push(fn);
  return () => {
    signedInListeners = signedInListeners.filter((f) => f !== fn);
  };
}

function setToken(token) {
  accessToken = token;
  signedInListeners.forEach((fn) => fn(isSignedIn()));
}

export function isSignedIn() {
  return !!accessToken;
}

export function initGoogleAuth() {
  return new Promise((resolve, reject) => {
    if (!window.google || !window.google.accounts) {
      reject(new Error("Google Identity Services script did not load."));
      return;
    }
    tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: DRIVE_SCOPES,
      callback: () => {}, // overridden per-call in signIn()
    });
    resolve();
  });
}

export function signIn() {
  return new Promise((resolve, reject) => {
    if (!tokenClient) {
      reject(new Error("Google auth not initialized."));
      return;
    }
    tokenClient.callback = (response) => {
      if (response.error) {
        reject(response);
        return;
      }
      setToken(response.access_token);
      localStorage.setItem(WAS_SIGNED_IN_KEY, "1");
      resolve(response);
    };
    tokenClient.requestAccessToken({ prompt: "" });
  });
}

// Access tokens don't survive a page reload (GIS keeps them in memory
// only), so boot() calls this to try reacquiring one without interrupting
// the user. In practice, GIS still opens an actual popup window even with
// prompt: "none" — called with no user gesture behind it (as boot() does),
// the browser blocks that popup, and GIS's callback never fires at all in
// that failure mode (it's a browser-level block, not a GIS-level auth
// error it can report through the normal channel). Without the timeout
// below, that leaves the returned promise hanging forever — which would
// otherwise also block whatever awaits this call from ever reaching its
// own fallback logic.
export function trySilentSignIn() {
  return new Promise((resolve) => {
    if (!tokenClient) {
      resolve(false);
      return;
    }
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      console.warn("Drive silent reauth timed out (likely a blocked popup — no user gesture at boot).");
      resolve(false);
    }, 3000);
    tokenClient.callback = (response) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (response.error) {
        console.warn("Drive silent reauth failed:", response.error, response.error_description || "");
        resolve(false);
        return;
      }
      setToken(response.access_token);
      resolve(true);
    };
    tokenClient.requestAccessToken({ prompt: "none" });
  });
}

export function signOut() {
  if (accessToken && window.google?.accounts?.oauth2) {
    window.google.accounts.oauth2.revoke(accessToken, () => {});
  }
  setToken(null);
  folderId = null;
  localStorage.removeItem(WAS_SIGNED_IN_KEY);
}

function authHeaders(extra = {}) {
  if (!accessToken) throw new Error("Not signed in to Google Drive.");
  return { Authorization: `Bearer ${accessToken}`, ...extra };
}

async function driveFetch(path, options = {}) {
  const res = await fetch(`${DRIVE_API}${path}`, {
    ...options,
    headers: authHeaders(options.headers),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Drive API error ${res.status}: ${body}`);
  }
  return res;
}

// Grants "anyone with the link can view" on one file — needed before a
// share link is usable at all, since drive.file-scoped files are private
// to the app/owner by default. Idempotent: calling it again on an
// already-shared file just re-applies the same permission.
export async function shareFile(fileId) {
  await driveFetch(`/files/${fileId}/permissions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role: "reader", type: "anyone" }),
  });
}

// The read-only viewer path: a recipient opening a share link has no
// Google sign-in at all (that's the point), so this can't use an OAuth
// Bearer token like every other read in this file — it authenticates the
// REQUEST with the project-level API key instead, relying on the file's
// own "anyone with the link" permission (set by shareFile above) to allow
// the read.
export async function loadSheetContentPublic(fileId) {
  const res = await fetch(`${DRIVE_API}/files/${fileId}?alt=media&key=${DRIVE_API_KEY}`);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Couldn't load shared sheet (${res.status}): ${body}`);
  }
  return res.json();
}

export async function ensureFolder() {
  if (folderId) return folderId;
  const q = encodeURIComponent(
    `name='${DRIVE_FOLDER_NAME}' and mimeType='${FOLDER_MIME}' and trashed=false`
  );
  const res = await driveFetch(`/files?q=${q}&fields=files(id,name)`);
  const data = await res.json();
  if (data.files && data.files.length > 0) {
    folderId = data.files[0].id;
    return folderId;
  }
  const createRes = await driveFetch("/files", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: DRIVE_FOLDER_NAME, mimeType: FOLDER_MIME }),
  });
  const created = await createRes.json();
  folderId = created.id;
  return folderId;
}

export async function listSheetFiles() {
  const parent = await ensureFolder();
  const q = encodeURIComponent(
    `'${parent}' in parents and mimeType='application/json' and trashed=false`
  );
  const res = await driveFetch(
    `/files?q=${q}&fields=files(id,name,modifiedTime)&orderBy=modifiedTime desc&pageSize=1000`
  );
  const data = await res.json();
  return data.files || [];
}

export async function loadSheetContent(fileId) {
  const res = await driveFetch(`/files/${fileId}?alt=media`);
  return res.json();
}

function slugify(title) {
  return (
    String(title)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "untitled"
  );
}

function buildMultipartBody(metadata, sheetObject) {
  const boundary = "engnb-" + Math.random().toString(16).slice(2);
  const content = JSON.stringify(sheetObject, null, 2);
  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: application/json\r\n\r\n` +
    `${content}\r\n` +
    `--${boundary}--`;
  return { body, boundary };
}

export async function saveSheet(fileId, sheetObject) {
  const name = `${slugify(sheetObject.title)}.json`;
  if (fileId) {
    const { body, boundary } = buildMultipartBody({ name }, sheetObject);
    const res = await fetch(
      `${DRIVE_UPLOAD_API}/files/${fileId}?uploadType=multipart&fields=id,name,modifiedTime`,
      {
        method: "PATCH",
        headers: authHeaders({
          "Content-Type": `multipart/related; boundary=${boundary}`,
        }),
        body,
      }
    );
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Drive save failed ${res.status}: ${errText}`);
    }
    return (await res.json()).id;
  }

  const parent = await ensureFolder();
  const { body, boundary } = buildMultipartBody(
    { name, parents: [parent] },
    sheetObject
  );
  const res = await fetch(
    `${DRIVE_UPLOAD_API}/files?uploadType=multipart&fields=id,name,modifiedTime`,
    {
      method: "POST",
      headers: authHeaders({
        "Content-Type": `multipart/related; boundary=${boundary}`,
      }),
      body,
    }
  );
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Drive create failed ${res.status}: ${errText}`);
  }
  return (await res.json()).id;
}

export async function deleteSheet(fileId) {
  await driveFetch(`/files/${fileId}`, { method: "DELETE" });
}
