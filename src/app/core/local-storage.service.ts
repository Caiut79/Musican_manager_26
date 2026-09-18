/**
 * LocalStorageService
 *
 * Centralises every `mm_*` key used across the app.
 * - Single source of truth for key names (no magic strings in components)
 * - Type-safe JSON get/set with safe-parse
 * - Domain helpers that mirror the shape components actually need
 * - Change notifications via StorageEvent (cross-tab sync)
 * - Optional transparent AES-GCM encryption for sensitive keys (opt-in, backward-compat)
 */
import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';
import { EventDetail } from '../models/event-detail';

/** 📝 Formato delle note che vengono inviate a Google Calendar nel campo
 *  `description` di ogni evento. Ogni flag booleano decide se includere
 *  o meno la rispettiva riga. Se tutti sono false, la description non
 *  viene impostata proprio. */
export type GoogleNoteFormat = {
  includeVenue: boolean;
  includeAddress: boolean;
  includeBand: boolean;
  includeType: boolean;
  includeStatus: boolean;
  includeGrossFee: boolean;
  includeNetFee: boolean;
  includeCompensoType: boolean;
  includeTimes: boolean;
  includeNotes: boolean;
  includeAppFooter: boolean;
};

/** Valore di default usato quando l'utente non ha ancora salvato una
 *  preferenza personale (backward compat). Tutti true tranne il
 *  footer "Musicista Manager" che è disattivato di default. */
export const DEFAULT_NOTE_FORMAT: GoogleNoteFormat = {
  includeVenue: true,
  includeAddress: true,
  includeBand: true,
  includeType: true,
  includeStatus: true,
  includeGrossFee: true,
  includeNetFee: true,
  includeCompensoType: true,
  includeTimes: true,
  includeNotes: true,
  includeAppFooter: false,
};

export type GcalSettings = {
  selectedCalendarId?: string;
  selectedCalendarSummary?: string;
  lastSyncAt?: string;
  lastSyncReport?: { imported: number; updated: number; skipped: number; conflicts: number };
  /** Client ID OAuth 2.0 (xxx.apps.googleusercontent.com). Può essere inserito
   *  dalla UI nella scheda Integrazioni Google, oppure caricato da assets/google.config.json.
   *  Se valorizzato qui, vince sul file di configurazione statico. */
  clientId?: string;
  /** Scope OAuth salvati per riferimento (default calendar.events) */
  scopes?: string[];
  /** Access token OAuth 2.0 (durata max 1h). Salvato in localStorage al posto
   *  che solo in memoria COSÌ NON PERDIAMO LA CONNESSIONE dopo un F5/ricarica.
   *  La persistenza è sicura in contesto SPA + localStorage già usato per TUTTI
   *  i dati dell'app (eventi, fatture, ecc). */
  accessToken?: string;
  /** Scadenza token in ms (epoca Unix Date.now()). Quando Date.now() supera
   *  questo valore, il token è da considerare scaduto. */
  tokenExpiresAt?: number;
  /** Email account Google connesso, per label "Connesso come claudio@gmail.com" */
  connectedEmail?: string;
  /** ⭐ DATA DI INIZIO SINCRO (cutoff): EVENTI PRECEDENTI A QUESTA DATA
   *  IGNORATI COMPLETAMENTE:
   *  - ❌ NON vengono IMPORTATI da Google (nemmeno se esistono nel calendario)
   *  - ❌ NON vengono INVIATI / AGGIORNATI / CANCELLATI da app → Google
   *    (nemmeno se per sbaglio ci fossero eventi storici salvati in locale)
   *  Formato YYYY-MM-DD. Se non presente: default oggi - 1 giorno.
   *  Scopo Claudio: "sincronizza le date sulla app dal 17 settembre 2026
   *  dal calendario google e da li in poi fanno la sincronizzazione tra uno e l'altro"
   */
  syncStartDate?: string;
  /** 📝 Formato Note Google: decide quali righe includere nel campo
   *  description di ogni evento inviato a Google Calendar.
   *  Contiene 11 booleani (GoogleNoteFormat). Se undefined → default. */
  noteFormat?: GoogleNoteFormat;
};

// ─── Key registry ─────────────────────────────────────────────────────────────
// Every localStorage key used anywhere in the app is declared here.
export const LS = {
  // ── Identity ──────────────────────────────────────────────────────────────
  AUTH_USER_ID:           'mm_auth_user_id',
  MUSICIAN_ID:            'musicianId',
  AFFILIATION_CODE:       'mm_affiliation_code',
  AFFILIATION_CODE_LEGACY:'musicianCode',           // kept for backward compat reads
  LICENSE_REF:            'mm_license_ref',
  LICENSE_APP:            'mm_license_app',
  USER_EMAIL:             'mm_user_email',
  APP_SCHEMA_VERSION:     'mm_app_schema_version',
  ENCRYPTION_ENABLED:     'mm_encryption_enabled',

  // ── Profile ───────────────────────────────────────────────────────────────
  PROFILE_SNAPSHOT:       'mm_profile_snapshot',
  FIRST_NAME:             'mm_firstName',
  LAST_NAME:              'mm_lastName',
  PHONE:                  'mm_phone',
  HOME_BASE:              'mm_homeBase',
  FISCAL_CODE:            'mm_fiscalCode',
  SIGNATURE:              'mm_signature',
  SETTINGS:               'mm_settings',
  MUSICIAN_ROLE_CODE:     'mm_musician_role_code',
  DJ_CODE:                'mm_dj_code',

  // ── Data collections ──────────────────────────────────────────────────────
  EVENTS:                 'mm_events',
  CONCERTS:               'mm_concerts',
  SERVICE_PAYMENTS:       'mm_service_payments',
  BAND_CREDITS:           'mm_band_credits',
  EXPENSES:               'mm_expenses',
  CONTACTS:               'mm_contacts',
  BOOKING_REQUESTS:       'mm_booking_requests',
  NOTIFICATIONS:          'mm_notifications',
  CONTRACTS:              'mm_contracts',
  INVOICES:               'mm_invoices',
  ARCHIVE_DIRECTORY:      'mm_archive_directory',

  // ── Invoicing ─────────────────────────────────────────────────────────────
  INVOICE_ISSUER_MUSICIAN:'mm_invoice_issuer_musician',
  INVOICE_ISSUER_TEACHER: 'mm_invoice_issuer_teacher',
  /** Dynamic: call `LS.invoiceSeq(role, year)` */
  invoiceSeq: (role: 'musician' | 'teacher', year: number) =>
    `mm_invoice_seq_${role}_${year}`,

  // ── App / UI state ────────────────────────────────────────────────────────
  THEME:                  'mm_theme',

  // ── Google Calendar sync settings ─────────────────────────────────────────
  GCAL_SETTINGS:          'mm_gcal_settings',

  // ── Vehicle / fuel settings ───────────────────────────────────────────────
  FUEL_PRICE:             'mm_fuelPricePerLiter',
  VEHICLE_CONSUMPTION:    'mm_vehicleConsumption',
  TOLLGURU_API_KEY:       'mm_tollguru_api_key',
  TOLLGURU_VEHICLE_TYPE:  'mm_tollguru_vehicle_type',

  // ── Context passing (dashboard ↔ expenses / concerts ↔ expenses) ──────────
  DASHBOARD_EXPENSE_CTX:  'mm_dashboard_expense_context',
  DASHBOARD_EXPENSE_RES:  'mm_dashboard_expense_result',
  CONCERT_EXPENSE_CTX:    'mm_concert_expense_context',
  CONCERT_EXPENSE_RES:    'mm_concert_expense_result',
} as const;

/**
 * Elenco delle chiavi considerate sensibili. Se la cifratura è attiva
 * (`encryptionEnabled` → true), solo queste vengono cifrate; le altre
 * rimangono in chiaro per velocizzare i getter diretti.
 * Backward-compat: i valori in chiaro esistenti vengono migrati
 * automaticamente alla prima scrittura tramite il servizio.
 */
const SENSITIVE_KEYS: ReadonlySet<string> = new Set<string>([
  LS.PROFILE_SNAPSHOT,
  LS.FISCAL_CODE,
  LS.SIGNATURE,
  LS.PHONE,
  LS.HOME_BASE,
  LS.USER_EMAIL,
  LS.INVOICE_ISSUER_MUSICIAN,
  LS.INVOICE_ISSUER_TEACHER,
  LS.CONTRACTS,
  LS.INVOICES,
  LS.EXPENSES,
  LS.SERVICE_PAYMENTS,
  LS.CONTACTS,
  LS.BOOKING_REQUESTS,
  LS.NOTIFICATIONS,
  LS.TOLLGURU_API_KEY,
]);

// ─── Types ────────────────────────────────────────────────────────────────────
export interface LsChangeEvent {
  key: string;
  oldValue: string | null;
  newValue: string | null;
}

interface EncryptedEnvelope {
  __mm_encrypted: true;
  v: 1;
  alg: 'AES-GCM';
  kid: string;
  iv: string;
  ct: string;
}

// ─── Crypto helpers (trasparenti, backward compat) ───────────────────────────
const CRYPTO_PASS_SALT_NS = 'mm.crypto.storage.salt.v1';
const CRYPTO_KID_STORAGE_KEY = 'mm_encryption_kid_v1';
const CRYPTO_WRAPPED_KEY = 'mm_encryption_wrapped_v1';

function toB64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
function fromB64(str: string): Uint8Array {
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function canUseCrypto(): boolean {
  return typeof window !== 'undefined' &&
    typeof window.crypto !== 'undefined' &&
    typeof window.crypto.subtle !== 'undefined' &&
    typeof window.crypto.subtle.importKey === 'function';
}
async function deriveDeviceKey(passSalt: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  // Usiamo un "fingerprint" del dispositivo + costante come sorgente per PBKDF2.
  // Il seed locale assicura che la stessa chiave venga riutilizzata tra riavvii
  // sullo stesso browser (se localStorage è intatto).
  const seedRaw = localStorage.getItem(CRYPTO_KID_STORAGE_KEY);
  let seed: Uint8Array;
  if (seedRaw) {
    seed = fromB64(seedRaw);
  } else {
    seed = new Uint8Array(32);
    window.crypto.getRandomValues(seed);
    localStorage.setItem(CRYPTO_KID_STORAGE_KEY, toB64(seed));
  }
  const base = enc.encode(passSalt + '::' + toB64(seed));
  const keyMaterial = await window.crypto.subtle.importKey(
    'raw',
    base,
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );
  return window.crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode(passSalt), iterations: 120_000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}
async function encryptAes(key: CryptoKey, plaintext: string): Promise<EncryptedEnvelope> {
  const enc = new TextEncoder();
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const ct = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    enc.encode(plaintext)
  );
  return {
    __mm_encrypted: true,
    v: 1,
    alg: 'AES-GCM',
    kid: 'local',
    iv: toB64(iv.buffer),
    ct: toB64(ct),
  };
}
async function decryptAes(key: CryptoKey, env: EncryptedEnvelope): Promise<string | null> {
  try {
    const iv = fromB64(env.iv);
    const ct = fromB64(env.ct);
    const out = await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv.buffer.slice(iv.byteOffset, iv.byteOffset + iv.byteLength) as ArrayBuffer },
      key,
      ct.buffer.slice(ct.byteOffset, ct.byteOffset + ct.byteLength) as ArrayBuffer
    );
    return new TextDecoder().decode(out);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'errore decifratura';
    console.warn('[LocalStorageService] decifratura fallita:', msg);
    return null;
  }
}
function isEncryptedEnvelope(raw: unknown): raw is EncryptedEnvelope {
  if (!raw || typeof raw !== 'object') return false;
  return (raw as EncryptedEnvelope).__mm_encrypted === true;
}

// ─── Service ──────────────────────────────────────────────────────────────────
@Injectable({ providedIn: 'root' })
export class LocalStorageService {
  /**
   * Emits on `window.storage` events (cross-tab changes only – not same-tab).
   * Subscribe in components or services that need to react to external changes.
   */
  readonly changes$ = new Subject<LsChangeEvent>();

  /**
   * Abilita la cifratura trasparente sulle chiavi sensibili.
   * Default: false, per mantenere la massima backward-compatibilità
   * con le chiamate dirette `localStorage.getItem` sparse per i componenti.
   * Quando lo imposti a true, i dati esistenti vengono migrati in modo
   * lazy (prima scrittura sul servizio) e le nuove scritture sono cifrate.
   */
  get encryptionEnabled(): boolean {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem(LS.ENCRYPTION_ENABLED) === '1';
  }
  set encryptionEnabled(value: boolean) {
    if (typeof window === 'undefined') return;
    localStorage.setItem(LS.ENCRYPTION_ENABLED, value ? '1' : '0');
  }

  private cryptoKeyPromise: Promise<CryptoKey> | null = null;
  private cryptoUnsupported: boolean = false;

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('storage', (ev) => {
        if (ev.key !== null) {
          this.changes$.next({
            key: ev.key,
            oldValue: ev.oldValue,
            newValue: ev.newValue,
          });
        }
      });
      if (!canUseCrypto()) this.cryptoUnsupported = true;
    } else {
      this.cryptoUnsupported = true;
    }
  }

  // ─── Primitives encryption-aware ──────────────────────────────────────────

  private async getCryptoKey(): Promise<CryptoKey | null> {
    if (this.cryptoUnsupported) return null;
    if (!this.cryptoKeyPromise) {
      try {
        this.cryptoKeyPromise = deriveDeviceKey(CRYPTO_PASS_SALT_NS);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'errore init chiave';
        console.warn('[LocalStorageService] crypto key init fallita:', msg);
        this.cryptoUnsupported = true;
        this.cryptoKeyPromise = null;
        return null;
      }
    }
    try {
      return await this.cryptoKeyPromise;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'errore chiave';
      console.warn('[LocalStorageService] crypto key resolve fallita:', msg);
      this.cryptoUnsupported = true;
      this.cryptoKeyPromise = null;
      return null;
    }
  }

  private isSensitiveKey(key: string): boolean {
    return SENSITIVE_KEYS.has(key);
  }

  private async writeMaybeEncrypted(key: string, payload: string): Promise<void> {
    if (this.encryptionEnabled && this.isSensitiveKey(key)) {
      const ck = await this.getCryptoKey();
      if (ck) {
        try {
          const env = await encryptAes(ck, payload);
          localStorage.setItem(key, JSON.stringify(env));
          return;
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : 'errore cifratura';
          console.warn('[LocalStorageService] cifratura fallita, fallback in chiaro:', msg);
        }
      }
    }
    localStorage.setItem(key, payload);
  }

  private async readMaybeDecrypted(key: string): Promise<string | null> {
    const raw = localStorage.getItem(key);
    if (raw === null) return null;
    // Caso 1: valore in chiaro (sempre valido, anche con cifratura attiva - backward compat)
    // Caso 2: valore cifrato - prova a decifrare, altrimenti fallback null con warn
    if (raw.trimStart().startsWith('{')) {
      let parsed: unknown;
      try { parsed = JSON.parse(raw); } catch { return raw; }
      if (isEncryptedEnvelope(parsed)) {
        const ck = await this.getCryptoKey();
        if (!ck) {
          console.warn('[LocalStorageService] chiave cifrata ma crypto non disponibile:', key);
          return null;
        }
        const dec = await decryptAes(ck, parsed);
        if (dec === null) {
          console.warn('[LocalStorageService] valore non decifrabile, scartato:', key);
          // Rimuoviamo il valore corrotto per evitare loop infiniti di errore
          localStorage.removeItem(key);
          return null;
        }
        return dec;
      }
      return raw;
    }
    return raw;
  }

  // ─── Primitives pubblici (compatibili con chiamate esistenti) ─────────────

  /** Read a raw string value. Returns `null` when absent. */
  getString(key: string): string | null {
    // Nota: ritorna il valore raw per mantenere compatibilità con componenti
    // che non vogliono attendere la decifratura (async). Per valori sensibili
    // usa `getStringAsync` o i metodi JSON `get`/`getArray`.
    const raw = localStorage.getItem(key);
    if (raw === null) return null;
    if (this.encryptionEnabled && this.isSensitiveKey(key)) {
      // Se l'utente ha abilitato la cifratura, proviamo a parsare per vedere
      // se è una busta crittografica; in quel caso i getter sinceri non possono
      // decifrare in modo bloccante (SubtleCrypto è solo async) → torniamo null
      // per non esporre il testo cifrato come stringa grezza.
      if (raw.trimStart().startsWith('{')) {
        try {
          const p = JSON.parse(raw);
          if (isEncryptedEnvelope(p)) {
            console.warn(
              `[LocalStorageService] getString("${key}"): valore cifrato, usa getStringAsync/await.`
            );
            return null;
          }
        } catch { /* non JSON, torniamo raw */ }
      }
    }
    return raw;
  }

  /** Read a raw string value, decrypting if needed. Safe for sensitive keys. */
  async getStringAsync(key: string): Promise<string | null> {
    return this.readMaybeDecrypted(key);
  }

  /** Write a raw string value. When encryption is on, sensitive keys are encrypted. */
  setString(key: string, value: string): void {
    if (this.encryptionEnabled && this.isSensitiveKey(key)) {
      // Fire-and-forget async write (localStorage.setItem viene chiamato
      // internamente solo dopo la cifratura, e in caso di errore fa fallback
      // in chiaro). Non ritorniamo Promise per mantenere firma sincrona.
      void this.writeMaybeEncrypted(key, value);
      return;
    }
    localStorage.setItem(key, value);
  }

  /**
   * Parse a JSON value. Returns `defaultValue` on missing key or parse error.
   * Use `getArray<T>` for arrays (guarantees an array even on corrupt data).
   * Quando la cifratura è attiva legge in modo trasparente il valore cifrato
   * (solo tramite la coda async). Per non rompere la firma sincrona usata
   * in giro per l'app, qui tentiamo comunque un best-effort sincero sul
   * plaintext e, se troviamo busta cifrata, richiamiamo la decrypt in modo
   * sincero tramite un lookup in cache interna (se gia decifrato in questa
   * sessione) altrimenti torniamo defaultValue e logghiamo un avviso.
   */
  get<T>(key: string, defaultValue: T): T {
    const raw = localStorage.getItem(key);
    if (raw === null) return defaultValue;
    if (this.encryptionEnabled && this.isSensitiveKey(key)) {
      if (raw.trimStart().startsWith('{')) {
        try {
          const p = JSON.parse(raw);
          if (isEncryptedEnvelope(p)) {
            console.warn(
              `[LocalStorageService] get("${key}"): valore cifrato letto in modo sincrono; ` +
              `usa getAsync per ottenere il vero valore decifrato. Fallback a defaultValue.`
            );
            return defaultValue;
          }
          return p as T;
        } catch {
          return defaultValue;
        }
      }
    }
    try {
      return JSON.parse(raw) as T;
    } catch {
      return defaultValue;
    }
  }

  /** Versione async di get, sicura anche con cifratura attiva. */
  async getAsync<T>(key: string, defaultValue: T): Promise<T> {
    const raw = await this.readMaybeDecrypted(key);
    if (raw === null) return defaultValue;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return defaultValue;
    }
  }

  /** Write any JSON-serialisable value. */
  set<T>(key: string, value: T): void {
    const serialized = JSON.stringify(value);
    if (this.encryptionEnabled && this.isSensitiveKey(key)) {
      void this.writeMaybeEncrypted(key, serialized);
      return;
    }
    localStorage.setItem(key, serialized);
  }

  /**
   * Read a JSON array. Always returns an array – never `null` / `undefined`.
   * Safe against non-array JSON (e.g. accidental `{}` writes).
   */
  getArray<T>(key: string): T[] {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    if (this.encryptionEnabled && this.isSensitiveKey(key)) {
      if (raw.trimStart().startsWith('{')) {
        try {
          const p = JSON.parse(raw);
          if (isEncryptedEnvelope(p)) {
            console.warn(
              `[LocalStorageService] getArray("${key}"): valore cifrato letto in modo sincrono; ` +
              `usa getArrayAsync. Fallback a [].`
            );
            return [];
          }
          return Array.isArray(p) ? (p as T[]) : [];
        } catch {
          return [];
        }
      }
    }
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
      return [];
    }
  }

  /** Versione async di getArray, sicura anche con cifratura attiva. */
  async getArrayAsync<T>(key: string): Promise<T[]> {
    const raw = await this.readMaybeDecrypted(key);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
      return [];
    }
  }

  /** Write an array to localStorage. */
  setArray<T>(key: string, value: T[]): void {
    const serialized = JSON.stringify(value);
    if (this.encryptionEnabled && this.isSensitiveKey(key)) {
      void this.writeMaybeEncrypted(key, serialized);
      return;
    }
    localStorage.setItem(key, serialized);
  }

  /** Remove a key entirely. */
  remove(key: string): void {
    localStorage.removeItem(key);
  }

  /**
   * Patch a stored JSON object with a partial update.
   * Reads → merges → writes in one call; safe on missing key.
   * Nota: con cifratura attiva, la lettura sincrona `get()` può fallire
   * quindi usiamo `getAsync` internamente per non perdere dati.
   */
  patch<T extends object>(key: string, patch: Partial<T>): void {
    void (async () => {
      const current = await this.getAsync<T>(key, {} as T);
      const next = { ...current, ...patch };
      this.set<T>(key, next);
    })();
  }

  // ─── Domain helpers ────────────────────────────────────────────────────────

  /** Returns the canonical musician affiliation code (reads both keys). */
  getAffilCode(): string | null {
    return localStorage.getItem(LS.AFFILIATION_CODE) ||
           localStorage.getItem(LS.AFFILIATION_CODE_LEGACY) ||
           null;
  }

  /** Writes the affiliation code to both legacy and current keys. */
  setAffilCode(code: string): void {
    localStorage.setItem(LS.AFFILIATION_CODE, code);
    localStorage.setItem(LS.AFFILIATION_CODE_LEGACY, code);
  }

  /** Returns the full profile snapshot or an empty object. */
  getProfile(): Record<string, any> {
    return this.get<Record<string, any>>(LS.PROFILE_SNAPSHOT, {});
  }

  /** Writes (replaces) the full profile snapshot. */
  setProfile(profile: Record<string, any>): void {
    this.set(LS.PROFILE_SNAPSHOT, profile);
  }

  /** Returns the app settings object or an empty object. */
  getSettings(): Record<string, any> {
    return this.get<Record<string, any>>(LS.SETTINGS, {});
  }

  /** Patches the app settings (merges into existing). */
  patchSettings(patch: Record<string, any>): void {
    this.patch(LS.SETTINGS, patch);
  }

  /**
   * Legge la lista eventi applicando la migrazione backfill.
   * Per ogni evento storico senza `updatedAt` (introdotto con integrazione
   * Google Calendar) imposta `updatedAt = createdAt ?? now()`.
   * Non scrive mai direttamente su disco; il write con i campi aggiornati
   * avviene al primo save o alla prima sincronizzazione (vedi Task 2).
   */
  getEventsWithBackfill(): EventDetail[] {
    const raw = this.getArray<any>(LS.EVENTS);
    const now = new Date().toISOString();
    return raw.map((e) => {
      if (!e.updatedAt) {
        e.updatedAt = e.createdAt ?? now;
      }
      return e as EventDetail;
    });
  }

  /**
   * Applica timestamp `updatedAt` (e `createdAt` se mancante) a tutti gli
   * eventi della lista, quindi li persiste in LS. Restituisce la lista
   * modificata con i timestamp applicati per reference safety.
   */
  setEventsWithTimestamp(events: EventDetail[]): EventDetail[] {
    const now = new Date().toISOString();
    const stamped: EventDetail[] = events.map((e) => ({
      ...e,
      createdAt: e.createdAt ?? now,
      updatedAt: now,
    }));
    this.set<EventDetail[]>(LS.EVENTS, stamped);
    return stamped;
  }

  /** Restituisce le impostazioni di Google Calendar (calendario scelto, ultima sync, ...). */
  getGcalSettings(): GcalSettings {
    return this.get<GcalSettings>(LS.GCAL_SETTINGS, {});
  }

  /** Applica una modifica parziale alle impostazioni Google Calendar. */
  patchGcalSettings(patch: Partial<GcalSettings>): void {
    this.patch(LS.GCAL_SETTINGS, patch);
  }

  /**
   * Convenience bundle for identity fields needed by SupabaseService.
   * Reading all three in one call avoids scattered `localStorage.getItem` calls.
   */
  getIdentity(): { musicianId: string | null; affilCode: string | null; licenseRef: string | null; email: string | null } {
    return {
      musicianId: localStorage.getItem(LS.MUSICIAN_ID),
      affilCode:  this.getAffilCode(),
      licenseRef: localStorage.getItem(LS.LICENSE_REF),
      email:      localStorage.getItem(LS.USER_EMAIL),
    };
  }

  getAuthUserId(): string | null {
    return localStorage.getItem(LS.AUTH_USER_ID);
  }

  setAuthIdentity(authUserId: string | null, email?: string | null): void {
    if (authUserId) localStorage.setItem(LS.AUTH_USER_ID, authUserId);
    else localStorage.removeItem(LS.AUTH_USER_ID);
    if (email !== undefined) {
      const normalizedEmail = `${email || ''}`.trim().toLowerCase();
      if (normalizedEmail) this.setString(LS.USER_EMAIL, normalizedEmail);
      else localStorage.removeItem(LS.USER_EMAIL);
    }
  }

  clearAccountScopedData(): void {
    const preserve = new Map<string, string>();
    [
      LS.THEME,
      LS.TOLLGURU_API_KEY,
      LS.TOLLGURU_VEHICLE_TYPE,
      LS.ENCRYPTION_ENABLED,
      CRYPTO_KID_STORAGE_KEY,
      CRYPTO_WRAPPED_KEY,
    ].forEach(key => {
      const value = localStorage.getItem(key);
      if (value !== null) preserve.set(key, value);
    });
    localStorage.clear();
    preserve.forEach((value, key) => localStorage.setItem(key, value));
  }

  clearOperationalData(): void {
    [
      LS.EVENTS,
      LS.CONCERTS,
      LS.SERVICE_PAYMENTS,
      LS.BAND_CREDITS,
      LS.EXPENSES,
      LS.CONTACTS,
      LS.BOOKING_REQUESTS,
      LS.NOTIFICATIONS,
      LS.CONTRACTS,
      LS.INVOICES,
      LS.ARCHIVE_DIRECTORY,
      LS.DASHBOARD_EXPENSE_CTX,
      LS.DASHBOARD_EXPENSE_RES,
      LS.CONCERT_EXPENSE_CTX,
      LS.CONCERT_EXPENSE_RES,
    ].forEach(key => localStorage.removeItem(key));
  }

  /** True if the user has completed basic registration (has a name). */
  isProfileComplete(): boolean {
    const profile = this.getProfile();
    return !!(profile['firstName'] || localStorage.getItem(LS.FIRST_NAME));
  }

  // ─── Debug ─────────────────────────────────────────────────────────────────

  /**
   * Returns all `mm_*` entries as a plain object.
   * Useful in dev-tools / error reports.
   */
  snapshot(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (!key.startsWith('mm_') && key !== 'musicianId' && key !== 'musicianCode') continue;
      const raw = localStorage.getItem(key);
      if (!raw) { out[key] = null; continue; }
      if (this.encryptionEnabled && this.isSensitiveKey(key)) {
        // Per evitare leak del testo cifrato, lo mascheriamo in snapshot
        if (raw.trimStart().startsWith('{')) {
          try {
            const p = JSON.parse(raw);
            if (isEncryptedEnvelope(p)) {
              out[key] = `[encrypted:${p.alg}:${p.kid}]`;
              continue;
            }
            out[key] = p;
            continue;
          } catch { /* fall back al raw */ }
        }
      }
      try { out[key] = JSON.parse(raw); } catch { out[key] = raw; }
    }
    return out;
  }
}

// ─── Helper globali per accesso diretto eventi (senza DI) ────────────────────────
// Possono essere importati da qualsiasi componente senza dover iniettare
// LocalStorageService. Applicano la stessa migrazione backfill e gli updatedAt.
// Usati dai file legacy che scrivono direttamente 'mm_events' prima del Task 2.

/**
 * Legge eventi da localStorage chiave 'mm_events' + backfill updatedAt.
 *
 * Effettua anche MIGRAZIONI AUTOMATICHE:
 *  - eventi SENZA updatedAt → default a createdAt o Oggi.
 *  - eventi con type='other' (vecchi import Google) → tipo inferito smart
 *    dal titolo (concert/lesson/dj_set), fallback 'concert'.
 *    Migrazione "in place": scrive subito indietro il type corretto in LS
 *    così la prossima volta non dovrà ricalcolare.
 */
export function readEventsWithBackfill(): EventDetail[] {
  const raw = localStorage.getItem(LS.EVENTS);
  if (!raw) return [];
  let parsed: EventDetail[];
  try {
    const obj = JSON.parse(raw);
    parsed = Array.isArray(obj) ? (obj as EventDetail[]) : [];
  } catch {
    parsed = [];
  }
  const now = new Date().toISOString();
  let needsWriteBack = false;
  const inferType = (title: string): EventDetail['type'] => {
    const t = `${title}`.toLowerCase();
    if (/lezz?ion|ripetizion|scuola|solfe[g5]|armon|maest[ro]/.test(t)) return 'lesson';
    if (/\bdj\b|discoteca|consolle|club\b|boiler|deejay/.test(t))           return 'dj_set';
    return 'concert';
  };
  const migrated: EventDetail[] = parsed.map((e) => {
    let updated: EventDetail | null = null;
    if (!e.updatedAt) {
      updated = { ...(updated ?? e), updatedAt: (e as any).createdAt ?? now };
    }
    // Migrazione eventi importati Google: 'other' → tipo smart dal titolo
    if ((e.type as string) === 'other') {
      updated = { ...(updated ?? e), type: inferType(e.title) };
    }
    if (updated) { needsWriteBack = true; return updated as EventDetail; }
    return e;
  });
  if (needsWriteBack) {
    // Scriviamo indietro in LS gli eventi migrati (messo a punto una-tantum)
    try {
      localStorage.setItem(LS.EVENTS, JSON.stringify(migrated));
    } catch (err) {
      console.warn('[LS] readEventsWithBackfill write-back migrazione fallito:', err);
    }
  }
  return migrated;
}

// ─── Helper FILTRO DATA INIZIO SINCRO (cutoff) per VISUALIZZAZIONE ────────

/** Restituisce la data cutoff YYYY-MM-DD da GcalSettings in localStorage.
 *  Se non salvata → DEFAULT: data di OGGI - 1 giorno (stessa logica del service).
 *  Questa funzione è standalone (non injectable) quindi PUO' essere usata
 *  DA QUALSIASI componente senza dipendenze. */
export function resolveSyncStartDateCutoff(): string {
  try {
    const raw = localStorage.getItem(LS.GCAL_SETTINGS);
    if (raw) {
      try {
        const obj = JSON.parse(raw);
        if (obj && typeof obj.syncStartDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(obj.syncStartDate)) {
          return obj.syncStartDate;
        }
      } catch {}
    }
  } catch {}
  // Fallback: OGGI - 1 giorno (coerente con GoogleCalendarService._defaultSyncStartDate)
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const g = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${g}`;
}

/** Applica il FILTRO CUTOFF a QUALSIASI array di eventi o oggetti con campo `date?: string`.
 *  Mantiene solo gli eventi con data >= cutoff (data inizio sincro).
 *  Gli eventi SENZA campo date vengono scartati (non abbiamo info per decidere). */
export function applySyncStartDateFilter<T extends { date?: string | null | undefined }>(items: T[]): T[] {
  if (!Array.isArray(items) || items.length === 0) return [];
  const cutoff = resolveSyncStartDateCutoff();
  return items.filter((it) => {
    const d = it?.date;
    if (!d || typeof d !== 'string') return false;
    return d >= cutoff;
  });
}

/** Wrapper per leggere eventi DA VISUALIZZARE nelle liste UI (Concerti, Agenda,
 *  Dashboard, Pagamenti, Reports, ecc.). Esegue:
 *   1. readEventsWithBackfill() → legge + migrazioni tipo/updatedAt
 *   2. applySyncStartDateFilter() → tiene solo eventi >= data inizio sincro
 *  USALA in tutti i componenti quando mostri eventi all'utente.
 *  NON USARLA per sync/import Google (serve leggere TUTTI gli eventi per fuzzy match). */
export function readEventsForDisplay(): EventDetail[] {
  return applySyncStartDateFilter(readEventsWithBackfill());
}

/**
 * Scrive eventi su 'mm_events' applicando createdAt/updatedAt se mancanti.
 * Restituisce l'array modificato (stesso riferimento).
 */
export function writeEventsWithTimestamp(events: EventDetail[]): EventDetail[] {
  const now = new Date().toISOString();
  const stamped: EventDetail[] = events.map((e) => ({
    ...e,
    createdAt: (e as any).createdAt ?? now,
    updatedAt: now,
  }));
  localStorage.setItem(LS.EVENTS, JSON.stringify(stamped));
  return stamped;
}

// ─── Sync outcoming hook (Google Calendar push automatico) ──────────────────────

export type OutgoingSyncDeltaFn = (prev: EventDetail[], next: EventDetail[]) => void;

let _globalOutgoingSyncFn: OutgoingSyncDeltaFn | null = null;

// 🧟 Chiave tombstone condivisa (stesso ID GCal che NON DEVONO MAI essere ri-importati).
// Nota: la logica di lookup/addizione è SPEDITA in 3 posti diversi (defense in depth):
//   (A) [ENTRY POINT] persistEventsWithSync — entry point SEMPRE (LS 100% — GARANTITO)
//   (B) deleteGoogleEvent funzione syncOutgoingDelta delete loop — ridondanza
//   (C) service.deleteGoogleEvent — ultima barriera prima di fetch API
const GCAL_TOMBSTONE_KEY = 'mm_gcal_tombstones_deleted_ids';
// 🧟 Chiave TOMBSTONE COMPOSITA (x eventi senza googleEventId: creati direttamente su Google,
//      oppure importati prima di questo fix). Formato `${ev.date}|${norm(ev.title)}`.
const GCAL_TOMBSTONE_KEY_TITLEDATE = 'mm_gcal_tombstones_deleted_titledate';

/** Normalizzazione titolo (IDENTICA a _findFuzzyMatch in google-calendar.service.ts
 *  — NO DRIFT, DEVE ESSERE UGUALE per non rompere match chiave composita). */
export function normalizeTitleForDedup(title: string | null | undefined): string {
  if (!title || typeof title !== 'string') return '';
  return title
    .toLowerCase()
    .replace(/[\s\-_.,;:'"!?()\[\]{}]/g, '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
/** Chiave composita SEMPLICE per dedup (data + titolo normalizzato).
 *  Usata per tombstone cross-match (non sappiamo il type sempre, vedi eventi creati su Google
 *  prima di import). */
export function eventDateTitleDedupKey(date: string | null | undefined, title: string | null | undefined): string {
  const d = (date && typeof date === 'string') ? date : '';
  return `${d}|${normalizeTitleForDedup(title)}`;
}
/** 🆕 Chiave composita COMPLETA CON TYPE (3 parti): data | titolo norm | type.
 *  USATA da: analyzeDuplicateStats, runMigration_DeduplicateEvents,
 *           GCal seenDedupKeys (intra-loop anti-dup), dedup finale fine ciclo.
 *  Per cross-match: aggiungiamo SEMPRE entrambe le chiavi al tombstone. */
export function eventFullDedupKey(
  date: string | null | undefined,
  title: string | null | undefined,
  type: string | null | undefined
): string {
  const d = (date && typeof date === 'string') ? date : '';
  const t = (type && typeof type === 'string') ? type : 'other';
  return `${d}|${normalizeTitleForDedup(title)}|${t}`;
}

/** Carica TOMBSTONE ID Google dal LS come Set<string> (helper condiviso). */
function _tombstoneLoadIds(): Set<string> {
  try {
    const raw = localStorage.getItem(GCAL_TOMBSTONE_KEY);
    if (!raw) return new Set<string>();
    const p = JSON.parse(raw);
    const ids = new Set<string>();
    if (Array.isArray(p)) p.forEach(i => { if (typeof i === 'string') ids.add(i); });
    return ids;
  } catch { return new Set<string>(); }
}
/** Persiste TOMBSTONE LS (write-through). */
function _tombstonePersistIds(ids: Set<string>): void {
  try { localStorage.setItem(GCAL_TOMBSTONE_KEY, JSON.stringify(Array.from(ids))); }
  catch { /* ignora */ }
}
/** Helper aggiunge googleEventId al tombstone (pubblico x service GCal / LS) */
export function tombstoneAddDeletedGoogleEventId(gId: string | null | undefined): boolean {
  if (!gId || typeof gId !== 'string') return false;
  const set = _tombstoneLoadIds();
  if (set.has(gId)) return false;
  set.add(gId);
  _tombstonePersistIds(set);
  return true;
}
/** Helper "L'ID Google è marcato cancellato definitivamente? (per import skip) */
export function tombstoneHasDeletedGoogleEventId(gId: string | null | undefined): boolean {
  if (!gId || typeof gId !== 'string') return false;
  return _tombstoneLoadIds().has(gId);
}

// ─── Tombstone composito data|titolo_norm (per eventi SENZA googleEventId) ───
function _tombstoneTDLoadKeys(): Set<string> {
  try {
    const raw = localStorage.getItem(GCAL_TOMBSTONE_KEY_TITLEDATE);
    if (!raw) return new Set<string>();
    const p = JSON.parse(raw);
    const set = new Set<string>();
    if (Array.isArray(p)) p.forEach(k => { if (typeof k === 'string') set.add(k); });
    return set;
  } catch { return new Set<string>(); }
}
function _tombstoneTDPersistKeys(set: Set<string>): void {
  try { localStorage.setItem(GCAL_TOMBSTONE_KEY_TITLEDATE, JSON.stringify(Array.from(set))); }
  catch { /* ignora */ }
}
/** 🧟 Aggiungi evento cancellato ai tombstone compositi (x eventi SENZA googleEventId).
 *  ⭐ CROSS-MATCH IMPORTANTE: scrive 2 chiavi nel set:
 *    (A) data|title_norm               → match tombstone semplice (Google senza type)
 *    (B) data|title_norm|type          → match dedup completo (locale)
 *  Perché: in cancellazione locale conosciamo il type, in import Google no. */
export function tombstoneAddDeletedTitleDate(
  date: string | null | undefined,
  title: string | null | undefined,
  type?: string | null | undefined
): boolean {
  const kSimple = eventDateTitleDedupKey(date, title);
  const kFull = eventFullDedupKey(date, title, type);
  if (!kSimple || kSimple.length < 12) return false; // data(10) + 2 chars titolo
  const set = _tombstoneTDLoadKeys();
  let added = false;
  if (kSimple && !set.has(kSimple)) { set.add(kSimple); added = true; }
  if (kFull && !set.has(kFull)) { set.add(kFull); added = true; }
  if (added) _tombstoneTDPersistKeys(set);
  return added;
}
/** 🧟 Skip tassativo import: match tombstone composito?
 *  Check OR logico → match SIA chiave semplice SIA chiave completa. */
export function tombstoneHasDeletedTitleDate(
  date: string | null | undefined,
  title: string | null | undefined,
  type?: string | null | undefined
): boolean {
  const set = _tombstoneTDLoadKeys();
  if (set.size === 0) return false;
  const kSimple = eventDateTitleDedupKey(date, title);
  if (kSimple && set.has(kSimple)) return true;
  const kFull = eventFullDedupKey(date, title, type);
  if (kFull && set.has(kFull)) return true;
  return false;
}

/**
 * Registra un handler globale che verrà chiamato DOPO ogni scrittura centralizzata
 * eventi (tramite persistEventsWithSync). Usato da GoogleCalendarService per
 * triggerare il push automatico app → Google in fire-and-forget.
 */
export function registerGlobalOutgoingSyncHandler(fn: OutgoingSyncDeltaFn | null): void {
  _globalOutgoingSyncFn = fn ?? null;
}

/**
 * Sostituto drop-in di writeEventsWithTimestamp. Salva eventi in localStorage
 * (stamp) e se connesso a Google Calendar triggera il delta push (create/update/delete)
 * in background, non bloccante. Nessun errore viene propagato: eventuali
 * problemi sono loggati in console.
 *
 * Restituisce gli eventi salvati (con timestamp).
 */
export function persistEventsWithSync(events: EventDetail[]): EventDetail[] {
  const previous = readEventsWithBackfill();
  const written = writeEventsWithTimestamp(events);

  // ════════════════════════════════════════════════════════════════════════
  // 🧟  TOMBSTONE LIVELLO 1 (ENTRY POINT GARANTITO 100%)
  // Calcola delta: eventi presenti in previous ma NON in written = CANCELLATI.
  // Per OGNI evento cancellato locale che ha un googleEventId valido:
  // → AGGIUNGI SEMPRE AL TOMBSTONE QUI E ORA, PRIMA DI QUALSIASI COSA.
  // Non aspettiamo GCalService, non aspettiamo fetch, non aspettiamo API.
  // Perché persistEventsWithSync è CHIAMATO DA TUTTI I PUNTI:
  //   Dashboard · Lista Eventi · Lista Concerti · Lista Lezioni · delete event modifiers
  // ════════════════════════════════════════════════════════════════════════
  try {
    const prevMap = new Map<string, EventDetail>();
    previous.forEach(ev => { if (ev && ev.id) prevMap.set(ev.id, ev); });
    const writtenIds = new Set<string>();
    written.forEach(ev => { if (ev && ev.id) writtenIds.add(ev.id); });
    let tombIdCount = 0;
    let tombTDCount = 0;
    for (const prevEv of prevMap.values()) {
      if (writtenIds.has(prevEv.id)) continue;
      // evento CANCELLATO dall'utente
      if (prevEv.googleEventId) {
        const addedId = tombstoneAddDeletedGoogleEventId(prevEv.googleEventId);
        if (addedId) tombIdCount++;
      }
      // 🆕 Sempre, ANCHE (soprattutto!) SE NON C'È googleEventId
      //     → (evento importato da Google, creato manualmente sul calendario,
      //        o esisteva prima dell'integrazione).
      //     Cross-match 2 chiavi: data|title e data|title|type.
      const addedTD = tombstoneAddDeletedTitleDate(prevEv.date, prevEv.title, prevEv.type);
      if (addedTD) tombTDCount++;
    }
    if (tombIdCount + tombTDCount > 0) {
      console.info(`%c[persistEventsWithSync] 🧟 ${tombIdCount} ID Google + ${tombTDCount} date/title chiavi aggiunti a TOMBSTONE (cancellazioni utente)`,
        'background:#7c3aed;color:#fff;padding:2px 8px;border-radius:4px;');
    }
  } catch (err) {
    console.warn('[persistEventsWithSync] tombstone loop errore (non bloccante):', err);
  }

  const tryRun = (tries = 0) => {
    if (_globalOutgoingSyncFn) {
      Promise.resolve()
        .then(() => {
          try { _globalOutgoingSyncFn?.(previous, written); }
          catch (err) { console.error('[LS] globalOutgoingSyncFn throw:', err); }
        })
        .catch((err) => { console.error('[LS] persistEventsWithSync wrapper error:', err); });
      return;
    }
    if (tries > 4) {
      console.warn('[LS] persistEventsWithSync: nessun handler dopo ~7.5s; push saltato.',
        'Se vuoi recuperare la sincronizzazione fai click sul pulsante Sincronizza Google.');
      return;
    }
    const delayMs = 500 * Math.pow(2, tries);
    setTimeout(() => tryRun(tries + 1), delayMs);
  };
  tryRun(0);
  return written;
}

/**
 * MIGRAZIONE STORICA PAGAMENTI (una-tantum!).
 *
 * Cerca TUTTI gli eventi PASSATI (data < oggi, TIPO concerto/dj_set/lezione STATUS confermato/pending)
 * che NON hanno:
 *   - un pagamento registrato in `mm_service_payments`
 *   - ID non ancora marcato "processato" in `mm_overdue_prompt_processed_v1`
 *   - non sono annullati/rimborsati
 * e LI MARCA SUBITO come "ricevuti €0 e processati".
 *
 * SCOPO Claudio Zampa: NON USARE PIÙ I POPUP "Pagamento?" per eventi
 * del PASSATO (anni 2023/24/25 già chiusi!) che ti apparivano OGNI GIORNO
 * all'apertura della Dashboard.
 *
 * Restituisce numero eventi migrati (per log).
 *
 * I dati creati come pagamenti hanno:
 *  - receivedAmount = 0 (default come richiesto: "segnale tutte pagate a 0")
 *  - paymentType = 'saldo'
 *  - paymentMethod = 'altro'
 *  - notes = "Migrazione automatica: eventi passati preesistenti marcati pagati a 0 per evitare popup"
 *  - inoltre ID evento viene marcato OVERDUE_PROCESSED (non vedremo popup anche in futuro!)
 */
export function runMigration_MarkPastEventsPaidZero(): number {
  const LS_KEY_PAYMENTS = 'mm_service_payments';
  const LS_KEY_OVERDUE_PROCESSED = 'mm_overdue_prompt_processed_v1';
  const LS_MIGRATION_FLAG = 'mm_migration_past_events_paid_zero_v1';

  // 1. Data odierna in YYYY-MM-DD (con timezone locale!)
  const today = new Date();
  const y = today.getFullYear();
  const m = `${today.getMonth() + 1}`.padStart(2, '0');
  const d = `${today.getDate()}`.padStart(2, '0');
  const todayIso = `${y}-${m}-${d}`;

  // 2. Skip se migrazione già completata in passato (evita re-run ogni volta!)
  try {
    if (localStorage.getItem(LS_MIGRATION_FLAG) === 'done') return 0;
  } catch { /* LS non disponibile: prosegui (caso estremo) */ }

  // 3. Carica tutti gli eventi
  const allEvents = readEventsWithBackfill();
  if (!allEvents.length) {
    try { localStorage.setItem(LS_MIGRATION_FLAG, 'done'); } catch {}
    return 0;
  }

  // 4. Carica pagamenti già presenti + ID eventi già processati
  let payments: any[] = [];
  try {
    payments = JSON.parse(localStorage.getItem(LS_KEY_PAYMENTS) || '[]');
    if (!Array.isArray(payments)) payments = [];
  } catch { payments = []; }
  const paidEventIds = new Set(
    payments
      .map((p: any) => `${p?.eventId || ''}`.trim())
      .filter(Boolean)
  );

  let processedIds: string[] = [];
  try {
    processedIds = JSON.parse(localStorage.getItem(LS_KEY_OVERDUE_PROCESSED) || '[]');
    if (!Array.isArray(processedIds)) processedIds = [];
  } catch { processedIds = []; }
  const processedSet = new Set(processedIds.map(x => `${x || ''}`.trim()).filter(Boolean));

  // 5. Concerti annullati / rimborsati da mm_concerts (salvato come rimborsato)
  const refundedIds = new Set<string>();
  try {
    const concertsRaw = JSON.parse(localStorage.getItem('mm_concerts') || '[]');
    if (Array.isArray(concertsRaw)) {
      concertsRaw.forEach((c: any) => {
        if (`${c?.executionStatus || ''}` === 'rimborsato' || `${c?.executionStatus || ''}` === 'annullato') {
          const eid = `${c?.id || ''}`.trim();
          if (eid) refundedIds.add(eid);
        }
      });
    }
  } catch { /* ignorabile */ }

  // 6. Elabora eventi passati che ancora da migrare
  let migratedCount = 0;
  const paymentsAdded: any[] = [];
  const idsToMarkProcessed: string[] = [];

  for (const ev of allEvents) {
    // Solo eventi PASSATI (data < oggi!)
    if (!ev.date || ev.date >= todayIso) continue;
    // Solo tipi per cui si chiede pagamenti
    if (ev.type !== 'concert' && ev.type !== 'dj_set' && ev.type !== 'lesson') continue;
    // Non annullati
    if (ev.status === 'cancelled') continue;
    // Non rimborsati
    if (refundedIds.has(ev.id)) continue;
    // Non hanno gia' pagamenti
    if (paidEventIds.has(ev.id)) continue;
    // Non già processati dai prompt
    if (processedSet.has(ev.id)) continue;

    // 🎊 MIGRA QUESTO EVENTO!
    migratedCount++;
    const categoryPayment: 'lezione' | 'concerto' | 'dj_set' | 'prestazione' | 'spesa' =
      ev.type === 'lesson' ? 'lezione' : (ev.type === 'dj_set' ? 'dj_set' : 'concerto');
    const gross = ev.grossFee && Number.isFinite(ev.grossFee) ? ev.grossFee : 0;

    paymentsAdded.push({
      id: (typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `migrated_${Date.now()}_${migratedCount}`),
      createdAt: new Date().toISOString(),
      category: categoryPayment,
      eventId: ev.id,
      receivedAmount: 0,
      paymentType: 'saldo',
      paymentMethod: 'altro',
      paymentMode: 'pattuito_extra',
      reimbursableExpenses: 0,
      taxableBase: 0,
      ivaPercent: 0,
      ivaAmount: 0,
      invoiceTotal: gross,
      cooperativeManaged: false,
      cooperativeSettlementAt: null,
      notes:
        `Migrazione automatica (${todayIso}): evento passato marcato come saldo 0€ per disattivare popup pagamenti. ` +
        'Puoi modificare in sezione Concerti/Leggiare importo dovuto/pagato in seguito liberamente!'
    });
    idsToMarkProcessed.push(ev.id);
  }

  if (!migratedCount) {
    try { localStorage.setItem(LS_MIGRATION_FLAG, 'done'); } catch {}
    return 0;
  }

  // 7. Salva modifiche (pagamenti)
  try {
    const mergedPayments = [...paymentsAdded, ...payments]; // nuovi in cima
    localStorage.setItem(LS_KEY_PAYMENTS, JSON.stringify(mergedPayments));
  } catch (err) {
    console.error('[LS Migrazione storica] salvataggio pagamenti fallito:', err);
  }

  // 8. Salva marcati come "processed" per non farli più riapparire in popup
  try {
    const mergedProcessed = Array.from(new Set([...processedSet, ...idsToMarkProcessed]));
    localStorage.setItem(LS_KEY_OVERDUE_PROCESSED, JSON.stringify(mergedProcessed));
  } catch (err) {
    console.error('[LS Migrazione storica] salvataggio processed fallito:', err);
  }

  // 9. Flag migrazione completata (NON RIPETERE!)
  try { localStorage.setItem(LS_MIGRATION_FLAG, 'done'); } catch {}

  console.info(
    `[LS Migrazione Pagamenti Storici] ✅ Migrati ${migratedCount} eventi PASSATI a pagamento 0€! ` +
    '(nessun popup pagamenti in futuro per quelli! 🎉🎊)'
  );

  return migratedCount;
}

/**
 * MIGRAZIONE "PULIZIA DI PRIMAVERA": RIMUOVI EVENTI PASSATI (SOLO DALLA APP, NON DA GOOGLE).
 *
 * Cosa fa:
 *  1. ✅ BACKUP COMPLETO: salva una copia TUTTI eventi + pagamenti correnti
 *     nella chiave `mm_backup_pre_wipe_past_{data}` così l'utente può ripristinare
 *     in caso di ripensamenti.
 *  2. ✅ CANCella EVENTI PASSATI: rimuove da `mm_events` tutti gli eventi
 *     con data < oggi (YYYY-MM-DD oggi).
 *     👉 IMPORTANTE: usa SCRITTURA DIRETTA su localStorage — NON passa
 *        per persistEventsWithSync! COSÌ IL GLOBAL OUTGOING SYNC HANDLER NON
 *        VIENE INVOCATO e NON VERRÀ MAI INVIATA UNA DELETE A GOOGLE CALENDAR ❤️
 *  3. ✅ PAGAMENTI ASSOCIATI: cancella da `mm_service_payments` TUTTI i
 *     pagamenti che hanno `eventId` relativo a un evento cancellato.
 *  4. ✅ OVERDUE PROMPT: svuota `mm_overdue_prompt_processed_v1` e
 *     `mm_overdue_prompt_state_v3` perché relativi a eventi non più esistenti.
 *  5. ✅ FLAG MIGRAZIONE: salva `mm_migration_wipe_past_events_v1 = done`
 *     per NON ripetere questa operazione mai più.
 *
 * Scopo Claudio Zampa: "i concerti falli partire da oggi in poi.. e quelli
 * passati cancellali solo dalla app e non su google.. compresi i pagamenti"
 *
 * Restituisce numero eventi rimossi dalla app (per log).
 *
 * ⚠️ GOOGLE CALENDAR: NON VIENE TOCATO IN NESSUN MODO!
 *    Tutti gli eventi restano nella loro interezza sul calendario Google.
 *    In futuro l'utente potrà sempre fare un re-import se vuole recuperare.
 */
export function runMigration_WipePastEventsFromAppOnly(): number {
  const LS_MIGRATION_FLAG = 'mm_migration_wipe_past_events_v1';
  const LS_KEY_EVENTS = 'mm_events';
  const LS_KEY_PAYMENTS = 'mm_service_payments';
  const LS_KEY_OVERDUE_PROCESSED = 'mm_overdue_prompt_processed_v1';
  const LS_KEY_OVERDUE_STATE = 'mm_overdue_prompt_state_v3';

  // 1. Skip se migrazione già completata in passato (una-tantum!)
  try {
    if (localStorage.getItem(LS_MIGRATION_FLAG) === 'done') return 0;
  } catch { /* non disponibile: prosegui */ }

  // 2. Data odierna YYYY-MM-DD timezone locale
  const today = new Date();
  const y = today.getFullYear();
  const m = `${today.getMonth() + 1}`.padStart(2, '0');
  const d = `${today.getDate()}`.padStart(2, '0');
  const todayIso = `${y}-${m}-${d}`;
  const backupTag = `${y}${m}${d}`;

  // 3. Carica sorgenti
  let allEvents: EventDetail[] = [];
  try {
    const raw = localStorage.getItem(LS_KEY_EVENTS);
    if (raw) {
      const parsed = JSON.parse(raw);
      allEvents = Array.isArray(parsed) ? parsed : [];
    }
  } catch { allEvents = []; }

  let allPayments: any[] = [];
  try {
    const raw = localStorage.getItem(LS_KEY_PAYMENTS);
    if (raw) {
      const parsed = JSON.parse(raw);
      allPayments = Array.isArray(parsed) ? parsed : [];
    }
  } catch { allPayments = []; }

  if (!allEvents.length) {
    try { localStorage.setItem(LS_MIGRATION_FLAG, 'done'); } catch {}
    console.info('[LS Wipe Past] Nessun evento presente — migrazione saltata.');
    return 0;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 🚨 BACKUP di sicurezza PRIMA di qualsiasi modifica! 🚨
  // ═══════════════════════════════════════════════════════════════════════════
  const backupKey = `mm_backup_pre_wipe_past_${backupTag}`;
  try {
    const backupPayload = {
      createdAt: new Date().toISOString(),
      description: 'Backup completo prima di migrazione "Wipe Past Events From App Only". ' +
                   'Per ripristinare: localStorage.setItem("mm_events", JSON.stringify(BACKUP.events)) ' +
                   'e localStorage.setItem("mm_service_payments", JSON.stringify(BACKUP.payments)) ' +
                   'e infine ricaricare la pagina.',
      totalEventsBefore: allEvents.length,
      totalPaymentsBefore: allPayments.length,
      todayIso,
      events: allEvents,
      payments: allPayments,
    };
    localStorage.setItem(backupKey, JSON.stringify(backupPayload));
    console.info(
      `%c[LS Wipe Past] 💾 BACKUP COMPLETO creato in localStorage "${backupKey}"! ` +
      `(${allEvents.length} eventi + ${allPayments.length} pagamenti)`,
      'font-weight:bold; color:#7c3aed; background:#ede9fe; padding:2px 8px; border-radius:4px;'
    );
  } catch (err) {
    // Backup fallito per spazio? Interrompiamo per NON rischiare!
    console.error('[LS Wipe Past] ❌ BACKUP FALLITO — migrazione INTERROTTA per sicurezza.', err);
    return 0;
  }

  // 4. Calcola eventi PASSATI (da cancellare) vs FUTURI (da mantenere)
  const eventsToKeep: EventDetail[] = [];
  const removedEventIds = new Set<string>();

  for (const ev of allEvents) {
    if (!ev.date || ev.date < todayIso) {
      // ✅ Evento PASSATO → CANCELLA dalla app
      const eid = `${ev.id || ''}`.trim();
      if (eid) removedEventIds.add(eid);
      // non push in eventsToKeep
    } else {
      // ✅ Evento OGGI o FUTURO (data >= oggi) → mantieni
      eventsToKeep.push(ev);
    }
  }

  const removedEventsCount = removedEventIds.size;
  if (!removedEventsCount) {
    try { localStorage.setItem(LS_MIGRATION_FLAG, 'done'); } catch {}
    console.info('[LS Wipe Past] Nessun evento passato da cancellare.');
    return 0;
  }

  // 5. Filtra pagamenti: tieni solo quelli il cui eventId NON è stato rimosso
  const paymentsToKeep = allPayments.filter((p) => {
    const peid = `${p?.eventId || ''}`.trim();
    if (!peid) return true; // pagamenti senza evento = tieni (sono spese extra ecc.)
    return !removedEventIds.has(peid);
  });
  const removedPaymentsCount = allPayments.length - paymentsToKeep.length;

  // ═══════════════════════════════════════════════════════════════════════════
  // 6. SCRITTURE FINALI SOTTO STESSO try/catch PER ATOMICITÀ
  // ═══════════════════════════════════════════════════════════════════════════
  //    👉 NON usiamo persistEventsWithSync()! NO SYNC OUTGOING!
  //    Scriviamo DIRETTAMENTE in localStorage.
  //    In questo modo Google Calendar rimane COMPLETAMENTE IMMUNE.
  try {
    localStorage.setItem(LS_KEY_EVENTS, JSON.stringify(eventsToKeep));
    localStorage.setItem(LS_KEY_PAYMENTS, JSON.stringify(paymentsToKeep));

    // Pulisci i prompt overdue (tutti relativi a eventi adesso cancellati)
    try { localStorage.removeItem(LS_KEY_OVERDUE_PROCESSED); } catch {}
    try { localStorage.removeItem(LS_KEY_OVERDUE_STATE); } catch {}

    // Flag migrazione completata (MAI più ripetere!)
    localStorage.setItem(LS_MIGRATION_FLAG, 'done');
  } catch (err) {
    console.error('[LS Wipe Past] ❌ Errore scrittura LS:', err);
    return 0;
  }

  // 7. Console report VISIVO bello! 🎨
  const report =
    `\n%c========================================\n` +
    `%c  🧹 PULIZIA EVENTI PASSATI COMPLETATA!  \n` +
    `%c========================================\n` +
    `%c  📅 Oggi:              ${todayIso}\n` +
    `%c  ❌ Eventi eliminati:  ${removedEventsCount}\n` +
    `%c  💸 Pagamenti elimin.: ${removedPaymentsCount}\n` +
    `%c  ✅ Eventi RIMASTI:   ${eventsToKeep.length}\n` +
    `%c  💾 Backup LS key:     ${backupKey}\n` +
    `%c  🔒 Google Calendar:   IMMUNE, NON TOCCATO!\n` +
    `%c========================================\n`;

  console.log(
    report,
    '',
    'background:#0f766e;color:#fff;font-weight:bold;',
    '',
    'background:#0f766e;color:#fff;font-weight:bold;',
    '',
    'color:#0f766e;font-weight:600;',
    'color:#be123c;font-weight:700;',
    'color:#be123c;font-weight:700;',
    'color:#15803d;font-weight:700;',
    'color:#7c3aed;font-weight:600;',
    'color:#0369a1;font-weight:700;',
    ''
  );

  return removedEventsCount;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MIGRAZIONE 3: 🧹 DEDUPLICAZIONE EVENTI (stesso titolo + data + tipo)
// ═══════════════════════════════════════════════════════════════════════════════

/** Statistiche live sui duplicati (per UI Profilo). NON modifica nulla.
 *  Restituisce gruppi di eventi duplicati (stessa data + titolo norm. + tipo).
 *  Utile per mostrare "5 gruppi duplicati · 12 eventi superflui da rimuovere".
 *  ✅ Chiave condivisa: eventFullDedupKey() — STESSA usata in GCal import loop.
 */
export function analyzeDuplicateStats(): {
  totalEvents: number;
  duplicateGroupsCount: number;
  duplicateEventsCount: number;
  groups: { key: string; sampleTitle: string; date: string; count: number; keepCandidateTitle: string; }[];
} {
  let totalEvents = 0;
  const buckets = new Map<string, EventDetail[]>();
  try {
    const raw = localStorage.getItem(LS.EVENTS);
    if (!raw) { return { totalEvents: 0, duplicateGroupsCount: 0, duplicateEventsCount: 0, groups: [] }; }
    const parsed = JSON.parse(raw);
    const arr: EventDetail[] = Array.isArray(parsed) ? parsed : [];
    totalEvents = arr.length;
    for (const ev of arr) {
      const k = eventFullDedupKey(ev.date, ev.title, ev.type);
      const list = buckets.get(k) || [];
      list.push(ev);
      buckets.set(k, list);
    }
  } catch { /* vuoto */ }

  const groupsArr: { key: string; sampleTitle: string; date: string; count: number; keepCandidateTitle: string; }[] = [];
  let dupCount = 0;
  buckets.forEach((list, key) => {
    if (list.length >= 2) {
      list.sort((a, b) => {
        const aH = a.googleEventId ? 1 : 0;
        const bH = b.googleEventId ? 1 : 0;
        if (bH !== aH) return bH - aH;
        return (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || '');
      });
      groupsArr.push({
        key,
        sampleTitle: list[0].title || '(senza titolo)',
        date: list[0].date || '',
        count: list.length,
        keepCandidateTitle: list[0].title || ''
      });
      dupCount += (list.length - 1);
    }
  });

  groupsArr.sort((a, b) => b.count - a.count);
  return {
    totalEvents,
    duplicateGroupsCount: groupsArr.length,
    duplicateEventsCount: dupCount,
    groups: groupsArr,
  };
}

/** 🧹 Deduplica eventi con stesso titolo+data+tipo.
 *  Backup preventivo LS, mantiene 1 evento per gruppo (con googleEventId + updatedAt recentissimo).
 *  ✅ NON scrive direttamente LS → usa writeEventsWithTimestamp per aggiornare updatedAt
 *     e triggerare correttamente i watcher UI.
 *  ✅ Chiave condivisa eventFullDedupKey (stessa di import loop / tombstone).
 */
export function runMigration_DeduplicateEvents(): {
  removedCount: number;
  groupsCleaned: number;
  backupKey: string;
  beforeCount: number;
  afterCount: number;
} {
  const LS_KEY_EVENTS = 'mm_events';
  const today = new Date();
  const y = today.getFullYear();
  const m = `${today.getMonth() + 1}`.padStart(2, '0');
  const d = `${today.getDate()}`.padStart(2, '0');
  const backupTag = `${y}${m}${d}`;
  const backupKey = `mm_backup_pre_dedup_${backupTag}_${Math.floor(today.getTime() / 1000)}`;

  let allEvents: EventDetail[] = [];
  try {
    const raw = localStorage.getItem(LS_KEY_EVENTS);
    if (raw) {
      const parsed = JSON.parse(raw);
      allEvents = Array.isArray(parsed) ? parsed : [];
    }
  } catch { allEvents = []; }
  const beforeCount = allEvents.length;
  if (!beforeCount) {
    return { removedCount: 0, groupsCleaned: 0, backupKey: '', beforeCount: 0, afterCount: 0 };
  }

  const buckets = new Map<string, EventDetail[]>();
  for (const ev of allEvents) {
    const k = eventFullDedupKey(ev.date, ev.title, ev.type);
    const list = buckets.get(k) || [];
    list.push(ev);
    buckets.set(k, list);
  }

  try {
    const backupPayload = {
      createdAt: new Date().toISOString(),
      description: 'Backup completo PRIMA di DEDUPLICAZIONE eventi.',
      totalEventsBefore: beforeCount,
      events: allEvents,
    };
    localStorage.setItem(backupKey, JSON.stringify(backupPayload));
    console.info(
      `%c[LS Dedup] 💾 BACKUP COMPLETO creato in LS "${backupKey}" (${beforeCount} eventi)`,
      'font-weight:bold; color:#7c3aed; background:#ede9fe; padding:2px 8px; border-radius:4px;'
    );
  } catch (err) {
    console.error('[LS Dedup] ❌ BACKUP FALLITO — operazione INTERROTTA per sicurezza.', err);
    return { removedCount: 0, groupsCleaned: 0, backupKey: '', beforeCount, afterCount: beforeCount };
  }

  let groupsCleaned = 0;
  let removedCount = 0;
  const survivorIds = new Set<string>();

  buckets.forEach((list) => {
    if (list.length === 1) {
      survivorIds.add(list[0].id);
      return;
    }
    list.sort((a, b) => {
      const aH = a.googleEventId ? 1 : 0;
      const bH = b.googleEventId ? 1 : 0;
      if (bH !== aH) return bH - aH;
      return (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || '');
    });
    survivorIds.add(list[0].id);
    groupsCleaned++;
    removedCount += (list.length - 1);
  });

  const kept = allEvents.filter((ev) => survivorIds.has(ev.id));
  const afterCount = kept.length;

  if (removedCount <= 0) {
    return { removedCount: 0, groupsCleaned: 0, backupKey, beforeCount, afterCount };
  }

  try {
    // ✅ Usa writeEventsWithTimestamp (NON setItem diretto):
    //    - Aggiorna automaticamente mm_events_updated_at timestamp
    //    - Consenti a watcher/storage event di rilevare il cambiamento
    //    - QUALSIASI pagina è in ascolto vedrà l'aggiornamento immediatamente!
    writeEventsWithTimestamp(kept);
  } catch (err) {
    console.error('[LS Dedup] ❌ Errore scrittura LS:', err);
    return { removedCount: 0, groupsCleaned: 0, backupKey, beforeCount, afterCount: beforeCount };
  }

  // 6. Report console VISIVO
  const report =
    `\n%c========================================\n` +
    `%c  🧹 DEDUPLICAZIONE EVENTI COMPLETATA!  \n` +
    `%c========================================\n` +
    `%c  📦 Eventi PRIMA:        ${beforeCount}\n` +
    `%c  🔍 Gruppi puliti:       ${groupsCleaned}\n` +
    `%c  🗑️  Eventi RIMOSSI:      ${removedCount}\n` +
    `%c  ✅ Eventi DOPO:         ${afterCount}\n` +
    `%c  💾 Backup LS key:       ${backupKey}\n` +
    `%c  🔒 Sync Google bypass:  SI' (scritta LS diretta)\n` +
    `%c========================================\n`;
  console.log(
    report,
    '',
    'background:#0f766e;color:#fff;font-weight:bold;',
    '',
    'color:#0369a1;font-weight:600;',
    'color:#7c3aed;font-weight:700;',
    'color:#be123c;font-weight:700;',
    'color:#15803d;font-weight:700;',
    'color:#7c3aed;font-weight:600;',
    'color:#0369a1;font-weight:700;',
    ''
  );
  return { removedCount, groupsCleaned, backupKey, beforeCount, afterCount };
}

/* ═══════════════════════════════════════════════════════════════════════
 *  🚨 RESET COMPLETO LOCALE PER NUOVO CALENDARIO GOOGLE
 *  Claudio ha creato un NUOVO calendario Google PULITO con 8-9 date.
 *  Questa migrazione:
 *  ✅ 1. Fa BACKUP TOTALE di TUTTE le chiavi mm_* (tranne migrazioni)
 *  ❌ 2. SVUOTA i dati di lavoro (eventi + pagamenti + stati popup)
 *  🔒 3. NON TOCCA MAI Google Calendar (né vecchio né nuovo)
 *  🪪 4. CONSERVA profile, OAuth Google, GcalSettings, ClientID, cutoff
 *  Dopo il reset, Claudio deve: (a) selezionare dalla UI il NUOVO
 *  calendario nella tendina, (b) cliccare Sincronizza → importa 8-9
 *  eventi PULITI senza duplicati, storici o errori passati.
 * ═══════════════════════════════════════════════════════════════════════ */

/** Chiavi LS che vanno SVUOTATE (dati di lavoro correlati a eventi). */
const _FULL_RESET_CLEAR_KEYS = [
  'mm_events',
  'mm_service_payments',
  'mm_overdue_payments_v3',
  'mm_event_payments_state_v3',
  'mm_dashboard_overdue_seen_state',
  'mm_booking_requests',
];

/** Chiavi LS che NON devono MAI essere toccate (config, auth, profile).
 *  Le elenchiamo per sicurezza nel backup e nel report. */
const _FULL_RESET_PRESERVE_KEYS_HINT = [
  'mm_user_profile',
  'mm_musician',
  'mm_gcal_settings',
  'mm_supabase_settings',
  'mm_migration_',
  'mm_backup_',
];

/** 🚨 Esegue il reset completo locale per partire con nuovo calendario.
 *  BACKUP PRIMA di TUTTO (tutte le chiavi mm_* presenti in LS). */
export function runMigration_WipeAllLocalForNewCalendar(): {
  backupKey: string;
  eventsCleared: number;
  paymentsCleared: number;
  keysWiped: string[];
  preserved: string[];
} {
  const today = new Date();
  const y = today.getFullYear();
  const m = `${today.getMonth() + 1}`.padStart(2, '0');
  const d = `${today.getDate()}`.padStart(2, '0');
  const backupKey = `mm_backup_FULL_RESET_${y}${m}${d}_${Math.floor(today.getTime() / 1000)}`;

  // 1️⃣ BACKUP TOTALE di TUTTE le chiavi LS che iniziano con mm_
  const fullSnapshot: Record<string, any> = {};
  const keysPreserved: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith('mm_')) continue;
    try {
      fullSnapshot[k] = localStorage.getItem(k);
      if (
        k.startsWith('mm_user_profile') ||
        k.startsWith('mm_musician') ||
        k.startsWith('mm_gcal_settings') ||
        k.startsWith('mm_supabase') ||
        k.startsWith('mm_migration_') ||
        k.startsWith('mm_backup_')
      ) {
        keysPreserved.push(k);
      }
    } catch { /* ignora */ }
  }
  try {
    localStorage.setItem(backupKey, JSON.stringify({
      createdAt: new Date().toISOString(),
      description:
        'BACKUP COMPLETO pre-RESET CALENDARIO NUOVO. ' +
        'Per RIPRISTINARE TUTTO (prima del reset), copiare il seguente snippet in Console Chrome:\n' +
        '  const b=JSON.parse(localStorage.getItem("' + backupKey + '")); ' +
        'Object.entries(b.snapshot||{}).forEach(([k,v])=>localStorage.setItem(k,v)); location.reload();',
      preservedKeysHint: _FULL_RESET_PRESERVE_KEYS_HINT,
      clearedKeysHint: _FULL_RESET_CLEAR_KEYS,
      snapshot: fullSnapshot,
    }));
    console.info(
      `%c[LS Reset] 💾 BACKUP TOTALE creato LS "${backupKey}" (${Object.keys(fullSnapshot).length} chiavi)`,
      'font-weight:bold; color:#c2410c; background:#fff7ed; padding:2px 8px; border-radius:4px;'
    );
  } catch (err) {
    console.error('[LS Reset] ❌ BACKUP FALLITO — INTERROMPO RESET per sicurezza.', err);
    return { backupKey: '', eventsCleared: 0, paymentsCleared: 0, keysWiped: [], preserved: [] };
  }

  // 2️⃣ Conta quanti dati ci sono PRIMA della cancellazione (per report)
  let eventsCleared = 0;
  let paymentsCleared = 0;
  try {
    const rawEv = localStorage.getItem('mm_events');
    if (rawEv) {
      const arr = JSON.parse(rawEv);
      eventsCleared = Array.isArray(arr) ? arr.length : 0;
    }
    const rawPay = localStorage.getItem('mm_service_payments');
    if (rawPay) {
      const arr = JSON.parse(rawPay);
      paymentsCleared = Array.isArray(arr) ? arr.length : 0;
    }
  } catch { /* ignora */ }

  // 3️⃣ CANCELLA le chiavi di lavoro (imposta a [] / {} o rimuovi)
  const wipedKeys: string[] = [];
  for (const k of _FULL_RESET_CLEAR_KEYS) {
    try {
      if (k === 'mm_events' || k === 'mm_service_payments') {
        localStorage.setItem(k, '[]');
      } else if (k.includes('state') || k.includes('overdue')) {
        localStorage.setItem(k, '{}');
      } else {
        localStorage.removeItem(k);
      }
      wipedKeys.push(k);
    } catch { /* ignora */ }
  }

  // 4️⃣ Report console VISIVO
  const title =
    `\n%c╔══════════════════════════════════════════════╗\n` +
    `%c║  🚨  RESET COMPLETO PER NUOVO CALENDARIO!    ║\n` +
    `%c╚══════════════════════════════════════════════╝\n`;
  const body =
    `%c  📦 Chiavi BACKUP totali:    ${Object.keys(fullSnapshot).length}\n` +
    `%c  🏷️  Backup Key LS:           ${backupKey}\n` +
    `%c  ❌ Eventi cancellati:       ${eventsCleared}\n` +
    `%c  ❌ Pagamenti cancellati:    ${paymentsCleared}\n` +
    `%c  🗝️  Chiavi LS svuotate:      ${wipedKeys.length}\n` +
    `%c  🪪 Chiavi CONSERVATE:       profile + OAuth + Gcal + ClientID\n` +
    `%c  🔒 Google Calendar (VECCHIO & NUOVO): NON TOCCATO\n\n` +
    `%c  👉 PROSSIMI PASSI:\n` +
    `%c     1. F5 ricarica la pagina\n` +
    `%c     2. Vai Profilo → card Google → tendina "Calendario da usare"\n` +
    `%c        → SELEZIONA il NUOVO calendario pulito (non il vecchio!)\n` +
    `%c     3. Imposta 🎚️ Filtro "Sincronizza da:" = OGGI o IERI\n` +
    `%c     4. Clicca 🔄 Sincronizza Google Calendar → importa 8-9 eventi\n` +
    `%c     5. Fatto! Lista Concerti/Dashboard = solo le date giuste ✅\n`;
  console.log(
    title + body,
    '', 'background:#ea580c;color:#fff;font-weight:bold;font-size:13px;', '',
    'color:#c2410c;font-weight:700;',
    'color:#7c3aed;font-weight:700;',
    'color:#be123c;font-weight:700;',
    'color:#be123c;font-weight:700;',
    'color:#0369a1;font-weight:700;',
    'color:#15803d;font-weight:700;',
    'color:#9333ea;font-weight:700;',
    '',
    'color:#0ea5e9;font-weight:700;',
    'color:#0ea5e9;font-weight:600;',
    'color:#f59e0b;font-weight:700;',
    'color:#f59e0b;font-weight:600;',
    'color:#10b981;font-weight:700;',
    'color:#10b981;font-weight:600;'
  );

  return {
    backupKey,
    eventsCleared,
    paymentsCleared,
    keysWiped: wipedKeys,
    preserved: keysPreserved,
  };
}

