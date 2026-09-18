import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { SupabaseService } from '../../core/supabase.service';
import { EventDetail } from '../../models/event-detail';
import { readEventsWithBackfill, persistEventsWithSync, readEventsForDisplay } from '../../core/local-storage.service';
import { GoogleCalendarService } from '../../core/google-calendar.service';

// Helper parsing JSON sicuro da localStorage (pattern condiviso)
function safeParse<T = any>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; }
  catch { return fallback; }
}

type EventItem = { id: string; title: string; date: string; timeStart: string; type: 'lesson' | 'concert' | 'dj_set' | 'rehearsal' | 'other'; counterpart: string };
type EventKind = 'lesson' | 'concert' | 'dj_set';

@Component({
  selector: 'app-agenda',
  templateUrl: './agenda.component.html',
  styleUrls: ['./agenda.component.scss']
})
export class AgendaComponent implements OnInit, OnDestroy {
  events: EventItem[] = [];
  formError = '';
  gcalQuickMsg = '';

  // Pulisci sottoscrizioni a eventi GCal quando la view viene distrutta.
  private readonly _destroy$ = new Subject<void>();

  // Ruoli attivi del profilo (da mm_profile_snapshot)
  isMusicianProfile = true;
  isTeacherProfile = false;
  isDjProfile = false;

  // Stato connessione Google Calendar (snapshot leggibile dal template)
  gcalState: 'not_configured' | 'disconnected' | 'connecting' | 'connected' | 'expired' | 'error' = 'disconnected';

  // Tipi evento disponibili in base ai ruoli selezionati
  availableTypes: EventKind[] = [];
  defaultType: EventKind = 'concert';

  form = this.fb.group({
    title: ['', Validators.required],
    date: ['', Validators.required],
    timeStart: ['', Validators.required],
    type: ['concert' as EventKind, Validators.required]
  });

  lessonColor = localStorage.getItem('lessonColor') || '#2e7d32';
  concertColor = localStorage.getItem('concertColor') || '#1565c0';
  djColor = localStorage.getItem('djColor') || '#8b5cf6';

  constructor(
    private fb: FormBuilder,
    private supabase: SupabaseService,
    private gcal: GoogleCalendarService
  ) {}

  ngOnInit(): void {
    // Stato connessione GCal (snapshot iniziale, rilegto ad ogni render click)
    this.gcalState = this.gcal.connectionStateSnapshot;

    // Quando GCal importa eventi remoti → ricarica lista + calendario in memoria
    this.gcal.eventsChanged$.pipe(takeUntil(this._destroy$)).subscribe(() => {
      this._reloadEventsFromStorage();
    });

    // Carica i ruoli dal profilo salvato
    const profile = safeParse<any>(localStorage.getItem('mm_profile_snapshot'), {});
    this.isMusicianProfile = profile?.isMusician !== false;
    this.isTeacherProfile  = profile?.isTeacher  === true;
    this.isDjProfile       = profile?.isDj       === true;

    // Calcola i tipi evento disponibili e il default coerente
    const avail: EventKind[] = [];
    if (this.isTeacherProfile) avail.push('lesson');
    if (this.isMusicianProfile) avail.push('concert');
    if (this.isDjProfile) avail.push('dj_set');
    // Fallback: se nessun ruolo è attivo, mantieni almeno concert per sicurezza
    this.availableTypes = avail.length > 0 ? avail : ['concert'];
    this.defaultType = this.availableTypes[0];

    // Imposta il valore di default del select sul primo tipo disponibile
    const currentType = this.form.get('type')?.value;
    if (!currentType || !this.availableTypes.includes(currentType as EventKind)) {
      this.form.get('type')?.setValue(this.defaultType);
    }

    // Filtra gli eventi salvati mostrando solo quelli appartenenti ai ruoli attivi
    const allEvents: EventDetail[] = readEventsForDisplay();
    const acceptedTypes = new Set<string>(this.availableTypes);
    this.events = allEvents
      .filter(event => acceptedTypes.has(event.type as string))
      .map(event => ({
        id: event.id,
        title: event.title,
        date: event.date,
        timeStart: `${event.timeStart || ''}`,
        type: event.type as EventItem['type'],
        counterpart: this.resolveCounterpart(event)
      } as EventItem))
      .sort((a, b) => b.date.localeCompare(a.date));
  }

  async add(): Promise<void> {
    if (this.form.invalid) return;
    const v = this.form.value;
    this.formError = '';
    if (this.hasScheduleConflict(v.date || '', v.timeStart || '')) {
      this.formError = 'Slot già occupato in agenda: cambia orario';
      return;
    }
    const created: EventItem = { id: crypto.randomUUID(), title: v.title ?? '', date: v.date ?? '', timeStart: v.timeStart ?? '', type: (v.type ?? 'other') as EventItem['type'], counterpart: '' };
    this.events = [created, ...this.events].sort((a, b) => b.date.localeCompare(a.date));
    const mmEvents: EventDetail[] = readEventsWithBackfill();
    mmEvents.unshift({
      id: created.id,
      title: created.title,
      date: created.date,
      timeStart: created.timeStart,
      venue: '',
      address: '',
      type: created.type,
      band: [],
      grossFee: 0,
      netFee: 0,
      status: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    persistEventsWithSync(mmEvents);
    const musicianId = localStorage.getItem('musicianId');
    if (musicianId) {
      try {
        await this.supabase.addEvent(musicianId, created.title, created.date, created.type as 'lesson' | 'concert' | 'dj_set');
      } catch {
      }
    }
    this.form.reset({ type: this.defaultType });
  }

  eventColor(type: EventItem['type']): string {
    if (type === 'lesson') return this.lessonColor;
    if (type === 'dj_set') return this.djColor;
    return this.concertColor;
  }

  eventTypeLabel(type: EventItem['type']): string {
    if (type === 'lesson') return 'Lezione';
    if (type === 'dj_set') return 'DJ Set';
    return 'Concerto';
  }

  private resolveCounterpart(event: EventDetail): string {
    if (event.type === 'concert' || event.type === 'dj_set') {
      const bandNames = Array.isArray(event.band) ? event.band.map(x => `${x?.name || ''}`.trim()).filter(Boolean) : [];
      if (bandNames.length) return bandNames.join(', ');
      const venue = `${event.venue || ''}`.trim();
      return venue;
    }
    const venue = `${event.venue || ''}`.trim();
    if (venue) return venue;
    const fromTitle = `${event.title || ''}`.match(/con\s+(.+)$/i);
    return fromTitle?.[1]?.trim() || '';
  }

  private hasScheduleConflict(date: string, timeStart: string): boolean {
    if (!date || !timeStart) return false;
    const allEvents: EventDetail[] = readEventsWithBackfill();
    return allEvents.some(event => {
      if (event.status === 'cancelled') return false;
      return event.date === date && `${event.timeStart || ''}` === timeStart;
    });
  }

  /** Sync manuale rapido da Google Calendar (header pulsante) */
  async quickSyncGcal(): Promise<void> {
    this.gcalQuickMsg = '';
    if (this.gcalState !== 'connected') {
      this.gcalQuickMsg = 'Connetti Google Calendar dal Profilo per sincronizzare';
      return;
    }
    try {
      this.gcalQuickMsg = 'Sincronizzazione in corso…';
      const report = await this.gcal.importGoogleEvents();
      if (report) {
        const msg = [
          report.imported ? `${report.imported} nuovi` : null,
          report.updated ? `${report.updated} aggiornati` : null,
          report.skipped ? `${report.skipped} invariati` : null,
          report.conflicts ? `${report.conflicts} conflitti` : null
        ].filter(Boolean).join(' · ');
        this.gcalQuickMsg = msg ? `Sync completato: ${msg}` : 'Sync completato, nessuna modifica';
        // Ricarica lista eventi nella pagina
        this._reloadEventsFromStorage();
      } else {
        this.gcalQuickMsg = 'Nessun report restituito';
      }
    } catch (err) {
      console.error('Agenda quickSyncGcal fallito:', err);
      this.gcalQuickMsg = 'Errore durante la sincronizzazione (vedi console)';
    }
  }

  /** Ricarica la lista eventi visualizzata dopo una sync */
  private _reloadEventsFromStorage(): void {
    const allEvents: EventDetail[] = readEventsForDisplay();
    const acceptedTypes = new Set<string>(this.availableTypes);
    this.events = allEvents
      .filter(event => acceptedTypes.has(event.type as string) || event.type === 'other')
      .map(event => ({
        id: event.id,
        title: event.title,
        date: event.date,
        timeStart: `${event.timeStart || ''}`,
        type: (event.type === 'other' ? 'concert' : event.type) as EventItem['type'],
        counterpart: this.resolveCounterpart(event)
      } as EventItem))
      .sort((a, b) => b.date.localeCompare(a.date));
  }

  ngOnDestroy(): void {
    this._destroy$.next();
    this._destroy$.complete();
  }
}
