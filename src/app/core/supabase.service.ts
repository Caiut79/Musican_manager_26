import { Injectable } from '@angular/core';
import { ConfigService } from './config.service';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Musician } from '../models/musician';
import { EventDetail } from '../models/event-detail';
import { Expense } from '../models/expense';

export type ArchiveEntity = {
  entity_type: 'musician' | 'band';
  entity_code: string;
  display_name: string | null;
  linked_code: string | null;
  created_at?: string;
};

type RegistryProfileRow = {
  id?: string;
  musician_code: string;
  first_name: string;
  last_name: string;
  phone?: string | null;
  instrument?: string | null;
  metadata: Record<string, any> | null;
  created_at: string;
};

@Injectable({ providedIn: 'root' })
export class SupabaseService {
  private client: SupabaseClient<any, any, any> | null = null;
  private licenseRpcUnavailable = false;
  private archiveRemoteUnavailable = false;
  private authStorageKey = `mm_auth_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  constructor(private config: ConfigService) {}

  async init(): Promise<void> {
    if (this.client) return;
    await this.config.load();
    const cfg = this.config.getSupabaseConfig();
    if (!cfg) {
      throw new Error('Supabase config non trovata');
    }
    this.client = createClient(cfg.url, cfg.anonKey, {
      auth: {
        storageKey: this.authStorageKey,
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false
      }
    });
  }

  async insertMusician(m: Musician): Promise<{ id?: string; code?: string }> {
    return this.saveMusician(m);
  }

  async saveMusician(m: Musician, musicianId?: string): Promise<{ id?: string; code?: string }> {
    await this.init();
    if (!this.client) throw new Error('Supabase non inizializzato');
    const licenseKey = localStorage.getItem('mm_license_ref') || null;
    const rawMusicianCode = localStorage.getItem('mm_affiliation_code') || localStorage.getItem('musicianCode') || null;
    const musicianCode = this.normalizeValidMusicianCode(rawMusicianCode);
    const metadata = this.buildRegistryMetadata(m);
    const { data, error } = await this.client.rpc('upsert_musician_registry_profile', {
      p_license_key: licenseKey,
      p_musician_code: musicianCode,
      p_first_name: m.firstName,
      p_last_name: m.lastName,
      p_email: localStorage.getItem('mm_user_email'),
      p_phone: m.phone ?? null,
      p_instrument: m.instrument ?? null,
      p_role: m.workerType ?? null,
      p_metadata: metadata
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    const rpcId = row?.id as string | undefined;
    const localId = localStorage.getItem('musicianId') || undefined;
    const id = rpcId || musicianId || localId;
    let code = (row?.musician_code as string | undefined) || musicianCode || undefined;
    if (!code) {
      code = await this.ensureMusicianCode(m.firstName, m.lastName);
    }
    if (code) {
      localStorage.setItem('mm_affiliation_code', code);
      localStorage.setItem('musicianCode', code);
    }
    if (id) {
      localStorage.setItem('musicianId', id);
    }
    return { id, code };
  }

  async ensureMusicianCode(_firstName?: string, _lastName?: string): Promise<string | undefined> {
    const existing = this.normalizeValidMusicianCode(localStorage.getItem('mm_affiliation_code') || localStorage.getItem('musicianCode') || '');
    if (existing) return existing;
    const synced = await this.syncAffiliationCodeFromLicense();
    if (synced) return synced;
    const fallbackSeed = Math.floor(Math.random() * 10000);
    const code = `MU${fallbackSeed.toString().padStart(4, '0')}`;
    localStorage.setItem('mm_affiliation_code', code);
    localStorage.setItem('musicianCode', code);
    const currentSettings = JSON.parse(localStorage.getItem('mm_settings') || '{}');
    localStorage.setItem('mm_settings', JSON.stringify({
      ...currentSettings,
      affiliationCode: code
    }));
    return code;
  }

  async addEvent(musicianId: string, title: string, date: string, type: 'lesson' | 'concert' | 'dj_set'): Promise<void> {
    await this.init();
    if (!this.client) throw new Error('Supabase non inizializzato');
    const { error } = await this.client.from('events').insert({
      musician_id: musicianId,
      title,
      date,
      type,
      source_id: crypto.randomUUID()
    });
    if (error) throw error;
  }

  async syncMusicianFromLocalStorage(musicianId: string): Promise<void> {
    const profileSnapshot = JSON.parse(localStorage.getItem('mm_profile_snapshot') || '{}');
    const firstName = profileSnapshot.firstName || localStorage.getItem('mm_firstName') || '';
    const lastName = profileSnapshot.lastName || localStorage.getItem('mm_lastName') || '';
    if (!firstName || !lastName) return;
    const musician: Musician = {
      firstName,
      lastName,
      phone: profileSnapshot.phone || localStorage.getItem('mm_phone') || undefined,
      instrument: profileSnapshot.instrument || undefined,
      workerType: profileSnapshot.workerType || undefined,
      lessonBillingMode: profileSnapshot.lessonBillingMode || undefined,
      musicBillingMode: profileSnapshot.musicBillingMode || undefined,
      homeBase: profileSnapshot.homeBase || localStorage.getItem('mm_homeBase') || undefined,
      stylesPlayed: profileSnapshot.stylesPlayed || [],
      searchableStyles: profileSnapshot.searchableStyles || [],
      social: {
        instagram: profileSnapshot.instagram || undefined,
        facebook: profileSnapshot.facebook || undefined,
        youtube: profileSnapshot.youtube || undefined,
        tiktok: profileSnapshot.tiktok || undefined,
        website: profileSnapshot.website || undefined
      }
    };
    await this.saveMusician(musician, musicianId);
  }

  async syncEventsFromLocalStorage(musicianId: string): Promise<void> {
    await this.init();
    if (!this.client) throw new Error('Supabase non inizializzato');
    const events = this.readJsonArray<EventDetail>('mm_events');
    if (!events.length) return;
    const rows = events
      .filter(event => event.type === 'lesson' || event.type === 'concert')
      .map(event => ({
        musician_id: musicianId,
        source_id: event.id,
        title: event.title,
        date: event.date,
        type: event.type,
        time_start: event.timeStart ?? null,
        time_end: event.timeEnd ?? null,
        venue: event.venue ?? null,
        address: event.address ?? null,
        gross_fee: event.grossFee ?? null,
        net_fee: event.netFee ?? null,
        compens_type: event.compensoType ?? null,
        notes: event.notes ?? null,
        status: event.status ?? null,
        band: event.band ?? []
      }));
    if (!rows.length) return;
    const { error } = await this.client
      .from('events')
      .upsert(rows, { onConflict: 'musician_id,source_id', ignoreDuplicates: false });
    if (error) throw error;
  }

  async syncExpensesFromLocalStorage(musicianId: string): Promise<void> {
    await this.init();
    if (!this.client) throw new Error('Supabase non inizializzato');
    const expenses = this.readJsonArray<Expense>('mm_expenses');
    if (!expenses.length) return;
    const rows = expenses.map(expense => ({
      musician_id: musicianId,
      source_id: expense.id,
      event_source_id: expense.eventId ?? null,
      date: expense.date,
      origin: expense.origin,
      destination: expense.destination,
      origin_lat: expense.originLat ?? null,
      origin_lon: expense.originLon ?? null,
      dest_lat: expense.destLat ?? null,
      dest_lon: expense.destLon ?? null,
      distance_km: expense.distanceKm,
      fuel_cost_per_km: expense.fuelCostPerKm,
      fuel_price_per_liter: expense.fuelPricePerLiter ?? null,
      vehicle_consumption: expense.vehicleConsumption ?? null,
      extras: expense.extras ?? [],
      total_fuel: expense.totalFuel,
      total_extras: expense.totalExtras,
      total_expense: expense.totalExpense,
      created_at: expense.createdAt
    }));
    const { error } = await this.client
      .from('expenses')
      .upsert(rows, { onConflict: 'musician_id,source_id', ignoreDuplicates: false });
    if (error) throw error;
  }

  async syncContactsFromLocalStorage(musicianId: string): Promise<boolean> {
    await this.init();
    if (!this.client) throw new Error('Supabase non inizializzato');
    const contacts = this.readJsonArray<any>('mm_contacts');
    if (!contacts.length) return true;
    const rows = contacts.map(contact => ({
      musician_id: musicianId,
      source_id: `${contact.id || crypto.randomUUID()}`,
      type: `${contact.type || 'band'}`,
      display_name: `${contact.displayName || ''}`.trim(),
      phone: contact.phone || null,
      email: contact.email || null,
      priority: Number(contact.priority || 3),
      average_fee: Number(contact.averageFee || 0),
      billing_mode: contact.billingMode || null,
      payment_cadence: contact.paymentCadence || null,
      monthly_settlement: contact.monthlySettlement || null,
      city: contact.positionCity || null,
      address: contact.positionAddress || null,
      notes: contact.notes || null,
      payload: contact
    }));
    const { error } = await this.client
      .from('contacts')
      .upsert(rows, { onConflict: 'musician_id,source_id', ignoreDuplicates: false });
    if (!error) return true;
    const msg = `${error?.message || ''} ${error?.details || ''}`.toLowerCase();
    if (msg.includes('relation') || msg.includes('does not exist') || msg.includes('404')) {
      return false;
    }
    throw error;
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
    if (!error && Array.isArray(data)) return data;
    const msg = `${error?.message || ''} ${error?.details || ''}`.toLowerCase();
    if (msg.includes('relation') || msg.includes('does not exist') || msg.includes('404')) {
      return [];
    }
    return [];
  }

  async syncAllFromLocalStorage(musicianId: string): Promise<void> {
    try {
      await this.syncEventsFromLocalStorage(musicianId);
    } catch {
    }
    try {
      await this.syncExpensesFromLocalStorage(musicianId);
    } catch {
    }
    try {
      await this.syncContactsFromLocalStorage(musicianId);
    } catch {
    }
  }

  async signUpWithEmail(email: string, password: string, metadata?: Record<string, unknown>): Promise<void> {
    await this.init();
    if (!this.client) throw new Error('Supabase non inizializzato');
    const { error } = await this.client.auth.signUp({
      email,
      password,
      options: metadata ? { data: metadata } : undefined
    });
    if (error) throw error;
  }

  async signInWithPassword(email: string, password: string): Promise<void> {
    await this.init();
    if (!this.client) throw new Error('Supabase non inizializzato');
    const { error } = await this.client.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }

  async activateLicenseFromRef(refCode: string, appKey: string, email: string): Promise<void> {
    await this.init();
    if (!this.client || !refCode || !appKey) return;
    const { error } = await this.client.rpc('activate_license_ref', {
      p_ref_code: refCode,
      p_app_key: appKey,
      p_email: email
    });
    if (error) {
      return;
    }
  }

  async isMusicistaLicenseActive(musicianCode: string): Promise<boolean | null> {
    await this.init();
    if (!this.client || !musicianCode) return null;
    if (this.licenseRpcUnavailable) return null;
    const appKey = localStorage.getItem('mm_license_app') || 'musician_manager';
    const { data, error } = await this.client.rpc('is_app_license_active', {
      p_app_key: appKey,
      p_subject_type: 'musician',
      p_subject_key: musicianCode
    });
    if (error) {
      const msg = `${error?.message || ''} ${error?.details || ''}`.toLowerCase();
      if (msg.includes('function') || msg.includes('not found') || msg.includes('404')) {
        this.licenseRpcUnavailable = true;
      }
      return null;
    }
    return data === true;
  }

  async syncAffiliationCodeFromLicense(): Promise<string | null> {
    await this.init();
    if (!this.client) return null;
    const profileSnapshot = JSON.parse(localStorage.getItem('mm_profile_snapshot') || '{}');
    const firstName = profileSnapshot.firstName || localStorage.getItem('mm_firstName') || 'Musicista';
    const lastName = profileSnapshot.lastName || localStorage.getItem('mm_lastName') || 'Singolo';
    const licenseKey = localStorage.getItem('mm_license_ref');
    const localCode = this.normalizeValidMusicianCode(localStorage.getItem('mm_affiliation_code'));
    const { data, error } = await this.client.rpc('upsert_musician_registry_profile', {
      p_license_key: licenseKey,
      p_musician_code: localCode,
      p_first_name: firstName,
      p_last_name: lastName,
      p_email: localStorage.getItem('mm_user_email'),
      p_phone: profileSnapshot.phone || null,
      p_instrument: profileSnapshot.instrument || null,
      p_role: profileSnapshot.workerType || null,
      p_metadata: {}
    });
    if (error) return null;
    const row = Array.isArray(data) ? data[0] : data;
    const code = (row?.musician_code as string | undefined) || null;
    if (!code) return null;
    localStorage.setItem('mm_affiliation_code', code);
    localStorage.setItem('musicianCode', code);
    const currentSettings = JSON.parse(localStorage.getItem('mm_settings') || '{}');
    localStorage.setItem('mm_settings', JSON.stringify({
      ...currentSettings,
      affiliationCode: code
    }));
    return code;
  }

  async loadRegistryProfileForCurrentContext(): Promise<Record<string, any> | null> {
    await this.init();
    if (!this.client) return null;
    let musicianCode = this.normalizeValidMusicianCode(localStorage.getItem('mm_affiliation_code') || localStorage.getItem('musicianCode') || '');
    if (!musicianCode) {
      const syncedCode = await this.syncAffiliationCodeFromLicense();
      musicianCode = syncedCode || '';
    }
    if (!musicianCode) return null;
    const { data, error } = await this.client
      .from('musician_registry_profiles')
      .select('first_name,last_name,email,phone,instrument,metadata,musician_code')
      .eq('musician_code', musicianCode)
      .order('created_at', { ascending: false })
      .limit(1);
    if (error || !Array.isArray(data) || !data.length) return null;
    const row: any = data[0] || {};
    const metadata = row.metadata || {};
    const social = metadata.social || {};
    return {
      firstName: row.first_name || '',
      lastName: row.last_name || '',
      licenseEmail: row.email || localStorage.getItem('mm_user_email') || '',
      phone: row.phone || '',
      instrument: row.instrument || '',
      birthDate: metadata.birthDate || '',
      birthPlace: metadata.birthPlace || '',
      fiscalCode: metadata.fiscalCode || '',
      residence: metadata.residence || '',
      homeBase: metadata.homeBase || '',
      workerType: metadata.workerType || '',
      lessonBillingMode: metadata.lessonBillingMode || 'fuori_fattura',
      musicBillingMode: metadata.musicBillingMode || 'fuori_fattura',
      taxRegime: metadata.taxRegime || 'ordinario',
      vatMode: metadata.vatMode || 'iva_ordinaria',
      irpefBracket: metadata.irpefBracket || '23',
      substituteTaxPercent: Number(metadata.substituteTaxPercent || 15),
      estimatedAnnualRevenue: Number(metadata.estimatedAnnualRevenue || 0),
      estimatedAnnualCosts: Number(metadata.estimatedAnnualCosts || 0),
      empalsPosition: metadata.empalsPosition || '',
      exemptEmployer: metadata.exemptEmployer || '',
      exemptEmployerType: metadata.exemptEmployerType || 'dipendente',
      level: metadata.level || '',
      stylesPlayed: Array.isArray(metadata.stylesPlayed) ? metadata.stylesPlayed : [],
      searchableStyles: Array.isArray(metadata.searchableStyles) ? metadata.searchableStyles : [],
      instagram: social.instagram || '',
      facebook: social.facebook || '',
      youtube: social.youtube || '',
      tiktok: social.tiktok || '',
      website: social.website || '',
      inpsExempt: metadata.inpsExempt === true,
      inpsNumber: metadata.inpsData?.number || '',
      inpsStartDate: metadata.inpsData?.startDate || '',
      inpsEndDate: metadata.inpsData?.endDate || '',
      isMusician: metadata.isMusician !== false,
      isTeacher: metadata.isTeacher === true,
      isDj: metadata.isDj === true,
      lessonColor: metadata.lessonColor || '#2e7d32',
      concertColor: metadata.concertColor || '#1565c0',
      djColor: metadata.djColor || '#8b5cf6'
    };
  }

  async searchArchiveEntities(query: string, entityType: 'musician' | 'band'): Promise<ArchiveEntity[]> {
    await this.init();
    if (!this.client) return this.searchArchiveLocal(query, entityType);
    if (this.archiveRemoteUnavailable) return this.searchArchiveLocal(query, entityType);
    if (entityType === 'musician') {
      const remote = await this.searchRegistryMusiciansRemote(query);
      if (remote) return remote;
      return this.searchArchiveLocal(query, entityType);
    }
    const remote = await this.searchBandsRemote(query);
    if (remote) return remote;
    return this.searchArchiveLocal(query, entityType);
  }

  async syncArchiveCodes(musicianCode: string, bandCode: string, musicianName?: string): Promise<boolean> {
    await this.init();
    if (!musicianCode || !bandCode) return false;
    const codeM = this.normalizeValidMusicianCode(musicianCode.trim().toUpperCase());
    if (!codeM) return false;
    const codeB = bandCode.trim().toUpperCase();
    const display = (musicianName || '').trim() || null;
    const rows: ArchiveEntity[] = [
      {
        entity_type: 'musician',
        entity_code: codeM,
        display_name: display,
        linked_code: codeB
      },
      {
        entity_type: 'band',
        entity_code: codeB,
        display_name: null,
        linked_code: codeM
      }
    ];
    if (!this.client || this.archiveRemoteUnavailable) {
      this.mergeArchiveLocal(rows);
      return true;
    }
    const { error } = await this.client.rpc('attach_band_to_musician_registry', {
      p_musician_code: codeM,
      p_band_id: null,
      p_band_code: codeB
    });
    if (!error) {
      this.mergeArchiveLocal(rows);
      return true;
    }
    if (this.isArchiveMissingError(error)) {
      this.archiveRemoteUnavailable = true;
      this.mergeArchiveLocal(rows);
      return true;
    }
    return false;
  }

  isArchiveRemoteAvailable(): boolean {
    return !this.archiveRemoteUnavailable;
  }

  private async executeMusicianWriteWithRetry(
    payload: Record<string, unknown>,
    musicianId?: string
  ): Promise<{ data: { id?: string; code?: string } | null; error: any }> {
    if (!this.client) return { data: null, error: new Error('Supabase non inizializzato') };
    const safePayload = { ...payload };
    const maxAttempts = 4;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const query = this.client.from('musicians');
      const result = musicianId
        ? await query.update(safePayload).eq('id', musicianId).select('id').single()
        : await query.insert(safePayload).select('id').single();
      const missingColumn = this.extractMissingColumn(result.error);
      if (!missingColumn) {
        return { data: result.data ? { id: result.data.id } : null, error: result.error };
      }
      if (missingColumn in safePayload) {
        delete safePayload[missingColumn];
        continue;
      }
      return { data: result.data ? { id: result.data.id } : null, error: result.error };
    }
    return { data: null, error: new Error('Schema non allineato: troppe colonne mancanti') };
  }

  private async executeMusicianUpdateWithRetry(
    payload: Record<string, unknown>,
    musicianId: string
  ): Promise<{ error: any }> {
    if (!this.client) return { error: new Error('Supabase non inizializzato') };
    const safePayload = { ...payload };
    for (let attempt = 0; attempt < 1; attempt++) {
      const result = await this.client.from('musicians').update(safePayload).eq('id', musicianId);
      const missingColumn = this.extractMissingColumn(result.error);
      if (!missingColumn || !(missingColumn in safePayload)) {
        return { error: result.error };
      }
      delete safePayload[missingColumn];
    }
    return { error: new Error('Schema non allineato: troppe colonne mancanti') };
  }

  private extractMissingColumn(error: any): string | null {
    const message = `${error?.message || ''} ${error?.details || ''}`.trim();
    if (!message) return null;
    const notFound = message.match(/Could not find the '([^']+)' column/i);
    if (notFound?.[1]) return notFound[1];
    const undefinedCol = message.match(/column "([^"]+)" does not exist/i);
    if (undefinedCol?.[1]) return undefinedCol[1];
    return null;
  }

  private isValidUuid(value: string | undefined): value is string {
    if (!value) return false;
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  }

  private readJsonArray<T>(key: string): T[] {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
      return [];
    }
  }

  private normalizeValidMusicianCode(raw: string | null | undefined): string | null {
    const value = `${raw || ''}`.trim().toUpperCase();
    if (!/^MU\d{4}$/.test(value)) return null;
    return value;
  }

  private isArchiveMissingError(error: any): boolean {
    const msg = `${error?.message || ''} ${error?.details || ''}`.toLowerCase();
    return msg.includes('404') || msg.includes('relation') || msg.includes('archive_directory');
  }

  private searchArchiveLocal(query: string, entityType: 'musician' | 'band'): ArchiveEntity[] {
    const normalized = (query || '').trim().toLowerCase();
    return this.readJsonArray<ArchiveEntity>('mm_archive_directory')
      .filter(row => row.entity_type === entityType)
      .filter(row => {
        if (entityType === 'musician') {
          return !!this.normalizeValidMusicianCode(row.entity_code);
        }
        return !!(row.entity_code || '').trim() && !!this.normalizeValidMusicianCode(row.linked_code || '');
      })
      .filter(row => {
        if (!normalized) return true;
        const code = (row.entity_code || '').toLowerCase();
        const name = (row.display_name || '').toLowerCase();
        const linked = (row.linked_code || '').toLowerCase();
        return code.includes(normalized) || name.includes(normalized) || linked.includes(normalized);
      })
      .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  }

  private async searchRegistryMusiciansRemote(query: string): Promise<ArchiveEntity[] | null> {
    if (!this.client) return null;
    const normalized = (query || '').trim();
    let req = this.client
      .from('musician_registry_profiles')
      .select('musician_code, first_name, last_name, metadata, created_at')
      .limit(80);
    if (normalized) {
      req = req.or(`musician_code.ilike.%${normalized}%,first_name.ilike.%${normalized}%,last_name.ilike.%${normalized}%`);
    }
    const { data, error } = await req.order('created_at', { ascending: false });
    if (error || !data) {
      if (this.isArchiveMissingError(error)) this.archiveRemoteUnavailable = true;
      return null;
    }
    const out: ArchiveEntity[] = [];
    (data as unknown as RegistryProfileRow[]).forEach(row => {
      const code = this.normalizeValidMusicianCode(row.musician_code);
      if (!code) return;
      const source = `${row.metadata?.['appSource'] || ''}`.trim().toLowerCase();
      if (source && source !== 'musician_manager') return;
      out.push({
        entity_type: 'musician',
        entity_code: code,
        display_name: `${row.first_name || ''} ${row.last_name || ''}`.trim() || 'Musicista',
        linked_code: row.metadata?.['bandRegistryCode'] || null,
        created_at: row.created_at
      });
    });
    return out;
  }

  private async searchBandsRemote(query: string): Promise<ArchiveEntity[] | null> {
    if (!this.client) return null;
    const { data, error } = await this.client.rpc('search_band_registry_codes', {
      p_query: (query || '').trim()
    });
    if (error || !data) {
      if (this.isArchiveMissingError(error)) this.archiveRemoteUnavailable = true;
      return null;
    }
    return (data as any[])
      .filter(row => !!`${row?.band_code || ''}`.trim())
      .filter(row => !!this.normalizeValidMusicianCode(`${row?.musician_code || ''}`))
      .map(row => ({
        entity_type: 'band',
        entity_code: row.band_code,
        display_name: row.band_name || null,
        linked_code: this.normalizeValidMusicianCode(`${row.musician_code || ''}`),
        created_at: row.created_at
      }));
  }

  private mergeArchiveLocal(rows: ArchiveEntity[]): void {
    const current = this.readJsonArray<ArchiveEntity>('mm_archive_directory');
    const now = new Date().toISOString();
    rows.forEach(row => {
      if (row.entity_type === 'musician' && !this.normalizeValidMusicianCode(row.entity_code)) return;
      if (row.entity_type === 'band' && !this.normalizeValidMusicianCode(row.linked_code || '')) return;
      const idx = current.findIndex(
        item => item.entity_type === row.entity_type && item.entity_code === row.entity_code
      );
      const next: ArchiveEntity = {
        ...row,
        created_at: idx >= 0 ? current[idx].created_at || now : now
      };
      if (idx >= 0) current[idx] = next;
      else current.push(next);
    });
    localStorage.setItem('mm_archive_directory', JSON.stringify(current));
  }

  private buildRegistryMetadata(m: Musician): Record<string, unknown> {
    return {
      homeBase: m.homeBase ?? null,
      birthDate: m.birthDate ?? null,
      birthPlace: m.birthPlace ?? null,
      fiscalCode: m.fiscalCode ?? null,
      residence: m.residence ?? null,
      workerType: m.workerType ?? null,
      lessonBillingMode: m.lessonBillingMode ?? null,
      musicBillingMode: m.musicBillingMode ?? null,
      taxRegime: m.taxRegime ?? 'ordinario',
      vatMode: m.vatMode ?? 'iva_ordinaria',
      irpefBracket: m.irpefBracket ?? '23',
      substituteTaxPercent: m.substituteTaxPercent ?? 15,
      estimatedAnnualRevenue: m.estimatedAnnualRevenue ?? 0,
      estimatedAnnualCosts: m.estimatedAnnualCosts ?? 0,
      empalsPosition: m.empalsPosition ?? null,
      enpalsCategory: m.enpalsCategory ?? null,
      exemptEmployer: m.exemptEmployer ?? null,
      exemptEmployerType: m.exemptEmployerType ?? null,
      level: m.level ?? null,
      stylesPlayed: m.stylesPlayed ?? [],
      searchableStyles: m.searchableStyles ?? [],
      social: m.social ?? {},
      inpsExempt: m.inpsExempt ?? false,
      inpsData: m.inpsData ?? null,
      isMusician: m.isMusician ?? true,
      isTeacher: m.isTeacher ?? false,
      isDj: m.isDj ?? false,
      appSource: 'musician_manager',
      appKey: 'musician_manager',
      lessonColor: m.lessonColor ?? null,
      concertColor: m.concertColor ?? null,
      djColor: m.djColor ?? null,
      djCode: m.djCode ?? null,
      signatureData: m.signatureData ?? null
    };
  }
}
