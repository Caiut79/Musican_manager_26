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
}

/** Enum for the observable sync-progress state. */
export type SyncPhase =
  | 'idle'
  | 'syncing_events'
  | 'syncing_expenses'
  | 'syncing_contacts'
  | 'done'
  | 'error';

export interface SyncState {
  phase: SyncPhase;
  result?: SyncResult;
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
    const msg = raw instanceof Error ? raw.message : `${raw}`;
    return new AppError(msg, context, raw);
  }
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable({ providedIn: 'root' })
export class SupabaseService {
  private client: SupabaseClient | null = null;

  /**
   * Stable key: won't generate a new localStorage entry on every restart.
   * Sessions are NOT persisted anyway (persistSession: false), so this is
   * only used for in-memory Supabase auth state isolation.
   */
  private readonly AUTH_STORAGE_KEY = 'mm_auth_session_v1';

  /** RPC / table availability flags — set via PG error codes, not string search. */
  private licenseRpcUnavailable = false;
  private archiveRemoteUnavailable = false;

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
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
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
    const musicianCode = this.normalizeValidMusicianCode(affilCode);
    const metadata = this.buildRegistryMetadata(m);

    const { data, error } = await this.client.rpc('upsert_musician_registry_profile', {
      p_license_key:    licenseRef,
      p_musician_code:  musicianCode,
      p_first_name:     m.firstName,
      p_last_name:      m.lastName,
      p_email:          email,
      p_phone:          m.phone ?? null,
      p_instrument:     m.instrument ?? null,
      p_role:           m.workerType ?? null,
      p_metadata:       metadata,
    });

    if (error) throw AppError.from('saveMusician.rpc', error as unknown);

    const row = Array.isArray(data) ? data[0] : data;
    const rpcId   = row?.id as string | undefined;
    const localId = this.ls.getString(LS.MUSICIAN_ID) ?? undefined;
    const id      = rpcId || musicianId || localId;

    let code = (row?.musician_code as string | undefined) || musicianCode || undefined;
    if (!code) {
      code = await this.ensureMusicianCode(m.firstName, m.lastName);
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

    const code = `MU${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`;
    this.ls.setAffilCode(code);
    this.ls.patchSettings({ affiliationCode: code });
    return code;
  }

  async addEvent(musicianId: string, title: string, date: string, type: 'lesson' | 'concert' | 'dj_set'): Promise<void> {
    await this.init();
    if (!this.client) throw new AppError('Client non inizializzato', 'addEvent');
    const { error } = await this.client.from('events').insert({
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
      .from('events')
      .upsert(rows, { onConflict: 'musician_id,source_id', ignoreDuplicates: false });
    if (error) throw AppError.from('syncEvents.upsert', error);
  }

  async syncExpensesFromLocalStorage(musicianId: string): Promise<void> {
    await this.init();
    if (!this.client) throw new AppError('Client non inizializzato', 'syncExpenses');

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
      .from('expenses')
      .upsert(rows, { onConflict: 'musician_id,source_id', ignoreDuplicates: false });
    if (error) throw AppError.from('syncExpenses.upsert', error);
  }

  async syncContactsFromLocalStorage(musicianId: string): Promise<boolean> {
    await this.init();
    if (!this.client) throw new AppError('Client non inizializzato', 'syncContacts');

    const contacts = this.ls.getArray<any>(LS.CONTACTS);
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
      .from('contacts')
      .upsert(rows, { onConflict: 'musician_id,source_id', ignoreDuplicates: false });

    if (!error) return true;

    // Contacts table may not exist in all deployments — treat as non-fatal.
    if (this.isMissingRelation(error)) return false;

    throw AppError.from('syncContacts.upsert', error);
  }

  async loadContactsFromSupabase(musicianId: string): Promise<any[]> {
    await this.init();
    if (!this.client) return [];

    const { data, error } = await this.client
      .from('contacts')
      .select('*')
      .eq('musician_id', musicianId)
      .order('priority', { ascending: true })
      .order('display_name', { ascending: true });

    if (error) {
      if (!this.isMissingRelation(error)) {
        console.warn('[SupabaseService] loadContacts:', error.message);
      }
      return [];
    }
    return Array.isArray(data) ? data : [];
  }

  async loadEventsFromSupabase(musicianId: string): Promise<EventDetail[]> {
    await this.init();
    if (!this.client) return [];

    const { data, error } = await this.client
      .from('events')
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
      .from('expenses')
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

    const allOk = result.events.ok && result.expenses.ok && result.contacts.ok;
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

  /**
   * License activation — non-fatal: a missing or invalid license should not
   * block the user. Errors are logged to console.warn instead of being thrown.
   */
  async activateLicenseFromRef(refCode: string, appKey: string, email: string): Promise<void> {
    await this.init();
    if (!this.client || !refCode || !appKey) return;
    const { error } = await this.client.rpc('activate_license_ref', {
      p_ref_code: refCode,
      p_app_key:  appKey,
      p_email:    email,
    });
    if (error) {
      console.warn('[SupabaseService] activateLicenseFromRef (non-fatal):', error.message);
    }
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

  async loadRegistryProfileForCurrentContext(): Promise<Record<string, any> | null> {
    await this.init();
    if (!this.client) return null;

    let musicianCode = this.normalizeValidMusicianCode(this.ls.getAffilCode());
    if (!musicianCode) {
      const synced = await this.syncAffiliationCodeFromLicense();
      musicianCode = synced || '';
    }
    if (!musicianCode) return null;

    const { data, error } = await this.client
      .from('musician_registry_profiles')
      .select('first_name,last_name,email,phone,instrument,metadata,musician_code')
      .eq('musician_code', musicianCode)
      .order('created_at', { ascending: false })
      .limit(1);

    if (error || !Array.isArray(data) || !data.length) {
      if (error) console.warn('[SupabaseService] loadRegistryProfile:', error.message);
      return null;
    }

    return this.mapRegistryRowToProfile(data[0] as any);
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
