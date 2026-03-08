import { Injectable } from '@angular/core';
import { ConfigService } from './config.service';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Musician } from '../models/musician';
import { EventDetail } from '../models/event-detail';
import { Expense } from '../models/expense';

@Injectable({ providedIn: 'root' })
export class SupabaseService {
  private client: SupabaseClient | null = null;

  constructor(private config: ConfigService) {}

  async init(): Promise<void> {
    if (this.client) return;
    await this.config.load();
    const cfg = this.config.getSupabaseConfig();
    if (!cfg) {
      throw new Error('Supabase config non trovata');
    }
    this.client = createClient(cfg.url, cfg.anonKey);
  }

  async insertMusician(m: Musician): Promise<{ id?: string; code?: string }> {
    return this.saveMusician(m);
  }

  async saveMusician(m: Musician, musicianId?: string): Promise<{ id?: string; code?: string }> {
    await this.init();
    if (!this.client) throw new Error('Supabase non inizializzato');
    const payload = {
      first_name: m.firstName,
      last_name: m.lastName,
      phone: m.phone ?? null,
      birth_date: m.birthDate ?? null,
      birth_place: m.birthPlace ?? null,
      fiscal_code: m.fiscalCode ?? null,
      residence: m.residence ?? null,
      worker_type: m.workerType ?? null,
      empals_position: m.empalsPosition ?? null,
      enpals_category: m.enpalsCategory ?? m.empalsPosition ?? null,
      exempt_employer: m.exemptEmployer ?? null,
      exempt_employer_type: m.exemptEmployerType ?? null,
      inps_number: m.inpsData?.number ?? null,
      inps_start_date: m.inpsData?.startDate ?? null,
      inps_end_date: m.inpsData?.endDate ?? null,
      home_base: m.homeBase ?? null,
      instrument: m.instrument ?? null,
      level: m.level ?? null,
      styles_played: m.stylesPlayed ?? [],
      searchable_styles: m.searchableStyles ?? [],
      social: m.social ?? {},
      inps_exempt: m.inpsExempt ?? false,
      inps_data: m.inpsData ?? null,
      is_teacher: m.isTeacher ?? false,
      lesson_color: m.lessonColor ?? null,
      concert_color: m.concertColor ?? null,
      signature_data: m.signatureData ?? null
    };

    const query = this.client.from('solo.musicians');
    const { data, error } = musicianId
      ? await query.update(payload).eq('id', musicianId).select('id, code').single()
      : await query.insert(payload).select('id, code').single();

    if (error) {
      throw error;
    }
    return { id: data?.id, code: data?.code };
  }

  async addEvent(musicianId: string, title: string, date: string, type: 'lesson' | 'concert'): Promise<void> {
    await this.init();
    if (!this.client) throw new Error('Supabase non inizializzato');
    const { error } = await this.client.from('solo.events').insert({
      musician_id: musicianId,
      title,
      date,
      type,
      source_id: crypto.randomUUID()
    });
    if (error) throw error;
  }

  async syncMusicianFromLocalStorage(musicianId: string): Promise<void> {
    await this.init();
    if (!this.client) throw new Error('Supabase non inizializzato');
    const updates = {
      first_name: localStorage.getItem('mm_firstName'),
      last_name: localStorage.getItem('mm_lastName'),
      home_base: localStorage.getItem('mm_homeBase'),
      phone: localStorage.getItem('mm_phone'),
      fiscal_code: localStorage.getItem('mm_fiscalCode'),
      signature_data: localStorage.getItem('mm_signature')
    };
    const payload = Object.fromEntries(
      Object.entries(updates).filter(([, value]) => value !== null && value !== '')
    );
    if (!Object.keys(payload).length) return;
    const { error } = await this.client.from('solo.musicians').update(payload).eq('id', musicianId);
    if (error) throw error;
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
      .from('solo.events')
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
      .from('solo.expenses')
      .upsert(rows, { onConflict: 'musician_id,source_id', ignoreDuplicates: false });
    if (error) throw error;
  }

  async syncAllFromLocalStorage(musicianId: string): Promise<void> {
    await this.syncMusicianFromLocalStorage(musicianId);
    await this.syncEventsFromLocalStorage(musicianId);
    await this.syncExpensesFromLocalStorage(musicianId);
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
}
