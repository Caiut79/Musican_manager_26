import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  GoogleCalendarService,
  ConnectionState
} from '../../core/google-calendar.service';
import {
  runMigration_WipePastEventsFromAppOnly
} from '../../core/local-storage.service';
import { Subject, takeUntil } from 'rxjs';

// --- Tipo per voce calendario mostrato in dropdown --------------------------
type CalendarOption = { id: string; summary: string; primary?: boolean; description?: string };

@Component({
  selector: 'app-google-integration',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './google-integration.component.html',
  styleUrls: ['./google-integration.component.scss']
})
export class GoogleIntegrationComponent implements OnInit, OnDestroy {

  state: ConnectionState = 'disconnected';
  connectedEmail = '';
  selectedCalendarId = '';
  selectedCalendarSummary = '';
  lastSyncAt = '';
  lastSyncReport = { imported: 0, updated: 0, skipped: 0, conflicts: 0 };

  calendars: CalendarOption[] = [];
  loadingCalendars = false;
  showCalendarPicker = false;
  showInstructions = false;

  syncing = false;
  syncMessage = '';

  // --- Campi per input Client ID dalla UI ---
  clientIdInput = '';
  clientIdSaving = false;
  clientIdMessage = '';
  clientIdMessageIsError = false;

  // --- Campi per INPUT DATA INIZIO SINCRO (cutoff) ---
  syncStartDateInput = '';
  syncStartDateSaving = false;
  syncStartDateMessage = '';
  syncStartDateMessageIsError = false;
  syncStartDateDisplay = '';

  // --- Campi per PULIZIA EVENTI PASSATI (solo App, non Google) ---
  wipeRunning = false;
  wipeMessage = '';
  wipeMessageIsError = false;
  wipeStats = { beforeTotal: 0, beforePast: 0, beforeFuture: 0, removed: 0, backupKey: '' };
  private _computeWipeStats(): void {
    try {
      const now = new Date();
      const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      let events: any[] = [];
      try { events = JSON.parse(localStorage.getItem('mm_events') || '[]') || []; } catch {}
      this.wipeStats.beforeTotal  = events.length;
      this.wipeStats.beforePast   = events.filter((e: any) => !!e.date && e.date < todayIso).length;
      this.wipeStats.beforeFuture = events.filter((e: any) => !!e.date && e.date >= todayIso).length;
    } catch { /* ignora */ }
  }

  private readonly _destroy$ = new Subject<void>();

  constructor(private readonly gcal: GoogleCalendarService) {}

  ngOnInit(): void {
    this.clientIdInput = this.gcal.savedClientId;
    // Inizializza INPUT DATA INIZIO SINCRO dal service (default: oggi -1 gg)
    const initialCutoff = this.gcal.syncStartDateSnapshot;
    this.syncStartDateInput = initialCutoff;
    this.syncStartDateDisplay = this._formatSyncStartDateIta(initialCutoff);
    this._computeWipeStats();
    this.gcal.connectionState$
      .pipe(takeUntil(this._destroy$))
      .subscribe((s) => {
        this.state = s;
        if (s === 'connected') {
          if (!this.selectedCalendarId) {
            void this.loadCalendarsAndAutoPick();
          }
        } else if (s === 'not_configured') {
          this.showInstructions = true;
          if (!this.clientIdInput) this.clientIdInput = this.gcal.savedClientId;
        } else if (s === 'disconnected') {
          // Appena il Client ID diventa valido (stato passa da not_configured),
          // ripuliamo messaggi di errore dell'input
          this.clientIdMessage = '';
        }
      });
    this.gcal.connectedEmail$.pipe(takeUntil(this._destroy$)).subscribe((v) => (this.connectedEmail = v));
    this.gcal.selectedCalendarId$.pipe(takeUntil(this._destroy$)).subscribe((v) => (this.selectedCalendarId = v));
    this.gcal.selectedCalendarSummary$.pipe(takeUntil(this._destroy$)).subscribe((v) => (this.selectedCalendarSummary = v));
    this.gcal.lastSyncAt$.pipe(takeUntil(this._destroy$)).subscribe((v) => (this.lastSyncAt = v));
    this.gcal.lastSyncReport$.pipe(takeUntil(this._destroy$)).subscribe((v) => (this.lastSyncReport = v));
    // Aggiorna INPUT/DISPLAY data cutoff in tempo reale quando cambia nel service
    this.gcal.syncStartDate$.pipe(takeUntil(this._destroy$)).subscribe((v) => {
      const val = v || this.gcal.syncStartDateSnapshot;
      if (val) {
        this.syncStartDateInput = val;
        this.syncStartDateDisplay = this._formatSyncStartDateIta(val);
      }
    });
  }

  ngOnDestroy(): void {
    this._destroy$.next();
    this._destroy$.complete();
  }

  // ─── Azioni UI ─────────────────────────────────────────────────────────────

  public async onConnectClick(): Promise<void> {
    if (this.state === 'not_configured') {
      this.showInstructions = true;
      return;
    }
    await this.gcal.startOAuthFlow();
  }

  public onDisconnectClick(): void {
    this.gcal.disconnect();
    this.calendars = [];
  }

  public toggleInstructions(): void {
    this.showInstructions = !this.showInstructions;
  }

  /** Salva il Client ID OAuth 2.0 inserito nella casella direttamente in LS. */
  public async onSaveClientId(): Promise<void> {
    this.clientIdSaving = true;
    this.clientIdMessage = '';
    this.clientIdMessageIsError = false;
    try {
      const res = await this.gcal.saveClientId(this.clientIdInput);
      this.clientIdMessage = res.message;
      this.clientIdMessageIsError = !res.ok;
      if (res.ok) {
        // Ricarica valore per sicurezza (normalizza whitespace)
        this.clientIdInput = this.gcal.savedClientId;
        setTimeout(() => (this.clientIdMessage = ''), 6000);
      }
    } catch (err) {
      console.error('[UI-GCal] saveClientId fallito:', err);
      this.clientIdMessage = 'Errore durante il salvataggio (vedi console)';
      this.clientIdMessageIsError = true;
    } finally {
      this.clientIdSaving = false;
    }
  }

  /** Salva la DATA DI INIZIO SINCRO (cutoff YYYY-MM-DD) tramite service. */
  public async onSaveSyncStartDate(): Promise<void> {
    this.syncStartDateSaving = true;
    this.syncStartDateMessage = '';
    this.syncStartDateMessageIsError = false;
    try {
      const res = await this.gcal.setSyncStartDate(this.syncStartDateInput);
      this.syncStartDateMessage = res.message;
      this.syncStartDateMessageIsError = !res.ok;
      if (res.ok) {
        const cur = this.gcal.syncStartDateSnapshot;
        this.syncStartDateInput = cur;
        this.syncStartDateDisplay = this._formatSyncStartDateIta(cur);
        this._computeWipeStats();
        setTimeout(() => (this.syncStartDateMessage = ''), 9000);
      }
    } catch (err) {
      console.error('[UI-GCal] setSyncStartDate fallito:', err);
      this.syncStartDateMessage = 'Errore salvataggio (vedi console DevTools).';
      this.syncStartDateMessageIsError = true;
    } finally {
      this.syncStartDateSaving = false;
    }
  }

  /** Ripristina il filtro data al valore SUGGERITO automatico (data di oggi).
   *  Utile per gli utenti che vogliono tornare a un comportamento standard
   *  (sincronizza da oggi in poi) senza dover scegliere manualmente una data. */
  public async onResetSyncStartDateToToday(): Promise<void> {
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    this.syncStartDateInput = today;
    await this.onSaveSyncStartDate();
  }

  /** Formatta YYYY-MM-DD → "Giorno 17 Settembre 2026 (ITA)" per label UI. */
  private _formatSyncStartDateIta(iso: string): string {
    if (!iso) return '';
    try {
      const d = new Date(iso + 'T00:00:00');
      if (Number.isNaN(d.getTime())) return iso;
      return d.toLocaleDateString('it-IT', {
        weekday: 'long',
        day: '2-digit',
        month: 'long',
        year: 'numeric'
      });
    } catch {
      return iso;
    }
  }

  public async loadCalendarsAndAutoPick(): Promise<void> {
    this.loadingCalendars = true;
    try {
      const list = await this.gcal.fetchCalendarList();
      this.calendars = list;
      if (list.length && !this.gcal.selectedCalendarIdSnapshot) {
        const primary = list.find((c) => c.primary) ?? list[0];
        await this.gcal.setSelectedCalendarId(primary.id, primary.summary);
      }
      this.showCalendarPicker = list.length > 0;
    } finally {
      this.loadingCalendars = false;
    }
  }

  public async onCalendarChange(id: string): Promise<void> {
    const chosen = this.calendars.find((c) => c.id === id);
    await this.gcal.setSelectedCalendarId(id, chosen?.summary);
  }

  public async runSyncFromGoogle(): Promise<void> {
    if (this.syncing) return;
    this.syncing = true;
    this.syncMessage = 'Sto scaricando gli eventi da Google Calendar…';
    try {
      const report = await this.gcal.importGoogleEvents();
      this.syncMessage =
        report.imported || report.updated || report.conflicts
          ? `Sincronizzati: ${report.imported} nuovi · ${report.updated} aggiornati · ${report.skipped} saltati · ${report.conflicts} conflitti`
          : 'Nessuna modifica rilevata, dati già allineati.';
    } catch (err) {
      console.error('[UI-GCal] import fallito:', err);
      this.syncMessage = 'Sincronizzazione non riuscita. Riprova tra qualche secondo o riconnettiti.';
    } finally {
      this.syncing = false;
      setTimeout(() => (this.syncMessage = ''), 8000);
    }
  }

  // ─── Azione: Pulizia Eventi PASSATI dalla APP (NON da Google!) ─────────────
  public async onWipePastEventsClick(): Promise<void> {
    if (this.wipeRunning) return;
    this.wipeRunning = true;
    this.wipeMessage = '';
    this.wipeMessageIsError = false;
    this._computeWipeStats();

    const beforePast = this.wipeStats.beforePast;
    if (beforePast === 0) {
      this.wipeMessage = '✅ Non hai eventi passati da cancellare! Tutto pulito già.';
      this.wipeMessageIsError = false;
      this.wipeRunning = false;
      return;
    }

    // Conferma esplicita UTENTE (2 fasi) perché è irreversibile!
    const msg = `Procedere con la PULIZIA?\n\n` +
      `🗓️  Eventi PASSATI (< oggi):   ${beforePast}\n` +
      `🔮  Eventi OGGI + FUTURO:      ${this.wipeStats.beforeFuture}\n\n` +
      `⚠️  Verranno rimossi SOLAMENTE dalla Musican Manager.\n` +
      `🔒  GOOGLE CALENDAR NON VERRA' TOCATO IN NESSUN MODO!\n` +
      `💾  PRIMA verrà creato un BACKUP COMPLETO nel browser.\n\n` +
      `Confermi di voler procedere?`;
    const ok = window.confirm(msg);
    if (!ok) {
      this.wipeRunning = false;
      return;
    }

    try {
      // Rimuoviamo flag precedente se per sbaglio c'era (permettiamo riesecuzione)
      try { localStorage.removeItem('mm_migration_wipe_past_events_v1'); } catch {}
      // Eseguiamo la migrazione UFFICIALE (backup + wipe + LS direct bypass sync)
      const removed = runMigration_WipePastEventsFromAppOnly();
      this.wipeStats.removed = removed;
      try {
        const bk = Object.keys(localStorage)
          .filter(k => k.startsWith('mm_backup_pre_wipe_past_'))
          .sort()
          .reverse()[0];
        if (bk) this.wipeStats.backupKey = bk;
      } catch {}
      this._computeWipeStats();
      if (removed > 0) {
        this.wipeMessage =
          `✅ Pulizia completata con successo! ` +
          `❌ Rimossi ${removed} eventi passati + pagamenti associati. ` +
          `🔒 Google Calendar intatto. 💾 Backup LS: ${this.wipeStats.backupKey || 'creato'}` +
          ` ⚠️  RICARICA la pagina (F5) per vedere le liste AGGIORNATE!`;
      } else {
        this.wipeMessage = '⚠️ Nessun evento rimosso. Controlla Console DevTools per dettagli.';
        this.wipeMessageIsError = true;
      }
    } catch (err) {
      console.error('[UI] wipe passatoio fallito:', err);
      this.wipeMessage = `❌ Errore durante la pulizia: ${String(err)}`;
      this.wipeMessageIsError = true;
    } finally {
      this.wipeRunning = false;
    }
  }

  public get statusLabel(): string {
    switch (this.state) {
      case 'not_configured': return 'Client ID non configurato';
      case 'disconnected':   return 'Non connesso';
      case 'connecting':     return 'Connessione in corso…';
      case 'connected':      return this.connectedEmail
        ? `Connesso come ${this.connectedEmail}`
        : 'Connesso';
      case 'expired':        return 'Sessione scaduta — riconnettiti';
      case 'error':          return 'Errore di connessione';
    }
  }

  public get statusColorClass(): string {
    switch (this.state) {
      case 'connected':  return 'badge-green';
      case 'connecting': return 'badge-amber';
      case 'expired':    return 'badge-red';
      case 'error':      return 'badge-red';
      case 'not_configured': return 'badge-gray';
      case 'disconnected':   return 'badge-gray';
    }
  }

  public get canSync(): boolean {
    return this.state === 'connected' && !!this.selectedCalendarId && !this.syncing;
  }

  public get canConnect(): boolean {
    return this.state !== 'connecting' && this.state !== 'connected';
  }

  public get syncHasError(): boolean {
    if (!this.syncMessage) return false;
    const m = this.syncMessage.toLowerCase();
    return m.includes('non riuscita') || m.includes('errore');
  }

  // Getter helper per evitare accessi annidati nel template (parser errori)
  public get rptImported(): number { return this.lastSyncReport.imported ?? 0; }
  public get rptUpdated(): number  { return this.lastSyncReport.updated ?? 0; }
  public get rptSkipped(): number  { return this.lastSyncReport.skipped ?? 0; }
  public get rptConflicts(): number { return this.lastSyncReport.conflicts ?? 0; }
  public get rptHasAny(): boolean {
    const t = this.lastSyncReport;
    return (t.imported ?? 0) + (t.updated ?? 0) + (t.skipped ?? 0) + (t.conflicts ?? 0) > 0;
  }

  public formatSyncAtLabel(): string {
    if (!this.lastSyncAt) return 'Non ancora sincronizzato';
    try {
      const d = new Date(this.lastSyncAt);
      return d.toLocaleString('it-IT', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
      });
    } catch {
      return this.lastSyncAt;
    }
  }

  /** Numero giorno corrente, mostrato nell'icona SVG della card. */
  public get todayDayNumber(): string {
    return new Date().getDate().toString();
  }
}
