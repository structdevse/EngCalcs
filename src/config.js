// Fill in GOOGLE_CLIENT_ID with your own OAuth 2.0 Web Application client ID
// from console.cloud.google.com (see engineering-notebook-plan.md, "Google
// Drive API Setup"). The app will not be able to sign in until this is set.
export const GOOGLE_CLIENT_ID = "405776576287-bv74vor36iimkq2r6fhikp8dd8cek9qu.apps.googleusercontent.com";

export const DRIVE_SCOPES = "https://www.googleapis.com/auth/drive.file";

// A separate credential from GOOGLE_CLIENT_ID above — an API key (Cloud
// Console → Credentials → Create Credentials → API key), not an OAuth
// client. Needed only for the read-only shared-link viewer: a recipient
// opening a ?file=... link has no Google sign-in at all, so fetching that
// one file has to be identified by this project-level key instead of a
// user's OAuth token. Restrict it (HTTP referrers + Drive API only) in the
// console — see engineering-notebook-plan.md. Sharing won't work until set.
export const DRIVE_API_KEY = "AIzaSyCBa8c0PbEsafnM3ERodGXiPW07ZhhBr5w";

export const DRIVE_FOLDER_NAME = "EngineeringNotebook";

export const AUTOSAVE_DELAY_MS = 2000;
