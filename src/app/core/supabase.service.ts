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
    const musicianCode = localStorage.getItem('mm_affiliation_code') || localStorage.getItem('musicianCode') || null;
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
    const id = row?.id as string | undefined;
    const code = (row?.musician_code as string | undefined) || musicianCode || undefined;
    if (code) {
      localStorage.setItem('mm_affiliation_code', code);
      localStorage.setItem('musicianCode', code);
    }
    if (id) {
      localStorage.setItem('musicianId', id);
    }
    return { id, code };
  }

  async addEvent(musicianId: string, title: string, date: string, type: 'lesson' | 'concert'): Promise<void> {
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

  async syncAllFromLocalStorage(musicianId: string): Promise<void> {
    try {
      await this.syncEventsFromLocalStorage(musicianId);
    } catch {
    }
    try {
      await this.syncExpensesFromLocalStorage(musicianId);
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
    const { data, error } = await this.client.rpc('upsert_musician_registry_profile', {
      p_license_key: licenseKey,
      p_musician_code: localStorage.getItem('mm_affiliation_code'),
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
    const codeM = musicianCode.trim().toUpperCase();
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

  private isArchiveMissingError(error: any): boolean {
    const msg = `${error?.message || ''} ${error?.details || ''}`.toLowerCase();
    return msg.includes('404') || msg.includes('relation') || msg.includes('archive_directory');
  }

  private searchArchiveLocal(query: string, entityType: 'musician' | 'band'): ArchiveEntity[] {
    const normalized = (query || '').trim().toLowerCase();
    return this.readJsonArray<ArchiveEntity>('mm_archive_directory')
      .filter(row => row.entity_type === entityType)
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
    return (data as unknown as RegistryProfileRow[]).map(row => ({
      entity_type: 'musician',
      entity_code: row.musician_code,
      display_name: `${row.first_name || ''} ${row.last_name || ''}`.trim() || 'Musicista',
      linked_code: row.metadata?.['bandRegistryCode'] || null,
      created_at: row.created_at
    }));
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
    return (data as any[]).map(row => ({
      entity_type: 'band',
      entity_code: row.band_code,
      display_name: row.band_name || null,
      linked_code: row.musician_code || null,
      created_at: row.created_at
    }));
  }

  private mergeArchiveLocal(rows: ArchiveEntity[]): void {
    const current = this.readJsonArray<ArchiveEntity>('mm_archive_directory');
    const now = new Date().toISOString();
    rows.forEach(row => {
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
      isTeacher: m.isTeacher ?? false,
      lessonColor: m.lessonColor ?? null,
      concertColor: m.concertColor ?? null,
      signatureData: m.signatureData ?? null
    };
  }
}
