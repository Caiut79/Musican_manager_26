/**
 * LocalStorageService
 *
 * Centralises every `mm_*` key used across the app.
 * - Single source of truth for key names (no magic strings in components)
 * - Type-safe JSON get/set with safe-parse
 * - Domain helpers that mirror the shape components actually need
 * - Change notifications via StorageEvent (cross-tab sync)
 */
import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

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

// ─── Types ────────────────────────────────────────────────────────────────────
export interface LsChangeEvent {
  key: string;
  oldValue: string | null;
  newValue: string | null;
}

// ─── Service ──────────────────────────────────────────────────────────────────
@Injectable({ providedIn: 'root' })
export class LocalStorageService {
  /**
   * Emits on `window.storage` events (cross-tab changes only – not same-tab).
   * Subscribe in components or services that need to react to external changes.
   */
  readonly changes$ = new Subject<LsChangeEvent>();

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
    }
  }

  // ─── Primitives ────────────────────────────────────────────────────────────

  /** Read a raw string value. Returns `null` when absent. */
  getString(key: string): string | null {
    return localStorage.getItem(key);
  }

  /** Write a raw string value. */
  setString(key: string, value: string): void {
    localStorage.setItem(key, value);
  }

  /**
   * Parse a JSON value. Returns `defaultValue` on missing key or parse error.
   * Use `getArray<T>` for arrays (guarantees an array even on corrupt data).
   */
  get<T>(key: string, defaultValue: T): T {
    const raw = localStorage.getItem(key);
    if (raw === null) return defaultValue;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return defaultValue;
    }
  }

  /** Write any JSON-serialisable value. */
  set<T>(key: string, value: T): void {
    localStorage.setItem(key, JSON.stringify(value));
  }

  /**
   * Read a JSON array. Always returns an array – never `null` / `undefined`.
   * Safe against non-array JSON (e.g. accidental `{}` writes).
   */
  getArray<T>(key: string): T[] {
    const raw = localStorage.getItem(key);
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
    localStorage.setItem(key, JSON.stringify(value));
  }

  /** Remove a key entirely. */
  remove(key: string): void {
    localStorage.removeItem(key);
  }

  /**
   * Patch a stored JSON object with a partial update.
   * Reads → merges → writes in one call; safe on missing key.
   */
  patch<T extends object>(key: string, patch: Partial<T>): void {
    const current = this.get<T>(key, {} as T);
    this.set<T>(key, { ...current, ...patch });
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
      if (normalizedEmail) localStorage.setItem(LS.USER_EMAIL, normalizedEmail);
      else localStorage.removeItem(LS.USER_EMAIL);
    }
  }

  clearAccountScopedData(): void {
    const preserve = new Map<string, string>();
    [LS.THEME, LS.TOLLGURU_API_KEY, LS.TOLLGURU_VEHICLE_TYPE].forEach(key => {
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
      try { out[key] = JSON.parse(raw); } catch { out[key] = raw; }
    }
    return out;
  }
}
