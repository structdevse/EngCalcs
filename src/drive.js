import { GOOGLE_CLIENT_ID, DRIVE_SCOPES, DRIVE_FOLDER_NAME } from "./config.js";

// Thin wrapper around Google Identity Services (auth) + the Drive v3 REST
// API (file CRUD), called directly via fetch so no gapi client is needed.

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const FOLDER_MIME = "application/vnd.google-apps.folder";

let tokenClient = null;
let accessToken = null;
let folderId = null;
let signedInListeners = [];

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
      resolve(response);
    };
    tokenClient.requestAccessToken({ prompt: "" });
  });
}

export function signOut() {
  if (accessToken && window.google?.accounts?.oauth2) {
    window.google.accounts.oauth2.revoke(accessToken, () => {});
  }
  setToken(null);
  folderId = null;
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
