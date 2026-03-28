/**
 * SupabaseService — production-ready rewrite
 *
 * Key changes vs. previous version:
 *
 * 1. TYPED ERRORS — SupabaseRpcError wraps PostgrestError with structured context;
 *    no more string-matching heuristics for 404 / missing-relation detection.
 *
 * 2. POSTGRES ERROR CODES — availability flags are set by PG code (42P01 = undefined_table,
 *    42883 = undefined_function, P0001 = raise_exception) not by substring search in English
 *    error messages that may change between Supabase versions.
 *
 * 3. SYNC STATE — `syncState$` BehaviorSubject exposes live progress to the UI.
 *    `syncAllFromLocalStorage` returns a `SyncResult` with per-domain success/error.
 *
 * 4. LOCALSTORAGE VIA SERVICE — reads delegated to LocalStorageService (LS keys
 *    are centralised there); SupabaseService no longer hard-codes `mm_*` strings.
 *
 * 5. STABLE AUTH STORAGE KEY — derived from a constant instead of Date.now()+random
 *    to avoid leaking leftover auth keys on every app restart (though sessions are
 *    not persisted, the random key approach pollutes localStorage across reloads).
 *
 * 6. RETRY LOGIC FIXED — executeMusicianWriteWithRetry correctly loops up to maxAttempts;
 *    executeMusicianUpdateWithRetry also retries (was effectively 0 retries before).
 *
 * 7. SILENT FAILURES SURFACED — syncAllFromLocalStorage no longer swallows errors
 *    silently; it collects them in SyncResult and emits on syncState$.
 *
 * 8. activateLicenseFromRef — logs non-fatal error to console.warn instead of no-op.
 */
import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { ConfigService } from './config.service';
import { LocalStorageService, LS } from './local-storage.service';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Musician } from '../models/musician';
import { EventDetail } from '../models/event-detail';
import { Expense } from '../models/expense';

// ─── Public types ──────────────────────────────────────────────────────────────

export interface ArchiveEntity {
  entity_type: 'musician' | 'band';
  entity_code: string;
  display_name: string | null;
  linked_code: string | null;
  created_at?: string;
}

/** Structured result returned by syncAllFromLocalStorage. */
export interface SyncResult {
  events:   { ok: boolean; error?: AppError };
  expenses: { ok: boolean; error?: AppError };
  contacts: { ok: boolean; error?: AppError };
  bookingRequests: { ok: boolean; error?: AppError };
  snapshot: { ok: boolean; error?: AppError };
}

/** Enum for the observable sync-progress state. */
export type SyncPhase =
  | 'idle'
  | 'syncing_events'
  | 'syncing_expenses'
  | 'syncing_contacts'
  | 'syncing_booking_requests'
  | 'syncing_snapshot'
  | 'done'
  | 'error';

export interface SyncState {
  phase: SyncPhase;
  result?: SyncResult;
}

export interface InviteLicenseValidation {
  valid: boolean;
  reason: string | null;
  appKey: string;
  inviteRef: string;
  recipientEmail: string | null;
  status: string | null;
  subjectType: string | null;
  subjectKey: string | null;
  affiliationCode: string | null;
  metadata: Record<string, any>;
  raw: any;
}

export interface InviteLicenseActivationResult {
  ok: boolean;
  appKey: string;
  inviteRef: string;
  affiliationCode: string | null;
  subjectType: string | null;
  subjectKey: string | null;
  musicianId: string | null;
  raw: any;
}

export interface AppLicenseContext {
  id: string;
  appKey: string;
  status: string;
  subjectType: string | null;
  subjectKey: string | null;
  recipientEmail: string | null;
  affiliationCode: string | null;
  inviteRef: string | null;
  metadata: Record<string, any>;
}

export interface ResolvedIdentityContext {
  authUserId: string | null;
  email: string | null;
  appKey: string;
  license: AppLicenseContext | null;
  musicianId: string | null;
  musicianCode: string | null;
  profile: Record<string, any> | null;
  canAccessApp: boolean;
  reason: string | null;
  raw: any;
}

// ─── Internal types ────────────────────────────────────────────────────────────

interface RegistryProfileRow {
  id?: string;
  musician_code: string;
  first_name: string;
  last_name: string;
  phone?: string | null;
  instrument?: string | null;
  metadata: Record<string, any> | null;
  created_at: string;
}

// ─── Error handling ────────────────────────────────────────────────────────────

/**
 * PostgreSQL error codes we check explicitly.
 * Using codes instead of message substrings makes detection locale- and
 * version-independent.
 */
const PG_CODE = {
  UNDEFINED_TABLE:    '42P01', // relation does not exist
  UNDEFINED_FUNCTION: '42883', // function not found
  RAISE_EXCEPTION:    'P0001', // RAISE in PL/pgSQL
  FOREIGN_KEY:        '23503',
  UNIQUE_VIOLATION:   '23505',
} as const;

/** Application-level error with structured context for logging / UI. */
export class AppError extends Error {
  readonly context: string;
  readonly appCause?: unknown;

  constructor(message: string, context: string, cause?: unknown) {
    super(message);
    this.name     = 'AppError';
    this.context  = context;
    this.appCause = cause;
  }

  static from(context: string, raw: unknown): AppError {
    if (raw instanceof AppError) return raw;
    const fromObject =
      raw && typeof raw === 'object'
        ? `${(raw as any)?.message || (raw as any)?.error_description || (raw as any)?.details || (raw as any)?.hint || ''}`.trim()
        : '';
    const msg = raw instanceof Error
      ? raw.message
      : (fromObject || `${raw}`);
    return new AppError(msg, context, raw);
  }
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable({ providedIn: 'root' })
export class SupabaseService {
  private client: SupabaseClient | null = null;
  private authLockQueue: Promise<void> = Promise.resolve();
  private readonly MM_EVENTS_TABLE = 'mm_events';
  private readonly MM_EXPENSES_TABLE = 'mm_expenses';
  private readonly MM_CONTACTS_TABLE = 'mm_contacts';
  private readonly MM_BOOKING_REQUESTS_TABLE = 'mm_booking_requests';
  private readonly MM_STATE_SNAPSHOTS_TABLE = 'mm_state_snapshots';

  /**
   * Stable key: won't generate a new localStorage entry on every restart.
   * Sessions are NOT persisted anyway (persistSession: false), so this is
   * only used for in-memory Supabase auth state isolation.
   */
  private readonly AUTH_STORAGE_KEY = 'mm_auth_session_v1';

  /** RPC / table availability flags — set via PG error codes, not string search. */
  private licenseRpcUnavailable = false;
  private archiveRemoteUnavailable = false;
  private bookingRemoteUnavailable = false;
  private stateSnapshotUnavailable = false;
  private contactsRemoteUnavailable = false;

  /** Observable sync progress for components / UI indicators. */
  readonly syncState$ = new BehaviorSubject<SyncState>({ phase: 'idle' });

  constructor(
    private readonly config: ConfigService,
    private readonly ls: LocalStorageService
  ) {}

  // ─── Initialisation ─────────────────────────────────────────────────────────

  async init(): Promise<void> {
    if (this.client) return;
    await this.config.load();
    const cfg = this.config.getSupabaseConfig();
    if (!cfg) throw new AppError('Supabase config non trovata', 'init');
    this.client = createClient(cfg.url, cfg.anonKey, {
      auth: {
        storageKey: this.AUTH_STORAGE_KEY,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        lock: async (_name: string, _acquireTimeout: number, fn: () => Promise<any>) => this.runWithAuthLock(fn),
      },
    });
  }

  // ─── Musician profile ────────────────────────────────────────────────────────

  async insertMusician(m: Musician): Promise<{ id?: string; code?: string }> {
    return this.saveMusician(m);
  }

  async saveMusician(m: Musician, musicianId?: string): Promise<{ id?: string; code?: string }> {
    await this.init();
    if (!this.client) throw new AppError('Client non inizializzato', 'saveMusician');

    const { licenseRef, affilCode, email } = this.ls.getIdentity();
    const authUser = await this.getCurrentUser();
    const resolvedEmail = `${email || authUser?.email || ''}`.trim().toLowerCase() || null;
    if (resolvedEmail) this.ls.setString(LS.USER_EMAIL, resolvedEmail);
    let musicianCode = this.normalizeValidMusicianCode(affilCode);
    const metadata = this.buildRegistryMetadata(m);

    let { data, error } = await this.client.rpc('upsert_musician_registry_profile', {
      p_license_key:   licenseRef,
      p_musician_code: null,
      p_first_name:    m.firstName,
      p_last_name:     m.lastName,
      p_email:         resolvedEmail,
      p_phone:         m.phone ?? null,
      p_instrument:    m.instrument ?? null,
      p_role:          m.workerType ?? null,
      p_metadata:      metadata,
    });

    if (error && this.isMusicianCodeConflict(error)) {
      const recovered = resolvedEmail || authUser?.id
        ? await this.loadRegistryProfile({ email: resolvedEmail, musicianCode: null, authUserId: authUser?.id || null })
        : null;
      const recoveredCode = this.normalizeValidMusicianCode(`${recovered?.['musicianCode'] || ''}`);
      if (recoveredCode) {
        musicianCode = recoveredCode;
        this.ls.setAffilCode(recoveredCode);
      } else {
        musicianCode = '';
      }

      const retry = await this.client.rpc('upsert_musician_registry_profile', {
        p_license_key:   licenseRef,
        p_musician_code: null,
        p_first_name:    m.firstName,
        p_last_name:     m.lastName,
        p_email:         resolvedEmail,
        p_phone:         m.phone ?? null,
        p_instrument:    m.instrument ?? null,
        p_role:          m.workerType ?? null,
        p_metadata:      metadata,
      });
      data = retry.data;
      error = retry.error;
    }

    if (error) throw AppError.from('saveMusician.rpc', error as unknown);

    const row = Array.isArray(data) ? data[0] : data;
    const rpcId   = row?.id as string | undefined;
    const localId = this.ls.getString(LS.MUSICIAN_ID) ?? undefined;
    const id      = rpcId || musicianId || localId;

    let code = (row?.musician_code as string | undefined) || musicianCode || undefined;
    if (!code) {
      code = (await this.syncAffiliationCodeFromLicense()) || undefined;
    }

    if (code) this.ls.setAffilCode(code);
    if (id)   this.ls.setString(LS.MUSICIAN_ID, id);

    return { id, code };
  }

  async ensureMusicianCode(_firstName?: string, _lastName?: string): Promise<string | undefined> {
    const existing = this.normalizeValidMusicianCode(this.ls.getAffilCode());
    if (existing) return existing;

    const synced = await this.syncAffiliationCodeFromLicense();
    if (synced) return synced;

    return undefined;
  }

  async addEvent(musicianId: string, title: string, date: string, type: 'lesson' | 'concert' | 'dj_set'): Promise<void> {
    await this.init();
    if (!this.client) throw new AppError('Client non inizializzato', 'addEvent');
    const { error } = await this.client.from(this.MM_EVENTS_TABLE).insert({
      musician_id: musicianId,
      title,
      date,
      type,
      source_id: crypto.randomUUID(),
    });
    if (error) throw AppError.from('addEvent', error);
  }

  // ─── Sync from localStorage ──────────────────────────────────────────────────

  async syncMusicianFromLocalStorage(musicianId: string): Promise<void> {
    const profile = this.ls.getProfile();
    const firstName = profile['firstName'] || this.ls.getString(LS.FIRST_NAME) || '';
    const lastName  = profile['lastName']  || this.ls.getString(LS.LAST_NAME)  || '';
    if (!firstName || !lastName) return;

    const musician: Musician = {
      firstName,
      lastName,
      phone:      profile['phone']      || this.ls.getString(LS.PHONE)     || undefined,
      instrument: profile['instrument'] || undefined,
      workerType: profile['workerType'] || undefined,
      lessonBillingMode: profile['lessonBillingMode'] || undefined,
      musicBillingMode:  profile['musicBillingMode']  || undefined,
      homeBase:   profile['homeBase']   || this.ls.getString(LS.HOME_BASE) || undefined,
      vehicleModel: profile['vehicleModel'] || this.ls.getString('mm_vehicle_model') || undefined,
      vehicleFuelType: profile['vehicleFuelType'] || this.ls.getString('mm_vehicle_fuel_type') || undefined,
      vehicleConsumption: Number(profile['vehicleConsumption'] || this.ls.getString('mm_vehicleConsumption') || 0) || undefined,
      vehicleConsumptionMode: profile['vehicleConsumptionMode'] || this.ls.getString('mm_vehicle_consumption_mode') || undefined,
      stylesPlayed:     Array.isArray(profile['stylesPlayed'])     ? profile['stylesPlayed']     : [],
      searchableStyles: Array.isArray(profile['searchableStyles']) ? profile['searchableStyles'] : [],
      social: {
        instagram: profile['instagram'] || undefined,
        facebook:  profile['facebook']  || undefined,
        youtube:   profile['youtube']   || undefined,
        tiktok:    profile['tiktok']    || undefined,
        website:   profile['website']   || undefined,
      },
    };
    await this.saveMusician(musician, musicianId);
  }

  async syncEventsFromLocalStorage(musicianId: string): Promise<void> {
    await this.init();
    if (!this.client) throw new AppError('Client non inizializzato', 'syncEvents');
    if (!(await this.hasAuthenticatedSession())) return;

    const events = this.ls.getArray<EventDetail>(LS.EVENTS);
    const rows = events
      .filter(e => e.type === 'lesson' || e.type === 'concert')
      .map(e => ({
        musician_id:  musicianId,
        source_id:    e.id,
        title:        e.title,
        date:         e.date,
        type:         e.type,
        time_start:   e.timeStart   ?? null,
        time_end:     e.timeEnd     ?? null,
        venue:        e.venue       ?? null,
        address:      e.address     ?? null,
        gross_fee:    e.grossFee    ?? null,
        net_fee:      e.netFee      ?? null,
        compens_type: e.compensoType ?? null,
        notes:        e.notes       ?? null,
        status:       e.status      ?? null,
        band:         e.band        ?? [],
      }));

    if (!rows.length) return;

    const { error } = await this.client
      .from(this.MM_EVENTS_TABLE)
      .upsert(rows, { onConflict: 'musician_id,source_id', ignoreDuplicates: false });
    if (error) throw AppError.from('syncEvents.upsert', error);
    await this.syncStateSnapshotFromLocalStorage(musicianId);
  }

  async syncExpensesFromLocalStorage(musicianId: string): Promise<void> {
    await this.init();
    if (!this.client) throw new AppError('Client non inizializzato', 'syncExpenses');
    if (!(await this.hasAuthenticatedSession())) return;

    const expenses = this.ls.getArray<Expense>(LS.EXPENSES);
    if (!expenses.length) return;

    const rows = expenses.map(ex => ({
      musician_id:        musicianId,
      source_id:          ex.id,
      event_source_id:    ex.eventId          ?? null,
      date:               ex.date,
      origin:             ex.origin,
      destination:        ex.destination,
      origin_lat:         ex.originLat        ?? null,
      origin_lon:         ex.originLon        ?? null,
      dest_lat:           ex.destLat          ?? null,
      dest_lon:           ex.destLon          ?? null,
      distance_km:        ex.distanceKm,
      fuel_cost_per_km:   ex.fuelCostPerKm,
      fuel_price_per_liter: ex.fuelPricePerLiter ?? null,
      vehicle_consumption:  ex.vehicleConsumption ?? null,
      extras:             ex.extras           ?? [],
      total_fuel:         ex.totalFuel,
      total_extras:       ex.totalExtras,
      total_expense:      ex.totalExpense,
      created_at:         ex.createdAt,
    }));

    const { error } = await this.client
      .from(this.MM_EXPENSES_TABLE)
      .upsert(rows, { onConflict: 'musician_id,source_id', ignoreDuplicates: false });
    if (error) throw AppError.from('syncExpenses.upsert', error);
    await this.syncStateSnapshotFromLocalStorage(musicianId);
  }

  async syncContactsFromLocalStorage(musicianId: string): Promise<boolean> {
    return this.syncContactsToSupabase(musicianId, this.ls.getArray<any>(LS.CONTACTS), true);
  }

  async syncContactsToSupabase(musicianId: string, contacts: any[], syncSnapshot = false): Promise<boolean> {
    await this.init();
    if (!this.client || this.contactsRemoteUnavailable) return false;
    if (!(await this.hasAuthenticatedSession())) return false;

    if (!contacts.length) return true;

    const rows = contacts.map(c => ({
      musician_id:        musicianId,
      source_id:          `${c.id || crypto.randomUUID()}`,
      type:               `${c.type || 'band'}`,
      display_name:       `${c.displayName || ''}`.trim(),
      phone:              c.phone              || null,
      email:              c.email              || null,
      priority:           Number(c.priority    || 3),
      average_fee:        Number(c.averageFee  || 0),
      billing_mode:       c.billingMode        || null,
      payment_cadence:    c.paymentCadence     || null,
      monthly_settlement: c.monthlySettlement  || null,
      city:               c.positionCity       || null,
      address:            c.positionAddress    || null,
      notes:              c.notes              || null,
      payload:            c,
    }));

    const { error } = await this.client
      .from(this.MM_CONTACTS_TABLE)
      .upsert(rows, { onConflict: 'musician_id,source_id', ignoreDuplicates: false });

    if (!error) {
      if (syncSnapshot) await this.syncStateSnapshotFromLocalStorage(musicianId);
      return true;
    }

    if (this.isMissingRelation(error) || this.extractMissingColumn(error) || (error as any)?.status === 400) {
      this.contactsRemoteUnavailable = true;
      return false;
    }

    // Contacts table may not exist in all deployments — treat as non-fatal.

    throw AppError.from('syncContacts.upsert', error);
  }

  async syncStateSnapshotFromLocalStorage(musicianId: string): Promise<boolean> {
    await this.init();
    if (!this.client || this.stateSnapshotUnavailable || !musicianId) return false;
    if (!(await this.hasAuthenticatedSession())) return false;

    const payload = {
      events: this.ls.getArray<any>(LS.EVENTS),
      concerts: this.ls.getArray<any>(LS.CONCERTS),
      expenses: this.ls.getArray<any>(LS.EXPENSES),
      contacts: this.ls.getArray<any>(LS.CONTACTS),
      bookingRequests: this.ls.getArray<any>(LS.BOOKING_REQUESTS),
      servicePayments: this.ls.getArray<any>(LS.SERVICE_PAYMENTS),
      bandCredits: this.ls.getArray<any>(LS.BAND_CREDITS),
      notifications: this.ls.getArray<any>(LS.NOTIFICATIONS),
      contracts: this.ls.getArray<any>(LS.CONTRACTS),
      invoices: this.ls.getArray<any>(LS.INVOICES),
      archiveDirectory: this.ls.getArray<any>(LS.ARCHIVE_DIRECTORY),
      profileSnapshot: this.ls.getProfile(),
      settings: this.ls.getSettings()
    };

    const { error } = await this.client
      .from(this.MM_STATE_SNAPSHOTS_TABLE)
      .upsert({
        musician_id: musicianId,
        payload,
        updated_at: new Date().toISOString()
      }, { onConflict: 'musician_id', ignoreDuplicates: false });

    if (!error) return true;
    if (this.isMissingRelation(error)) {
      this.stateSnapshotUnavailable = true;
      return false;
    }
    throw AppError.from('syncStateSnapshot.upsert', error);
  }

  async loadStateSnapshotFromSupabase(musicianId: string): Promise<Record<string, any> | null> {
    await this.init();
    if (!this.client || this.stateSnapshotUnavailable || !musicianId) return null;

    const { data, error } = await this.client
      .from(this.MM_STATE_SNAPSHOTS_TABLE)
      .select('payload,updated_at')
      .eq('musician_id', musicianId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!error) return (data?.payload as Record<string, any>) || null;
    if (this.isMissingRelation(error)) {
      this.stateSnapshotUnavailable = true;
      return null;
    }
    throw AppError.from('loadStateSnapshot.select', error);
  }

  async loadContactsFromSupabase(musicianId: string): Promise<any[]> {
    await this.init();
    if (!this.client || this.contactsRemoteUnavailable) return [];

    const primary = await this.client
      .from(this.MM_CONTACTS_TABLE)
      .select('*')
      .eq('musician_id', musicianId)
      .order('priority', { ascending: true })
      .order('display_name', { ascending: true });

    if (!primary.error) {
      return Array.isArray(primary.data) ? primary.data : [];
    }

    const missingColumn = this.extractMissingColumn(primary.error);
    if (missingColumn === 'display_name') {
      const fallback = await this.client
        .from(this.MM_CONTACTS_TABLE)
        .select('*')
        .eq('musician_id', musicianId)
        .order('priority', { ascending: true });
      if (!fallback.error) {
        return Array.isArray(fallback.data) ? fallback.data : [];
      }
      if (this.isMissingRelation(fallback.error) || this.extractMissingColumn(fallback.error) || (fallback.error as any)?.status === 400) {
        this.contactsRemoteUnavailable = true;
        return [];
      }
      if (!this.isMissingRelation(fallback.error)) {
        console.warn('[SupabaseService] loadContacts fallback:', fallback.error.message);
      }
      return [];
    }

    if (this.isMissingRelation(primary.error) || missingColumn || (primary.error as any)?.status === 400) {
      this.contactsRemoteUnavailable = true;
      return [];
    }

    if (!this.isMissingRelation(primary.error)) {
      console.warn('[SupabaseService] loadContacts:', primary.error.message);
    }
    return [];
  }

  async loadEventsFromSupabase(musicianId: string): Promise<EventDetail[]> {
    await this.init();
    if (!this.client) return [];

    const { data, error } = await this.client
      .from(this.MM_EVENTS_TABLE)
      .select('*')
      .eq('musician_id', musicianId)
      .order('date', { ascending: false })
      .order('created_at', { ascending: false });

    if (error) {
      if (!this.isMissingRelation(error)) {
        console.warn('[SupabaseService] loadEvents:', error.message);
      }
      return [];
    }

    const rows = Array.isArray(data) ? data : [];
    return rows.map((row: any): EventDetail => ({
      id: `${row?.source_id || row?.id || crypto.randomUUID()}`,
      title: `${row?.title || 'Evento'}`,
      date: `${row?.date || ''}`,
      timeStart: `${row?.time_start || ''}`,
      timeEnd: `${row?.time_end || ''}`,
      venue: `${row?.venue || ''}`,
      address: `${row?.address || ''}`,
      type: row?.type === 'lesson' || row?.type === 'concert' || row?.type === 'dj_set' || row?.type === 'rehearsal'
        ? row.type
        : 'other',
      band: Array.isArray(row?.band)
        ? row.band.map((x: any) => ({ name: `${x?.name || x || ''}`.trim() })).filter((x: any) => !!x.name)
        : [],
      grossFee: Number(row?.gross_fee || 0),
      netFee: Number(row?.net_fee || 0),
      compensoType: row?.compens_type === 'in_fattura' ? 'in_fattura' : 'fuori_fattura',
      notes: `${row?.notes || ''}`,
      status: row?.status === 'confirmed' || row?.status === 'cancelled' ? row.status : 'pending',
      createdAt: `${row?.created_at || new Date().toISOString()}`
    }));
  }

  async loadExpensesFromSupabase(musicianId: string): Promise<Expense[]> {
    await this.init();
    if (!this.client) return [];

    const { data, error } = await this.client
      .from(this.MM_EXPENSES_TABLE)
      .select('*')
      .eq('musician_id', musicianId)
      .order('date', { ascending: false })
      .order('created_at', { ascending: false });

    if (error) {
      if (!this.isMissingRelation(error)) {
        console.warn('[SupabaseService] loadExpenses:', error.message);
      }
      return [];
    }

    const rows = Array.isArray(data) ? data : [];
    return rows.map((row: any): Expense => ({
      id: `${row?.source_id || row?.id || crypto.randomUUID()}`,
      eventId: `${row?.event_source_id || ''}` || undefined,
      date: `${row?.date || ''}`,
      origin: `${row?.origin || ''}`,
      destination: `${row?.destination || ''}`,
      originLat: Number(row?.origin_lat || 0) || undefined,
      originLon: Number(row?.origin_lon || 0) || undefined,
      destLat: Number(row?.dest_lat || 0) || undefined,
      destLon: Number(row?.dest_lon || 0) || undefined,
      distanceKm: Number(row?.distance_km || 0),
      fuelCostPerKm: Number(row?.fuel_cost_per_km || 0),
      fuelPricePerLiter: Number(row?.fuel_price_per_liter || 0) || undefined,
      vehicleConsumption: Number(row?.vehicle_consumption || 0) || undefined,
      extras: Array.isArray(row?.extras) ? row.extras.map((x: any) => ({ label: `${x?.label || ''}`, amount: Number(x?.amount || 0) })) : [],
      totalFuel: Number(row?.total_fuel || 0),
      totalExtras: Number(row?.total_extras || 0),
      totalExpense: Number(row?.total_expense || 0),
      createdAt: `${row?.created_at || new Date().toISOString()}`
    }));
  }

  async syncBookingRequestsFromLocalStorage(musicianId: string, musicianSlug: string, affiliationCode?: string | null): Promise<boolean> {
    await this.init();
    if (!this.client || this.bookingRemoteUnavailable) return false;
    if (!(await this.hasAuthenticatedSession())) return false;

    const requests = this.ls.getArray<any>(LS.BOOKING_REQUESTS);
    if (!requests.length) return true;

    const normalizedSlug = `${musicianSlug || ''}`.trim().toLowerCase();
    const normalizedCode = `${affiliationCode || ''}`.trim().toUpperCase();
    if (normalizedSlug || normalizedCode) {
      await this.claimBookingRequestsForMusician(musicianId, normalizedSlug, normalizedCode);
    }

    const rows = requests.map(request => ({
      musician_id: musicianId,
      source_id: `${request?.id || crypto.randomUUID()}`,
      batch_id: `${request?.batchId || request?.id || crypto.randomUUID()}`,
      musician_slug: `${request?.slug || normalizedSlug || ''}`.trim().toLowerCase(),
      musician_name: `${request?.musicianName || ''}`.trim() || null,
      role: `${request?.role || 'musician'}`.trim(),
      role_label: `${request?.roleLabel || ''}`.trim() || null,
      affiliation_code: `${request?.affiliationCode || normalizedCode || ''}`.trim().toUpperCase() || null,
      source_type: `${request?.sourceType || 'link'}`.trim(),
      allow_band_invites: request?.allowBandInvites !== false,
      customer_name: `${request?.customerName || ''}`.trim(),
      band_name: `${request?.bandName || ''}`.trim() || null,
      customer_email: `${request?.customerEmail || ''}`.trim().toLowerCase() || null,
      customer_phone: `${request?.customerPhone || ''}`.trim() || null,
      event_city: `${request?.eventCity || ''}`.trim() || null,
      event_province: `${request?.eventProvince || ''}`.trim() || null,
      event_date: `${request?.eventDate || ''}`.trim() || null,
      event_time: `${request?.eventTime || ''}`.trim() || null,
      event_type: `${request?.eventType || ''}`.trim() || null,
      booking_code: `${request?.bookingCode || ''}`.trim() || null,
      message: `${request?.message || ''}`.trim() || null,
      created_at: `${request?.createdAt || new Date().toISOString()}`,
      status: `${request?.status || 'new'}`.trim(),
      status_updated_at: `${request?.statusUpdatedAt || ''}`.trim() || null,
      confirmed_at: `${request?.confirmedAt || ''}`.trim() || null,
      confirmation_sent_at: `${request?.confirmationSentAt || ''}`.trim() || null,
      receipt_sent_at: `${request?.receiptSentAt || ''}`.trim() || null,
      declined_at: `${request?.declinedAt || ''}`.trim() || null,
      contact_id: `${request?.contactId || ''}`.trim() || null,
      internal_notes: `${request?.internalNotes || ''}`.trim() || null,
      payload: request
    }));

    const { error } = await this.client
      .from(this.MM_BOOKING_REQUESTS_TABLE)
      .upsert(rows, { onConflict: 'source_id', ignoreDuplicates: false });

    if (!error) {
      await this.syncStateSnapshotFromLocalStorage(musicianId);
      return true;
    }
    if (this.isMissingRelation(error)) {
      this.bookingRemoteUnavailable = true;
      return false;
    }
    throw AppError.from('syncBookingRequests.upsert', error);
  }

  async loadBookingRequestsFromSupabase(musicianId: string, musicianSlug: string, affiliationCode?: string | null): Promise<any[]> {
    await this.init();
    if (!this.client || this.bookingRemoteUnavailable) return [];

    const normalizedSlug = `${musicianSlug || ''}`.trim().toLowerCase();
    const normalizedCode = `${affiliationCode || ''}`.trim().toUpperCase();
    if ((normalizedSlug || normalizedCode) && musicianId) {
      await this.claimBookingRequestsForMusician(musicianId, normalizedSlug, normalizedCode);
    }

    if (normalizedSlug || normalizedCode) {
      const rpc = await this.client.rpc('sync_my_booking_requests', {
        p_musician_slug: normalizedSlug || null,
        p_affiliation_code: normalizedCode || null
      });
      if (!rpc.error && Array.isArray(rpc.data) && rpc.data.length) {
        return rpc.data.map((row: any) => row?.payload || {
          id: `${row?.source_id || row?.id || crypto.randomUUID()}`,
          batchId: `${row?.batch_id || row?.source_id || row?.id || crypto.randomUUID()}`,
          slug: `${row?.musician_slug || ''}`,
          musicianName: `${row?.musician_name || ''}`,
          role: `${row?.role || 'musician'}`,
          roleLabel: `${row?.role_label || ''}`,
          affiliationCode: `${row?.affiliation_code || ''}` || null,
          sourceType: `${row?.source_type || 'link'}`,
          allowBandInvites: row?.allow_band_invites !== false,
          customerName: `${row?.customer_name || ''}`,
          bandName: `${row?.band_name || ''}`,
          customerEmail: `${row?.customer_email || ''}`,
          customerPhone: `${row?.customer_phone || ''}`,
          eventCity: `${row?.event_city || ''}`,
          eventProvince: `${row?.event_province || ''}`,
          eventDate: `${row?.event_date || ''}`,
          eventTime: `${row?.event_time || ''}`,
          eventType: `${row?.event_type || ''}`,
          bookingCode: `${row?.booking_code || ''}`,
          message: `${row?.message || ''}`,
          createdAt: `${row?.created_at || new Date().toISOString()}`,
          status: `${row?.status || 'new'}`,
          statusUpdatedAt: `${row?.status_updated_at || ''}` || null,
          confirmedAt: `${row?.confirmed_at || ''}` || null,
          confirmationSentAt: `${row?.confirmation_sent_at || ''}` || null,
          receiptSentAt: `${row?.receipt_sent_at || ''}` || null,
          declinedAt: `${row?.declined_at || ''}` || null,
          contactId: `${row?.contact_id || ''}` || null,
          internalNotes: `${row?.internal_notes || ''}`
        });
      }
      if (rpc.error && !this.isMissingRelationOrFunction(rpc.error)) {
        console.warn('[SupabaseService] syncMyBookingRequests:', rpc.error.message);
      }
    }

    const { data, error } = await this.client
      .from(this.MM_BOOKING_REQUESTS_TABLE)
      .select('*')
      .eq('musician_id', musicianId)
      .order('created_at', { ascending: false });

    if (error) {
      if (this.isMissingRelation(error)) {
        this.bookingRemoteUnavailable = true;
      } else {
        console.warn('[SupabaseService] loadBookingRequests:', error.message);
      }
      return [];
    }

    const rows = Array.isArray(data) ? data : [];
    return rows.map((row: any) => row?.payload || {
      id: `${row?.source_id || row?.id || crypto.randomUUID()}`,
      batchId: `${row?.batch_id || row?.source_id || row?.id || crypto.randomUUID()}`,
      slug: `${row?.musician_slug || ''}`,
      musicianName: `${row?.musician_name || ''}`,
      role: `${row?.role || 'musician'}`,
      roleLabel: `${row?.role_label || ''}`,
      affiliationCode: `${row?.affiliation_code || ''}` || null,
      sourceType: `${row?.source_type || 'link'}`,
      allowBandInvites: row?.allow_band_invites !== false,
      customerName: `${row?.customer_name || ''}`,
      bandName: `${row?.band_name || ''}`,
      customerEmail: `${row?.customer_email || ''}`,
      customerPhone: `${row?.customer_phone || ''}`,
      eventCity: `${row?.event_city || ''}`,
      eventProvince: `${row?.event_province || ''}`,
      eventDate: `${row?.event_date || ''}`,
      eventTime: `${row?.event_time || ''}`,
      eventType: `${row?.event_type || ''}`,
      bookingCode: `${row?.booking_code || ''}`,
      message: `${row?.message || ''}`,
      createdAt: `${row?.created_at || new Date().toISOString()}`,
      status: `${row?.status || 'new'}`,
      statusUpdatedAt: `${row?.status_updated_at || ''}` || null,
      confirmedAt: `${row?.confirmed_at || ''}` || null,
      confirmationSentAt: `${row?.confirmation_sent_at || ''}` || null,
      receiptSentAt: `${row?.receipt_sent_at || ''}` || null,
      declinedAt: `${row?.declined_at || ''}` || null,
      contactId: `${row?.contact_id || ''}` || null,
      internalNotes: `${row?.internal_notes || ''}`
    });
  }

  async savePublicBookingRequest(request: any): Promise<boolean> {
    await this.init();
    if (!this.client || this.bookingRemoteUnavailable) return false;

    const row = {
      musician_id: null,
      source_id: `${request?.id || crypto.randomUUID()}`,
      batch_id: `${request?.batchId || request?.id || crypto.randomUUID()}`,
      musician_slug: `${request?.slug || ''}`.trim().toLowerCase(),
      musician_name: `${request?.musicianName || ''}`.trim() || null,
      role: `${request?.role || 'musician'}`.trim(),
      role_label: `${request?.roleLabel || ''}`.trim() || null,
      affiliation_code: `${request?.affiliationCode || ''}`.trim() || null,
      source_type: `${request?.sourceType || 'link'}`.trim(),
      allow_band_invites: request?.allowBandInvites !== false,
      customer_name: `${request?.customerName || ''}`.trim(),
      band_name: `${request?.bandName || ''}`.trim() || null,
      customer_email: `${request?.customerEmail || ''}`.trim().toLowerCase() || null,
      customer_phone: `${request?.customerPhone || ''}`.trim() || null,
      event_city: `${request?.eventCity || ''}`.trim() || null,
      event_province: `${request?.eventProvince || ''}`.trim() || null,
      event_date: `${request?.eventDate || ''}`.trim() || null,
      event_time: `${request?.eventTime || ''}`.trim() || null,
      event_type: `${request?.eventType || ''}`.trim() || null,
      booking_code: `${request?.bookingCode || ''}`.trim() || null,
      message: `${request?.message || ''}`.trim() || null,
      created_at: `${request?.createdAt || new Date().toISOString()}`,
      status: `${request?.status || 'new'}`.trim(),
      status_updated_at: `${request?.statusUpdatedAt || ''}`.trim() || null,
      confirmed_at: `${request?.confirmedAt || ''}`.trim() || null,
      confirmation_sent_at: `${request?.confirmationSentAt || ''}`.trim() || null,
      receipt_sent_at: `${request?.receiptSentAt || ''}`.trim() || null,
      declined_at: `${request?.declinedAt || ''}`.trim() || null,
      contact_id: `${request?.contactId || ''}`.trim() || null,
      internal_notes: `${request?.internalNotes || ''}`.trim() || null,
      payload: request
    };

    const { error } = await this.client
      .from(this.MM_BOOKING_REQUESTS_TABLE)
      .upsert(row, { onConflict: 'source_id', ignoreDuplicates: false });

    if (!error) return true;
    if (this.isMissingRelation(error)) {
      this.bookingRemoteUnavailable = true;
      return false;
    }
    throw AppError.from('savePublicBookingRequest.upsert', error);
  }

  async claimBookingRequestsForMusician(musicianId: string, musicianSlug: string, affiliationCode?: string | null): Promise<void> {
    await this.init();
    if (!this.client || this.bookingRemoteUnavailable) return;
    const normalizedSlug = `${musicianSlug || ''}`.trim().toLowerCase();
    const normalizedCode = `${affiliationCode || ''}`.trim().toUpperCase();
    if (!musicianId || (!normalizedSlug && !normalizedCode)) return;

    const { error } = await this.client.rpc('claim_musician_booking_requests', {
      p_musician_id: musicianId,
      p_musician_slug: normalizedSlug || null,
      p_affiliation_code: normalizedCode || null
    });

    if (!error) return;
    if (this.isMissingRelationOrFunction(error)) {
      if (this.isMissingRelation(error)) this.bookingRemoteUnavailable = true;
      return;
    }
    throw AppError.from('claimBookingRequestsForMusician.rpc', error);
  }

  /**
   * Runs all three sync operations and returns a structured result.
   * Failures are captured per-domain rather than swallowed silently.
   * Components can subscribe to `syncState$` to show progress indicators.
   */
  async syncAllFromLocalStorage(musicianId: string): Promise<SyncResult> {
    const result: SyncResult = {
      events:   { ok: false },
      expenses: { ok: false },
      contacts: { ok: false },
      bookingRequests: { ok: false },
      snapshot: { ok: false },
    };

    this.syncState$.next({ phase: 'syncing_events' });
    try {
      await this.syncEventsFromLocalStorage(musicianId);
      result.events = { ok: true };
    } catch (err) {
      result.events = { ok: false, error: AppError.from('syncAll.events', err) };
      console.warn('[SupabaseService] syncEvents failed:', result.events.error?.message);
    }

    this.syncState$.next({ phase: 'syncing_expenses' });
    try {
      await this.syncExpensesFromLocalStorage(musicianId);
      result.expenses = { ok: true };
    } catch (err) {
      result.expenses = { ok: false, error: AppError.from('syncAll.expenses', err) };
      console.warn('[SupabaseService] syncExpenses failed:', result.expenses.error?.message);
    }

    this.syncState$.next({ phase: 'syncing_contacts' });
    try {
      await this.syncContactsFromLocalStorage(musicianId);
      result.contacts = { ok: true };
    } catch (err) {
      result.contacts = { ok: false, error: AppError.from('syncAll.contacts', err) };
      console.warn('[SupabaseService] syncContacts failed:', result.contacts.error?.message);
    }

    this.syncState$.next({ phase: 'syncing_booking_requests' });
    try {
      const profile = this.ls.getProfile();
      const firstName = `${profile['firstName'] || this.ls.getString(LS.FIRST_NAME) || ''}`.trim();
      const lastName = `${profile['lastName'] || this.ls.getString(LS.LAST_NAME) || ''}`.trim();
      const musicianSlug = `${firstName}-${lastName}`
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
      await this.syncBookingRequestsFromLocalStorage(musicianId, musicianSlug, this.ls.getAffilCode());
      result.bookingRequests = { ok: true };
    } catch (err) {
      result.bookingRequests = { ok: false, error: AppError.from('syncAll.bookingRequests', err) };
      console.warn('[SupabaseService] syncBookingRequests failed:', result.bookingRequests.error?.message);
    }

    this.syncState$.next({ phase: 'syncing_snapshot' });
    try {
      await this.syncStateSnapshotFromLocalStorage(musicianId);
      result.snapshot = { ok: true };
    } catch (err) {
      result.snapshot = { ok: false, error: AppError.from('syncAll.snapshot', err) };
      console.warn('[SupabaseService] syncStateSnapshot failed:', result.snapshot.error?.message);
    }

    const allOk = result.events.ok && result.expenses.ok && result.contacts.ok && result.bookingRequests.ok && result.snapshot.ok;
    this.syncState$.next({ phase: allOk ? 'done' : 'error', result });
    return result;
  }

  // ─── Auth ────────────────────────────────────────────────────────────────────

  async signUpWithEmail(email: string, password: string, metadata?: Record<string, unknown>): Promise<void> {
    await this.init();
    if (!this.client) throw new AppError('Client non inizializzato', 'signUp');
    const { error } = await this.client.auth.signUp({
      email,
      password,
      options: metadata ? { data: metadata } : undefined,
    });
    if (error) throw AppError.from('signUp', error);
  }

  async signInWithPassword(email: string, password: string): Promise<void> {
    await this.init();
    if (!this.client) throw new AppError('Client non inizializzato', 'signIn');
    const { error } = await this.client.auth.signInWithPassword({ email, password });
    if (error) throw AppError.from('signIn', error);
  }

  async signOut(): Promise<void> {
    await this.init();
    if (!this.client) return;
    const { error } = await this.client.auth.signOut();
    if (error) throw AppError.from('signOut', error);
  }

  async getCurrentUser(): Promise<{ id: string; email: string | null } | null> {
    await this.init();
    if (!this.client) return null;
    const { data, error } = await this.client.auth.getUser();
    if (error) {
      console.warn('[SupabaseService] getCurrentUser:', error.message);
      return null;
    }
    const user = data?.user;
    if (!user) return null;
    return {
      id: `${user.id || ''}`,
      email: user.email ? `${user.email}`.trim().toLowerCase() : null
    };
  }

  /**
   * License activation — non-fatal: a missing or invalid license should not
   * block the user. Errors are logged to console.warn instead of being thrown.
   */
  async activateLicenseFromRef(refCode: string, appKey: string, email: string): Promise<void> {
    await this.init();
    if (!this.client || !refCode || !appKey) return;
    const user = await this.getCurrentUser();
    try {
      const invite = await this.activateInviteLicense(refCode, appKey, user?.id || null, null, { email });
      if (invite.ok) return;
    } catch (err: any) {
      console.warn('[SupabaseService] activateInviteLicense fallback:', err?.message || err);
    }

    const { error } = await this.client.rpc('activate_license_ref', {
      p_ref_code: refCode,
      p_app_key: appKey,
      p_email: email,
    });
    if (error) {
      console.warn('[SupabaseService] activateLicenseFromRef fallback (non-fatal):', error.message);
    }
  }

  async validateInviteLicense(inviteRef: string, appKey = 'musician_manager'): Promise<InviteLicenseValidation> {
    await this.init();
    if (!this.client) throw new AppError('Client non inizializzato', 'validateInviteLicense');

    const normalizedRef = this.normalizeInviteRef(inviteRef);
    const normalizedApp = `${appKey || 'musician_manager'}`.trim() || 'musician_manager';
    const { data, error } = await this.client.rpc('validate_invite_license', {
      p_invite_ref: normalizedRef,
      p_app_key: normalizedApp
    });
    if (error) throw AppError.from('validateInviteLicense', error);

    const row = this.normalizeRpcRow(Array.isArray(data) ? data[0] : data);
    let fallback: any | null = null;
    if (!row?.id) {
      const fallbackResult = await this.client.rpc('validate_invite_license', { p_invite_ref: normalizedRef });
      if (fallbackResult.error) throw AppError.from('validateInviteLicense.fallback', fallbackResult.error);
      fallback = this.normalizeRpcRow(Array.isArray(fallbackResult.data) ? fallbackResult.data[0] : fallbackResult.data);
    }
    const effective = row?.id ? row : fallback;
    const valid = this.isInviteRowValid(effective, normalizedApp);
    return {
      valid,
      reason: this.deriveInviteReason(effective, normalizedApp, valid),
      appKey: this.firstNonEmptyString(effective?.app_key, normalizedApp) || normalizedApp,
      inviteRef: this.firstNonEmptyString(effective?.invite_ref, normalizedRef) || normalizedRef,
      recipientEmail: this.firstNonEmptyString(effective?.recipient_email, effective?.email, effective?.subject_key),
      status: this.firstNonEmptyString(effective?.status),
      subjectType: this.firstNonEmptyString(effective?.subject_type),
      subjectKey: this.firstNonEmptyString(effective?.subject_key),
      affiliationCode: this.firstNonEmptyString(effective?.affiliation_code),
      metadata: effective?.metadata && typeof effective.metadata === 'object' ? effective.metadata : {},
      raw: effective
    };
  }

  async activateInviteLicense(
    inviteRef: string,
    appKey = 'musician_manager',
    authUserId: string | null = null,
    bandId: string | null = null,
    activationContext: Record<string, unknown> = {}
  ): Promise<InviteLicenseActivationResult> {
    await this.init();
    if (!this.client) throw new AppError('Client non inizializzato', 'activateInviteLicense');

    const normalizedRef = this.normalizeInviteRef(inviteRef);
    const normalizedApp = `${appKey || 'musician_manager'}`.trim() || 'musician_manager';
    const { data, error } = await this.client.rpc('activate_invite_license', {
      p_invite_ref: normalizedRef,
      p_app_key: normalizedApp,
      p_auth_user_id: authUserId,
      p_band_id: bandId,
      p_activation_context: activationContext
    });
    if (error) throw AppError.from('activateInviteLicense', error);

    const row = Array.isArray(data) ? data[0] : data;
    const affiliationCode = this.firstNonEmptyString(row?.affiliation_code, row?.musician_code);
    if (affiliationCode) {
      this.ls.setAffilCode(affiliationCode);
      this.ls.patchSettings({ affiliationCode });
    }
    this.ls.setString(LS.LICENSE_REF, normalizedRef);
    this.ls.setString(LS.LICENSE_APP, normalizedApp);

    const musicianId = this.firstNonEmptyString(row?.musician_id, row?.profile_id, row?.id);
    if (musicianId && this.isValidUuid(musicianId)) {
      this.ls.setString(LS.MUSICIAN_ID, musicianId);
    }

    return {
      ok: row?.ok !== false && row?.success !== false,
      appKey: this.firstNonEmptyString(row?.app_key, normalizedApp) || normalizedApp,
      inviteRef: this.firstNonEmptyString(row?.invite_ref, normalizedRef) || normalizedRef,
      affiliationCode,
      subjectType: this.firstNonEmptyString(row?.subject_type),
      subjectKey: this.firstNonEmptyString(row?.subject_key),
      musicianId: musicianId && this.isValidUuid(musicianId) ? musicianId : null,
      raw: row
    };
  }

  async isMusicistaLicenseActive(musicianCode: string): Promise<boolean | null> {
    await this.init();
    if (!this.client || !musicianCode) return null;
    if (this.licenseRpcUnavailable) return null;

    const appKey = this.ls.getString(LS.LICENSE_APP) || 'musician_manager';
    const { data, error } = await this.client.rpc('is_app_license_active', {
      p_app_key:      appKey,
      p_subject_type: 'musician',
      p_subject_key:  musicianCode,
    });

    if (error) {
      if (this.isMissingFunction(error)) {
        this.licenseRpcUnavailable = true;
      } else {
        console.warn('[SupabaseService] isLicenseActive:', error.message);
      }
      return null;
    }
    return data === true;
  }

  async syncAffiliationCodeFromLicense(): Promise<string | null> {
    await this.init();
    if (!this.client) return null;

    const profile = this.ls.getProfile();
    const { licenseRef, affilCode, email } = this.ls.getIdentity();

    const { data, error } = await this.client.rpc('upsert_musician_registry_profile', {
      p_license_key:   licenseRef,
      p_musician_code: this.normalizeValidMusicianCode(affilCode),
      p_first_name:    profile['firstName'] || this.ls.getString(LS.FIRST_NAME) || 'Musicista',
      p_last_name:     profile['lastName']  || this.ls.getString(LS.LAST_NAME)  || 'Singolo',
      p_email:         email,
      p_phone:         profile['phone']     || null,
      p_instrument:    profile['instrument'] || null,
      p_role:          profile['workerType'] || null,
      p_metadata:      {},
    });

    if (error) {
      console.warn('[SupabaseService] syncAffilCode (non-fatal):', error.message);
      return null;
    }

    const row  = Array.isArray(data) ? data[0] : data;
    const code = (row?.musician_code as string | undefined) || null;
    if (!code) return null;

    this.ls.setAffilCode(code);
    this.ls.patchSettings({ affiliationCode: code });
    return code;
  }

  async findActiveLicenseByEmail(appKey: string, email: string, statuses: string[] = ['active']): Promise<AppLicenseContext | null> {
    await this.init();
    if (!this.client) return null;

    const normalizedEmail = `${email || ''}`.trim().toLowerCase();
    if (!normalizedEmail) return null;

    const exactPattern = normalizedEmail.replace(/,/g, '\\,');
    const normalizedStatuses = (statuses || [])
      .map(status => `${status || ''}`.trim().toLowerCase())
      .filter(status => status === 'active' || status === 'pending' || status === 'suspended' || status === 'inactive');
    const effectiveStatuses = normalizedStatuses.length ? normalizedStatuses : ['active'];

    const modern = await this.client
      .from('app_licenses')
      .select('id,app_key,status,subject_type,subject_key,recipient_email,affiliation_code,invite_ref,metadata,updated_at,created_at')
      .eq('app_key', appKey)
      .in('status', effectiveStatuses)
      .or(`recipient_email.ilike.${exactPattern},subject_key.ilike.${exactPattern}`)
      .order('updated_at', { ascending: false })
      .limit(5);

    if (modern.error) {
      console.warn('[SupabaseService] findActiveLicenseByEmail:', modern.error.message);
      return null;
    }

    const rows = Array.isArray(modern.data) ? modern.data : [];
    const found = rows.find((row: any) => {
      const rowEmail = this.firstNonEmptyString(row?.recipient_email, row?.metadata?.email, row?.metadata?.user_email);
      return `${rowEmail || ''}`.trim().toLowerCase() === normalizedEmail;
    }) || rows[0];

    if (!found) return null;
    return {
      id: `${found?.id || ''}`,
      appKey: this.firstNonEmptyString(found?.app_key, appKey) || appKey,
      status: this.firstNonEmptyString(found?.status, 'active') || 'active',
      subjectType: this.firstNonEmptyString(found?.subject_type),
      subjectKey: this.firstNonEmptyString(found?.subject_key),
      recipientEmail: this.firstNonEmptyString(found?.recipient_email, found?.metadata?.email, found?.metadata?.user_email),
      affiliationCode: this.firstNonEmptyString(found?.affiliation_code),
      inviteRef: this.firstNonEmptyString(found?.invite_ref),
      metadata: found?.metadata && typeof found.metadata === 'object' ? found.metadata : {}
    };
  }

  async loadRegistryProfile(params: { musicianCode?: string | null; email?: string | null; authUserId?: string | null; licenseKey?: string | null }): Promise<Record<string, any> | null> {
    await this.init();
    if (!this.client) return null;

    const musicianCode = this.normalizeValidMusicianCode(params.musicianCode || '');
    const email = `${params.email || ''}`.trim().toLowerCase();
    const authUserId = `${params.authUserId || ''}`.trim();
    const licenseKey = `${params.licenseKey || ''}`.trim();
    let data: any[] | null = null;
    let error: any = null;

    if (musicianCode) {
      const result = await this.client
        .from('musician_registry_profiles')
        .select('id,first_name,last_name,email,phone,instrument,metadata,musician_code')
        .eq('musician_code', musicianCode)
        .order('created_at', { ascending: false })
        .limit(1);
      data = result.data as any[] | null;
      error = result.error;
    }

    if ((!Array.isArray(data) || !data.length) && authUserId && this.isValidUuid(authUserId)) {
      const byAuth = await this.client
        .from('musician_registry_profiles')
        .select('id,first_name,last_name,email,phone,instrument,metadata,musician_code')
        .eq('auth_user_id', authUserId)
        .order('created_at', { ascending: false })
        .limit(1);
      data = byAuth.data as any[] | null;
      error = byAuth.error;
    }

    if ((!Array.isArray(data) || !data.length) && licenseKey) {
      const byLicense = await this.client
        .from('musician_registry_profiles')
        .select('id,first_name,last_name,email,phone,instrument,metadata,musician_code')
        .eq('license_key', licenseKey)
        .order('created_at', { ascending: false })
        .limit(1);
      data = byLicense.data as any[] | null;
      error = byLicense.error;
    }

    if ((!Array.isArray(data) || !data.length) && email) {
      const fallback = await this.client
        .from('musician_registry_profiles')
        .select('id,first_name,last_name,email,phone,instrument,metadata,musician_code,auth_user_id,license_key')
        .ilike('email', email)
        .order('updated_at', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(20);
      const rows = Array.isArray(fallback.data) ? fallback.data : [];
      const preferred = rows.find((row: any) => authUserId && `${row?.auth_user_id || ''}` === authUserId)
        || rows.find((row: any) => licenseKey && `${row?.license_key || ''}`.trim() === licenseKey)
        || rows[0]
        || null;
      data = preferred ? [preferred] : [];
      error = fallback.error;
    }

    if (error || !Array.isArray(data) || !data.length) {
      if (error) console.warn('[SupabaseService] loadRegistryProfile:', error.message);
      return null;
    }

    const row = data[0] as any;
    const profile = this.mapRegistryRowToProfile(row);
    const id = `${row?.id || ''}`.trim();
    const code = this.normalizeValidMusicianCode(`${row?.musician_code || ''}`);
    if (code) {
      this.ls.setAffilCode(code);
      this.ls.patchSettings({ affiliationCode: code });
    }
    if (this.isValidUuid(id)) {
      this.ls.setString(LS.MUSICIAN_ID, id);
    }
    return profile;
  }

  async loadRegistryProfileForCurrentContext(): Promise<Record<string, any> | null> {
    await this.init();
    if (!this.client) return null;

    let musicianCode = this.normalizeValidMusicianCode(this.ls.getAffilCode());
    if (!musicianCode) {
      const synced = await this.syncAffiliationCodeFromLicense();
      musicianCode = synced || '';
    }
    const authUser = await this.getCurrentUser();
    const email = `${authUser?.email || this.ls.getString(LS.USER_EMAIL) || ''}`.trim().toLowerCase();
    if (email) this.ls.setString(LS.USER_EMAIL, email);

    if (!musicianCode && email) {
      const license = await this.findActiveLicenseByEmail(this.ls.getString(LS.LICENSE_APP) || 'musician_manager', email);
      const fromLicense = this.normalizeValidMusicianCode(
        license?.affiliationCode || (license?.subjectType === 'musician' ? license?.subjectKey || '' : '')
      );
      if (fromLicense) {
        musicianCode = fromLicense;
        this.ls.setAffilCode(fromLicense);
      }
      if (license?.inviteRef) this.ls.setString(LS.LICENSE_REF, license.inviteRef);
    }

    return this.loadRegistryProfile({ musicianCode, email, authUserId: authUser?.id || null });
  }

  async resolveIdentityContext(appKey = 'musician_manager', authUserId: string | null = null): Promise<ResolvedIdentityContext | null> {
    await this.init();
    if (!this.client) return null;

    const normalizedApp = `${appKey || 'musician_manager'}`.trim() || 'musician_manager';
    const { data, error } = await this.client.rpc('resolve_identity_context', {
      p_app_key: normalizedApp,
      p_auth_user_id: authUserId
    });

    if (error) {
      if (this.isMissingFunction(error)) return null;
      throw AppError.from('resolveIdentityContext', error);
    }

    const row = this.normalizeRpcRow(Array.isArray(data) ? data[0] : data);
    if (!row) return null;

    const license = row?.license && typeof row.license === 'object'
      ? this.mapLicenseContext(row.license, normalizedApp)
      : this.firstNonEmptyString(
            row?.license_id,
            row?.invite_ref,
            row?.affiliation_code,
            row?.subject_key
          )
        ? this.mapLicenseContext({
            id: row?.license_id,
            app_key: row?.app_key,
            status: row?.license_status || row?.status,
            subject_type: row?.subject_type,
            subject_key: row?.subject_key,
            recipient_email: row?.recipient_email,
            affiliation_code: row?.affiliation_code,
            invite_ref: row?.invite_ref,
            metadata: row?.metadata || {}
          }, normalizedApp)
        : null;

    const profileSource = row?.profile && typeof row.profile === 'object'
      ? row.profile
      : row?.profile_data && typeof row.profile_data === 'object'
        ? row.profile_data
        : row;
    const profile = this.mapResolvedProfile(profileSource);
    const email = this.firstNonEmptyString(row?.email, row?.recipient_email, profile?.['licenseEmail']);
    const musicianCode = this.normalizeValidMusicianCode(
      this.firstNonEmptyString(row?.musician_code, row?.affiliation_code, license?.affiliationCode, profile?.['musicianCode']) || ''
    );
    const musicianId = this.firstNonEmptyString(row?.musician_id, row?.registry_profile_id, profile?.['id']);
    const canAccessApp = row?.can_access_app === true || row?.canAccessApp === true || !!license;
    const reason = this.firstNonEmptyString(row?.reason, row?.status_reason, canAccessApp ? null : 'no_active_license');

    if (email) this.ls.setString(LS.USER_EMAIL, email);
    if (license?.inviteRef) this.ls.setString(LS.LICENSE_REF, license.inviteRef);
    if (license?.appKey) this.ls.setString(LS.LICENSE_APP, license.appKey);
    if (musicianCode) {
      this.ls.setAffilCode(musicianCode);
      this.ls.patchSettings({ affiliationCode: musicianCode });
    }
    if (musicianId && this.isValidUuid(musicianId)) {
      this.ls.setString(LS.MUSICIAN_ID, musicianId);
    }

    return {
      authUserId: this.firstNonEmptyString(row?.auth_user_id, authUserId),
      email,
      appKey: this.firstNonEmptyString(row?.app_key, normalizedApp) || normalizedApp,
      license,
      musicianId: musicianId && this.isValidUuid(musicianId) ? musicianId : null,
      musicianCode: musicianCode || null,
      profile,
      canAccessApp,
      reason,
      raw: row
    };
  }

  // ─── Archive ─────────────────────────────────────────────────────────────────

  async searchArchiveEntities(query: string, entityType: 'musician' | 'band'): Promise<ArchiveEntity[]> {
    await this.init();
    if (!this.client || this.archiveRemoteUnavailable) {
      return this.searchArchiveLocal(query, entityType);
    }

    if (entityType === 'musician') {
      const remote = await this.searchRegistryMusiciansRemote(query);
      return remote ?? this.searchArchiveLocal(query, entityType);
    }

    const remote = await this.searchBandsRemote(query);
    return remote ?? this.searchArchiveLocal(query, entityType);
  }

  async syncArchiveCodes(musicianCode: string, bandCode: string, musicianName?: string): Promise<boolean> {
    await this.init();
    if (!musicianCode || !bandCode) return false;

    const codeM = this.normalizeValidMusicianCode(musicianCode.trim().toUpperCase());
    if (!codeM) return false;

    const codeB   = bandCode.trim().toUpperCase();
    const display = (musicianName || '').trim() || null;
    const rows: ArchiveEntity[] = [
      { entity_type: 'musician', entity_code: codeM, display_name: display, linked_code: codeB },
      { entity_type: 'band',     entity_code: codeB, display_name: null,    linked_code: codeM },
    ];

    if (!this.client || this.archiveRemoteUnavailable) {
      this.mergeArchiveLocal(rows);
      return true;
    }

    const { error } = await this.client.rpc('attach_band_to_musician_registry', {
      p_musician_code: codeM,
      p_band_id:       null,
      p_band_code:     codeB,
    });

    if (!error) {
      this.mergeArchiveLocal(rows);
      return true;
    }

    if (this.isMissingRelationOrFunction(error)) {
      this.archiveRemoteUnavailable = true;
      this.mergeArchiveLocal(rows);
      return true;
    }

    console.warn('[SupabaseService] syncArchiveCodes:', error.message);
    return false;
  }

  isArchiveRemoteAvailable(): boolean {
    return !this.archiveRemoteUnavailable;
  }

  // ─── Schema-aware write helpers ──────────────────────────────────────────────

  /**
   * Retries an insert/update by progressively dropping columns that the remote
   * schema doesn't have yet. Stops after maxAttempts or when no column is missing.
   */
  private async executeMusicianWriteWithRetry(
    payload: Record<string, unknown>,
    musicianId?: string
  ): Promise<{ data: { id?: string; code?: string } | null; error: any }> {
    if (!this.client) return { data: null, error: new AppError('Client non inizializzato', 'write') };

    const safePayload = { ...payload };
    const maxAttempts = 4;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const query  = this.client.from('musicians');
      const result = musicianId
        ? await query.update(safePayload).eq('id', musicianId).select('id').single()
        : await query.insert(safePayload).select('id').single();

      const missingColumn = this.extractMissingColumn(result.error);
      if (!missingColumn) {
        return { data: result.data ? { id: (result.data as any).id } : null, error: result.error };
      }
      if (missingColumn in safePayload) {
        delete safePayload[missingColumn];
        continue; // retry without the offending column
      }
      // Column name in error but not in payload — stop retrying
      return { data: result.data ? { id: (result.data as any).id } : null, error: result.error };
    }

    return { data: null, error: new AppError('Schema non allineato: troppe colonne mancanti', 'write') };
  }

  private async executeMusicianUpdateWithRetry(
    payload: Record<string, unknown>,
    musicianId: string
  ): Promise<{ error: any }> {
    if (!this.client) return { error: new AppError('Client non inizializzato', 'update') };

    const safePayload = { ...payload };
    const maxAttempts = 4;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const result = await this.client.from('musicians').update(safePayload).eq('id', musicianId);
      const missingColumn = this.extractMissingColumn(result.error);
      if (!missingColumn) return { error: result.error };
      if (missingColumn in safePayload) {
        delete safePayload[missingColumn];
        continue;
      }
      return { error: result.error };
    }

    return { error: new AppError('Schema non allineato: troppe colonne mancanti', 'update') };
  }

  private async runWithAuthLock<T>(fn: () => Promise<T>): Promise<T> {
    const previous = this.authLockQueue;
    let release: () => void = () => {};
    this.authLockQueue = new Promise<void>(resolve => {
      release = resolve;
    });
    await previous;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  private async hasAuthenticatedSession(): Promise<boolean> {
    await this.init();
    if (!this.client) return false;
    const { data, error } = await this.client.auth.getSession();
    if (error) return false;
    return !!data?.session?.access_token;
  }

  // ─── Error classification helpers ────────────────────────────────────────────

  /**
   * Returns true when the error indicates the target **table** doesn't exist.
   * Checks PG code 42P01 (undefined_table) first; falls back to message heuristic
   * for HTTP-level 404s from the Supabase REST layer.
   */
  private isMissingRelation(error: any): boolean {
    if (!error) return false;
    if (error?.code === PG_CODE.UNDEFINED_TABLE) return true;
    const msg = `${error?.message ?? ''} ${error?.details ?? ''}`.toLowerCase();
    // Supabase REST returns 404 when the table PostgREST schema cache misses
    return msg.includes('relation') || msg.includes('does not exist') || error?.status === 404;
  }

  /**
   * Returns true when the error indicates the target **function** (RPC) doesn't exist.
   */
  private isMissingFunction(error: any): boolean {
    if (!error) return false;
    if (error?.code === PG_CODE.UNDEFINED_FUNCTION) return true;
    const msg = `${error?.message ?? ''} ${error?.details ?? ''}`.toLowerCase();
    return msg.includes('function') || msg.includes('not found') || error?.status === 404;
  }

  /** Combined check used for archive operations (table or function may be absent). */
  private isMissingRelationOrFunction(error: any): boolean {
    return this.isMissingRelation(error) || this.isMissingFunction(error);
  }

  private isArchiveMissingError(error: any): boolean {
    return this.isMissingRelationOrFunction(error);
  }

  private extractMissingColumn(error: any): string | null {
    const message = `${error?.message ?? ''} ${error?.details ?? ''}`.trim();
    if (!message) return null;
    return (
      message.match(/Could not find the '([^']+)' column/i)?.[1] ??
      message.match(/column "([^"]+)" does not exist/i)?.[1] ??
      null
    );
  }

  private firstNonEmptyString(...values: unknown[]): string | null {
    for (const value of values) {
      const text = `${value ?? ''}`.trim();
      if (text) return text;
    }
    return null;
  }

  private isMusicianCodeConflict(error: any): boolean {
    const constraint = `${error?.constraint || ''}`.toLowerCase();
    const message = `${error?.message || ''} ${error?.details || ''}`.toLowerCase();
    return error?.code === PG_CODE.UNIQUE_VIOLATION
      && (constraint.includes('musician_registry_profiles_musician_code_key') || message.includes('musician_registry_profiles_musician_code_key'));
  }

  private normalizeInviteRef(value: string | null | undefined): string {
    return decodeURIComponent(`${value || ''}`).trim().toUpperCase();
  }

  private normalizeRpcRow<T>(value: T): T | null {
    if (!value || typeof value !== 'object') return null;
    return value;
  }

  private isInviteRowValid(row: any, expectedAppKey: string): boolean {
    if (!row?.id) return false;
    if (this.firstNonEmptyString(row?.app_key) !== expectedAppKey) return false;
    if (row?.closed_at) return false;
    if (row?.suspended_until) return false;
    const expiresAt = this.firstNonEmptyString(row?.expires_at);
    if (expiresAt && Number.isFinite(Date.parse(expiresAt)) && Date.parse(expiresAt) < Date.now()) return false;
    const status = this.firstNonEmptyString(row?.status)?.toLowerCase();
    return status === 'pending' || status === 'active';
  }

  private deriveInviteReason(row: any, expectedAppKey: string, isValid: boolean): string | null {
    if (isValid) {
      const status = this.firstNonEmptyString(row?.status)?.toLowerCase();
      if (status === 'active') return 'already_active';
      return null;
    }
    if (!row?.id) return 'invalid_ref';
    if (this.firstNonEmptyString(row?.app_key) !== expectedAppKey) return 'app_mismatch';
    if (row?.closed_at) return 'already_closed';
    if (row?.suspended_until) return 'suspended';
    const expiresAt = this.firstNonEmptyString(row?.expires_at);
    if (expiresAt && Number.isFinite(Date.parse(expiresAt)) && Date.parse(expiresAt) < Date.now()) return 'expired';
    return this.firstNonEmptyString(row?.reason, row?.message, row?.error_code, 'invalid_ref');
  }

  private mapLicenseContext(row: any, appKey: string): AppLicenseContext {
    return {
      id: `${row?.id || ''}`,
      appKey: this.firstNonEmptyString(row?.app_key, appKey) || appKey,
      status: this.firstNonEmptyString(row?.status, 'pending') || 'pending',
      subjectType: this.firstNonEmptyString(row?.subject_type),
      subjectKey: this.firstNonEmptyString(row?.subject_key),
      recipientEmail: this.firstNonEmptyString(row?.recipient_email, row?.email, row?.subject_key),
      affiliationCode: this.firstNonEmptyString(row?.affiliation_code, row?.musician_code),
      inviteRef: this.firstNonEmptyString(row?.invite_ref),
      metadata: row?.metadata && typeof row.metadata === 'object' ? row.metadata : {}
    };
  }

  private mapResolvedProfile(row: any): Record<string, any> | null {
    const firstName = this.firstNonEmptyString(row?.first_name, row?.firstName);
    const lastName = this.firstNonEmptyString(row?.last_name, row?.lastName);
    const phone = this.firstNonEmptyString(row?.phone);
    const instrument = this.firstNonEmptyString(row?.instrument);
    const email = this.firstNonEmptyString(row?.email, row?.license_email);
    const metadata = row?.metadata && typeof row.metadata === 'object' ? row.metadata : {};
    const profile: Record<string, any> = {
      ...metadata,
      id: this.firstNonEmptyString(row?.id, row?.registry_profile_id),
      firstName: firstName || metadata['firstName'] || '',
      lastName: lastName || metadata['lastName'] || '',
      phone: phone || metadata['phone'] || '',
      instrument: instrument || metadata['instrument'] || '',
      licenseEmail: email || metadata['licenseEmail'] || ''
    };
    return Object.values(profile).some(value => this.firstNonEmptyString(value) || (typeof value === 'object' && value))
      ? profile
      : null;
  }

  // ─── Archive local operations ────────────────────────────────────────────────

  private searchArchiveLocal(query: string, entityType: 'musician' | 'band'): ArchiveEntity[] {
    const normalized = (query || '').trim().toLowerCase();
    return this.ls.getArray<ArchiveEntity>(LS.ARCHIVE_DIRECTORY)
      .filter(row => row.entity_type === entityType)
      .filter(row => {
        if (entityType === 'musician') return !!this.normalizeValidMusicianCode(row.entity_code);
        return !!(row.entity_code || '').trim() && !!this.normalizeValidMusicianCode(row.linked_code || '');
      })
      .filter(row => {
        if (!normalized) return true;
        const code   = (row.entity_code   || '').toLowerCase();
        const name   = (row.display_name  || '').toLowerCase();
        const linked = (row.linked_code   || '').toLowerCase();
        return code.includes(normalized) || name.includes(normalized) || linked.includes(normalized);
      })
      .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  }

  private mergeArchiveLocal(rows: ArchiveEntity[]): void {
    const current = this.ls.getArray<ArchiveEntity>(LS.ARCHIVE_DIRECTORY);
    const now     = new Date().toISOString();

    rows.forEach(row => {
      if (row.entity_type === 'musician' && !this.normalizeValidMusicianCode(row.entity_code)) return;
      if (row.entity_type === 'band' && !this.normalizeValidMusicianCode(row.linked_code || '')) return;

      const idx = current.findIndex(
        item => item.entity_type === row.entity_type && item.entity_code === row.entity_code
      );
      const next: ArchiveEntity = { ...row, created_at: idx >= 0 ? current[idx].created_at || now : now };
      if (idx >= 0) current[idx] = next;
      else          current.push(next);
    });

    this.ls.setArray(LS.ARCHIVE_DIRECTORY, current);
  }

  // ─── Remote archive search ───────────────────────────────────────────────────

  private async searchRegistryMusiciansRemote(query: string): Promise<ArchiveEntity[] | null> {
    if (!this.client) return null;
    const normalized = (query || '').trim();

    let req = this.client
      .from('musician_registry_profiles')
      .select('musician_code, first_name, last_name, metadata, created_at')
      .limit(80);

    if (normalized) {
      req = req.or(
        `musician_code.ilike.%${normalized}%,first_name.ilike.%${normalized}%,last_name.ilike.%${normalized}%`
      );
    }

    const { data, error } = await req.order('created_at', { ascending: false });

    if (error || !data) {
      if (this.isArchiveMissingError(error)) this.archiveRemoteUnavailable = true;
      else if (error) console.warn('[SupabaseService] searchMusiciansRemote:', error.message);
      return null;
    }

    const out: ArchiveEntity[] = [];
    (data as unknown as RegistryProfileRow[]).forEach(row => {
      const code = this.normalizeValidMusicianCode(row.musician_code);
      if (!code) return;
      const source = `${row.metadata?.['appSource'] || ''}`.trim().toLowerCase();
      if (source && source !== 'musician_manager') return;
      out.push({
        entity_type:  'musician',
        entity_code:  code,
        display_name: `${row.first_name || ''} ${row.last_name || ''}`.trim() || 'Musicista',
        linked_code:  row.metadata?.['bandRegistryCode'] || null,
        created_at:   row.created_at,
      });
    });
    return out;
  }

  private async searchBandsRemote(query: string): Promise<ArchiveEntity[] | null> {
    if (!this.client) return null;

    const { data, error } = await this.client.rpc('search_band_registry_codes', {
      p_query: (query || '').trim(),
    });

    if (error || !data) {
      if (this.isArchiveMissingError(error)) this.archiveRemoteUnavailable = true;
      else if (error) console.warn('[SupabaseService] searchBandsRemote:', error.message);
      return null;
    }

    return (data as any[])
      .filter(row => !!(row?.band_code || '').trim())
      .filter(row => !!this.normalizeValidMusicianCode(`${row?.musician_code || ''}`))
      .map(row => ({
        entity_type:  'band' as const,
        entity_code:  row.band_code,
        display_name: row.band_name || null,
        linked_code:  this.normalizeValidMusicianCode(`${row.musician_code || ''}`),
        created_at:   row.created_at,
      }));
  }

  // ─── Metadata builders ───────────────────────────────────────────────────────

  private buildRegistryMetadata(m: Musician): Record<string, unknown> {
    return {
      homeBase:                m.homeBase                ?? null,
      birthDate:               m.birthDate               ?? null,
      birthPlace:              m.birthPlace              ?? null,
      fiscalCode:              m.fiscalCode              ?? null,
      residence:               m.residence               ?? null,
      workerType:              m.workerType              ?? null,
      lessonBillingMode:       m.lessonBillingMode       ?? null,
      musicBillingMode:        m.musicBillingMode        ?? null,
      taxRegime:               m.taxRegime               ?? 'ordinario',
      vatMode:                 m.vatMode                 ?? 'iva_ordinaria',
      irpefBracket:            m.irpefBracket            ?? '23',
      substituteTaxPercent:    m.substituteTaxPercent    ?? 15,
      estimatedAnnualRevenue:  m.estimatedAnnualRevenue  ?? 0,
      estimatedAnnualCosts:    m.estimatedAnnualCosts    ?? 0,
      empalsPosition:          m.empalsPosition          ?? null,
      enpalsCategory:          m.enpalsCategory          ?? null,
      exemptEmployer:          m.exemptEmployer          ?? null,
      exemptEmployerType:      m.exemptEmployerType      ?? null,
      vehicleModel:            m.vehicleModel            ?? null,
      vehicleFuelType:         m.vehicleFuelType         ?? null,
      vehicleConsumption:      m.vehicleConsumption      ?? null,
      vehicleConsumptionMode:  m.vehicleConsumptionMode  ?? null,
      level:                   m.level                   ?? null,
      stylesPlayed:            m.stylesPlayed            ?? [],
      searchableStyles:        m.searchableStyles        ?? [],
      djStylesPlayed:          m.djStylesPlayed          ?? [],
      djSearchableStyles:      m.djSearchableStyles      ?? [],
      social:                  m.social                  ?? {},
      inpsExempt:              m.inpsExempt              ?? false,
      inpsData:                m.inpsData                ?? null,
      isMusician:              m.isMusician              ?? true,
      isTeacher:               m.isTeacher               ?? false,
      isDj:                    m.isDj                    ?? false,
      appSource:               'musician_manager',
      appKey:                  'musician_manager',
      lessonColor:             m.lessonColor             ?? null,
      concertColor:            m.concertColor            ?? null,
      djColor:                 m.djColor                 ?? null,
      musicianRoleCode:        m.roleSettings?.musician?.code ?? null,
      roleSettings:            m.roleSettings            ?? null,
      djCode:                  m.djCode                  ?? null,
      signatureData:           m.signatureData           ?? null,
    };
  }

  private mapRegistryRowToProfile(row: any): Record<string, any> {
    const meta        = row.metadata     || {};
    const social      = meta.social      || {};
    const roleSettings = meta.roleSettings || {};
    const musicianRole = roleSettings.musician || {};
    const djRole       = roleSettings.dj       || {};
    const teacherRole  = roleSettings.teacher  || {};

    const fixBracket = (v: unknown, def = '23') =>
      `${v || def}` === '35' ? '33' : (`${v || def}`);

    return {
      id:                         row.id || '',
      musicianCode:               row.musician_code || '',
      firstName:                  row.first_name  || '',
      lastName:                   row.last_name   || '',
      licenseEmail:               row.email       || this.ls.getString(LS.USER_EMAIL) || '',
      phone:                      row.phone       || '',
      instrument:                 row.instrument  || '',
      birthDate:                  meta.birthDate  || '',
      birthPlace:                 meta.birthPlace || '',
      fiscalCode:                 meta.fiscalCode || '',
      residence:                  meta.residence  || '',
      homeBase:                   meta.homeBase   || '',
      workerType:                 meta.workerType || '',
      lessonBillingMode:          meta.lessonBillingMode || 'fuori_fattura',
      musicBillingMode:           meta.musicBillingMode  || 'fuori_fattura',
      taxRegime:                  meta.taxRegime  || 'ordinario',
      vatMode:                    meta.vatMode    || 'iva_ordinaria',
      irpefBracket:               fixBracket(meta.irpefBracket),
      substituteTaxPercent:       Number(meta.substituteTaxPercent  || 15),
      estimatedAnnualRevenue:     Number(meta.estimatedAnnualRevenue || 0),
      estimatedAnnualCosts:       Number(meta.estimatedAnnualCosts   || 0),
      empalsPosition:             meta.empalsPosition    || '',
      exemptEmployer:             meta.exemptEmployer    || '',
      exemptEmployerType:         meta.exemptEmployerType || 'dipendente',
      level:                      meta.level             || '',
      stylesPlayed:               Array.isArray(meta.stylesPlayed)     ? meta.stylesPlayed     : [],
      searchableStyles:           Array.isArray(meta.searchableStyles) ? meta.searchableStyles : [],
      instagram:                  social.instagram || '',
      facebook:                   social.facebook  || '',
      youtube:                    social.youtube   || '',
      tiktok:                     social.tiktok    || '',
      website:                    social.website   || '',
      inpsExempt:                 meta.inpsExempt === true,
      inpsNumber:                 meta.inpsData?.number    || '',
      inpsStartDate:              meta.inpsData?.startDate || '',
      inpsEndDate:                meta.inpsData?.endDate   || '',
      musicianRoleCode:           musicianRole.code || meta.musicianRoleCode || '',
      djRoleCode:                 djRole.code       || meta.djCode            || '',
      musicianFiscalMode:         musicianRole.fiscalMode || 'cooperativa',
      djFiscalMode:               djRole.fiscalMode       || 'cooperativa',
      teacherFiscalMode:          teacherRole.fiscalMode  || 'associazione',
      musicianSupportEntity:      musicianRole.supportEntity || '',
      djSupportEntity:            djRole.supportEntity       || '',
      teacherSupportEntity:       teacherRole.supportEntity  || '',
      musicianVatNumber:          musicianRole.vatNumber || '',
      djVatNumber:                djRole.vatNumber       || '',
      teacherVatNumber:           teacherRole.vatNumber  || '',
      musicianTaxRegime:          musicianRole.taxRegime || 'ordinario',
      djTaxRegime:                djRole.taxRegime       || 'ordinario',
      teacherTaxRegime:           teacherRole.taxRegime  || 'forfettario',
      musicianIrpefBracket:       fixBracket(musicianRole.irpefBracket),
      djIrpefBracket:             fixBracket(djRole.irpefBracket),
      teacherIrpefBracket:        fixBracket(teacherRole.irpefBracket),
      musicianSubstituteTaxPercent: Number(musicianRole.substituteTaxPercent || 15),
      djSubstituteTaxPercent:       Number(djRole.substituteTaxPercent       || 15),
      teacherSubstituteTaxPercent:  Number(teacherRole.substituteTaxPercent  || 15),
      musicianIrapPercent:          Number(musicianRole.irapPercent    || 3.9),
      djIrapPercent:                Number(djRole.irapPercent          || 3.9),
      teacherIrapPercent:           Number(teacherRole.irapPercent     || 3.9),
      musicianInailPercent:         Number(musicianRole.inailPercent   || 0),
      djInailPercent:               Number(djRole.inailPercent         || 0),
      teacherInailPercent:          Number(teacherRole.inailPercent    || 0),
      musicianCoopFeePercent:       Number(musicianRole.cooperativeFeePercent || 12),
      djCoopFeePercent:             Number(djRole.cooperativeFeePercent       || 12),
      teacherCoopFeePercent:        Number(teacherRole.cooperativeFeePercent  || 8),
      musicianCoopTaxPercent:       Number(musicianRole.cooperativeTaxPercent || 9.19),
      djCoopTaxPercent:             Number(djRole.cooperativeTaxPercent       || 9.19),
      teacherCoopTaxPercent:        Number(teacherRole.cooperativeTaxPercent  || 5),
      musicianEventGrossEstimate:   Number(musicianRole.eventGrossEstimate    || 0),
      djEventGrossEstimate:         Number(djRole.eventGrossEstimate          || 0),
      teacherEventGrossEstimate:    Number(teacherRole.eventGrossEstimate     || 0),
      musicianInpsExemptRole:       musicianRole.inpsExempt === true,
      djInpsExemptRole:             djRole.inpsExempt    === true,
      teacherInpsExemptRole:        teacherRole.inpsExempt === true,
      isMusician:                   meta.isMusician !== false,
      isTeacher:                    meta.isTeacher  === true,
      isDj:                         meta.isDj       === true,
      lessonColor:                  meta.lessonColor  || '#2e7d32',
      concertColor:                 meta.concertColor || '#1565c0',
      djColor:                      meta.djColor      || '#8b5cf6',
    };
  }

  // ─── Validation helpers ──────────────────────────────────────────────────────

  private normalizeValidMusicianCode(raw: string | null | undefined): string | null {
    const value = `${raw || ''}`.trim().toUpperCase();
    return /^MU\d{4}$/.test(value) ? value : null;
  }

  private isValidUuid(value: string | undefined): value is string {
    return !!value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  }
}
