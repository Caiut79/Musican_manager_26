import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  GoogleCalendarService,
  ConnectionState
} from '../../core/google-calendar.service';
import {
  runMigration_WipePastEventsFromAppOnly,
  analyzeDuplicateStats,
  runMigration_DeduplicateEvents,
  runMigration_WipeAllLocalForNewCalendar,
  GoogleNoteFormat,
  DEFAULT_NOTE_FORMAT,
  LocalStorageService,
} from '../../core/local-storage.service';
import { EventDetail } from '../../models/event-detail';
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

  // --- Campi per DEDUPLICAZIONE EVENTI LOCALE (stesso titolo + data + tipo) ---
  dedupRunning = false;
  dedupMessage = '';
  dedupMessageIsError = false;
  dedupStats = {
    totalEvents: 0,
    duplicateGroupsCount: 0,
    duplicateEventsCount: 0,
    groups: [] as { key: string; sampleTitle: string; date: string; count: number; }[],
    lastRemovedCount: 0,
    lastGroupsCleaned: 0,
    lastBackupKey: '',
  };
  private _refreshDedupStats(): void {
    try {
      const s = analyzeDuplicateStats();
      this.dedupStats.totalEvents = s.totalEvents;
      this.dedupStats.duplicateGroupsCount = s.duplicateGroupsCount;
      this.dedupStats.duplicateEventsCount = s.duplicateEventsCount;
      this.dedupStats.groups = s.groups.slice(0, 8);
    } catch { /* ignora */ }
  }

  // --- Campi per DEDUPLICAZIONE GOOGLE REMOTA (sul Google Calendar) ---
  gDedupLoading = false;
  gDedupRunning = false;
  gDedupMessage = '';
  gDedupMessageIsError = false;
  gDedupStats = {
    totalEvents: 0,
    groups: 0,
    superflui: 0,
    samples: [] as { date: string; title: string; count: number; keptId: string; deleteIds: string[] }[],
    lastDeleted: 0,
    lastKept: 0,
    lastBackupKey: '',
  };
  private async _refreshGDedupStats(): Promise<void> {
    if (this.state !== 'connected') return;
    this.gDedupLoading = true;
    try {
      const s = await this.gcal.analyzeGoogleDuplicatesRemote();
      this.gDedupStats.totalEvents = s.totalEvents;
      this.gDedupStats.groups = s.groups;
      this.gDedupStats.superflui = s.superflui;
      this.gDedupStats.samples = s.samples.slice(0, 8);
    } catch { /* ignora */ } finally {
      this.gDedupLoading = false;
    }
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
    this._refreshDedupStats(); // ★ Statistiche deduplica live
    this._refreshResetStats(); // ★ Statistiche reset completo
    this._loadNoteFormatFromStorage(); // ★ Preferenze formato note Google
    this.gcal.connectionState$
      .pipe(takeUntil(this._destroy$))
      .subscribe((s) => {
        this.state = s;
        if (s === 'connected') {
          if (!this.selectedCalendarId) {
            void this.loadCalendarsAndAutoPick();
          }
          void this._refreshGDedupStats();
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
      this._refreshDedupStats(); // ★ Aggiorna anche stats dedup
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

  // ─── Azione: DEDUPLICAZIONE EVENTI (stesso titolo + data + tipo) ──────────
  public async onDedupEventsClick(): Promise<void> {
    if (this.dedupRunning) return;
    this.dedupRunning = true;
    this.dedupMessage = '';
    this.dedupMessageIsError = false;
    this._refreshDedupStats();

    const duplicates = this.dedupStats.duplicateEventsCount;
    if (duplicates === 0) {
      this.dedupMessage = '✅ Nessun evento duplicato! Il tuo calendario è già pulito.';
      this.dedupRunning = false;
      return;
    }

    // Conferma 2 fasi perché comunque rimuove eventi (anche se con backup!)
    const msg = `Procedere con la DEDUPLICAZIONE?\n\n` +
      `📦  Eventi totali presenti:    ${this.dedupStats.totalEvents}\n` +
      `🔍  Gruppi duplicati:          ${this.dedupStats.duplicateGroupsCount}\n` +
      `🗑️  Eventi superflui (N-1):    ${this.dedupStats.duplicateEventsCount}\n\n` +
      (this.dedupStats.groups.length ? `💡 Esempi:\n${this.dedupStats.groups.slice(0, 4).map(g => `   · ${g.date}: "${g.sampleTitle.slice(0, 40)}" ×${g.count}`).join('\n')}\n\n` : '') +
      `💾  Verrà creato un BACKUP COMPLETO nel browser.\n` +
      `🎯  Per ogni gruppo terrò 1 solo evento (quello con googleEventId o più recente).\n` +
      `🔒  Google Calendar NON VERRA' TOCATO (scritta LS diretta, bypass sync).\n\n` +
      `Confermi di voler procedere?`;
    const ok = window.confirm(msg);
    if (!ok) {
      this.dedupRunning = false;
      return;
    }

    try {
      const r = runMigration_DeduplicateEvents();
      this.dedupStats.lastRemovedCount = r.removedCount;
      this.dedupStats.lastGroupsCleaned = r.groupsCleaned;
      this.dedupStats.lastBackupKey = r.backupKey;
      this._refreshDedupStats();
      this._computeWipeStats();

      if (r.removedCount > 0) {
        this.dedupMessage =
          `✅ Deduplicazione completata! ` +
          `❌ Rimossi ${r.removedCount} eventi superflui (${r.groupsCleaned} gruppi puliti). ` +
          `✅ Restanti: ${r.afterCount} eventi. ` +
          `💾 Backup LS: ${(r.backupKey || 'creato').slice(0, 45)}...` +
          ` ⚠️  RICARICA la pagina (F5) per vedere le liste AGGIORNATE e i badge riallineati!`;
      } else {
        this.dedupMessage = '⚠️ Nessun evento rimosso (backup fatto, controlla Console DevTools).';
        this.dedupMessageIsError = true;
      }
    } catch (err) {
      console.error('[UI] dedup fallito:', err);
      this.dedupMessage = `❌ Errore durante deduplica: ${String(err)}`;
      this.dedupMessageIsError = true;
    } finally {
      this.dedupRunning = false;
    }
  }

  // ─── Azione: DEDUPLICAZIONE GOOGLE CALENDAR REMOTO ────────────────────────
  public async onDedupGoogleCalendarClick(): Promise<void> {
    if (this.gDedupRunning) return;
    await this._refreshGDedupStats();
    if (this.state !== 'connected') {
      this.gDedupMessage = '⚠️ Connetti prima Google Calendar per eseguire deduplica remota.';
      this.gDedupMessageIsError = true;
      return;
    }
    this.gDedupRunning = true;
    this.gDedupMessage = '';
    this.gDedupMessageIsError = false;

    const superflui = this.gDedupStats.superflui;
    if (superflui === 0) {
      this.gDedupMessage = '✅ Perfetto! Nessun duplicato sul tuo Google Calendar.';
      this.gDedupRunning = false;
      return;
    }

    // Conferma (1a fase) — riassunto numeri
    const msg1 =
      `🚨 STAI PER ELIMINARE EVENTI DA GOOGLE CALENDAR (REALE, NON SOLO LOCALE)!\n\n` +
      `📦  Eventi Google (da cutoff): ${this.gDedupStats.totalEvents}\n` +
      `🔍  Gruppi duplicati:             ${this.gDedupStats.groups}\n` +
      `🗑️  Copie SUPERFLUE (da CANCELLARE):  ${superflui}\n` +
      `✅  Eventi mantenuti (1 per grp):   ${this.gDedupStats.groups}\n\n` +
      (this.gDedupStats.samples.length ?
        `💡 Esempi di gruppi trovati:\n${this.gDedupStats.samples.slice(0, 4).map((g: any) =>
          `   · ${g.date}: "${g.title.slice(0, 40)}" ×${g.count}`).join('\n')}\n\n` : '') +
      `💾  BACKUP AUTOMATICO in localStorage prima delle API DELETE.\n` +
      `🎯  Per ogni gruppo terrò l'evento più RECENTE (ultimo aggiornamento).\n\n` +
      `Confermi di voler procedere? (CONFERMA 1/2)`;

    const ok1 = window.confirm(msg1);
    if (!ok1) { this.gDedupRunning = false; return; }

    // Conferma 2a fase — enfasi IRREVERSIBILITA' Google
    const msg2 =
      `⚠️  ULTIMA CONFERMA — AZIONE DIRETTAMENTE SU GOOGLE.\n\n` +
      `Eliminerò ${superflui} copie duplicate DAL TUO GOOGLE CALENDAR.\n` +
      `Questo rimuoverà anche le notifiche push sui tuoi dispositivi per quelle copie.\n\n` +
      `👉 Se invece vuoi prima controllare manualmente su google.com/calendar,\n` +
      `   clicca ANNULLA e poi torna qui quando sei pronto.\n\n` +
      `PROSEGUIRE? (CONFERMA 2/2)`;

    const ok2 = window.confirm(msg2);
    if (!ok2) { this.gDedupRunning = false; return; }

    try {
      const r = await this.gcal.deduplicateGoogleEventsRemote();
      if (r.error) {
        this.gDedupMessage = `❌ Errore: ${r.error}`;
        this.gDedupMessageIsError = true;
        this.gDedupRunning = false;
        return;
      }
      this.gDedupStats.lastDeleted = r.deleted;
      this.gDedupStats.lastKept = r.kept;
      this.gDedupStats.lastBackupKey = r.backupKey;
      await this._refreshGDedupStats();

      if (r.deleted > 0) {
        this.gDedupMessage =
          `✅ Google Calendar pulito! ` +
          `❌ Eliminati ${r.deleted} duplicati (${r.kept} gruppi mantenuti). ` +
          `💾 Backup chiavi ID: ${(r.backupKey || 'creato').slice(0, 48)}... ` +
          `👉 Ora vai in Dashboard, clicca Sincronizza Google, poi F5 per aggiornare i badge!`;
      } else {
        this.gDedupMessage = '⚠️ Nessun evento rimosso da Google (backup salvato comunque).';
        this.gDedupMessageIsError = true;
      }
    } catch (err) {
      console.error('[UI] dedup Google fallito:', err);
      this.gDedupMessage = `❌ Errore durante deduplica Google: ${String(err)}`;
      this.gDedupMessageIsError = true;
    } finally {
      this.gDedupRunning = false;
    }
  }

  // --- Campi per RESET COMPLETO (Nuovo Calendario Google) ---
  resetRunning = false;
  resetMessage = '';
  resetMessageIsError = false;
  resetStats = {
    eventsBefore: 0,
    paymentsBefore: 0,
    backupKey: '',
    keysWiped: 0,
  };
  private _refreshResetStats(): void {
    try {
      const rawEv = localStorage.getItem('mm_events');
      if (rawEv) {
        const arr = JSON.parse(rawEv);
        this.resetStats.eventsBefore = Array.isArray(arr) ? arr.length : 0;
      } else this.resetStats.eventsBefore = 0;

      const rawPay = localStorage.getItem('mm_service_payments');
      if (rawPay) {
        const arr = JSON.parse(rawPay);
        this.resetStats.paymentsBefore = Array.isArray(arr) ? arr.length : 0;
      } else this.resetStats.paymentsBefore = 0;
    } catch { /* ignora */ }
  }

  /** 🚨 Handler UI: RESET COMPLETO LOCALE per nuovo calendario Google (3 conferme!) */
  public async onResetForNewCalendarClick(): Promise<void> {
    if (this.resetRunning) return;
    this.resetRunning = true;
    this.resetMessage = '';
    this.resetMessageIsError = false;
    this._refreshResetStats();

    const totEv = this.resetStats.eventsBefore;
    const totPay = this.resetStats.paymentsBefore;

    // CONFERMA 1: riassunto cosa facciamo
    const msg1 =
      `🚨 AZIONE DEFINITIVA (1/3): RESET COMPLETO LOCALE\n\n` +
      `Stai per RIPULIRE TUTTA la memoria locale della App per partire\n` +
      `dal NUOVO calendario Google che hai creato (quello pulito con 8-9 date).\n\n` +
      `📦 Cosa verrà CANCELLATO in APP (solo locale!):\n` +
      `   ❌ ${totEv} eventi/concerti/lezioni in mm_events\n` +
      `   ❌ ${totPay} pagamenti storici in mm_service_payments\n` +
      `   ❌ Stati popup pagamenti non pagati, richieste booking, ecc.\n\n` +
      `🪪 Cosa verrà CONSERVATO (non dovrai reinserire nulla):\n` +
      `   ✅ Profilo musicista Nome/Ruoli/Studio\n` +
      `   ✅ Sessione Google OAuth + Email connessa + Client ID\n` +
      `   ✅ 🎚️ Filtro "Sincronizza da:" cutoff date\n` +
      `   ✅ Impostazioni Supabase/Tema scuro/ecc.\n\n` +
      `🔒 NESSUNO dei tuoi calendari Google (né vecchio, né nuovo!) verrà MAI toccato.\n\n` +
      `💾 Verrà creato BACKUP TOTALE di TUTTO (tutte le chiavi LS mm_*).\n\n` +
      `👉 Se NON hai ancora creato il nuovo calendario su Google, ANNULLA ORA.\n\n` +
      `Confermi reset LOCALE (1/3)?`;
    const ok1 = window.confirm(msg1);
    if (!ok1) { this.resetRunning = false; return; }

    // CONFERMA 2: controllo selezione calendario
    const selectedName = this.selectedCalendarSummary || '(nessuno selezionato)';
    const msg2 =
      `⚠️  CONTROLLO IMPORTANTE (2/3):\n\n` +
      `Dopo questo reset sarai guidato a:\n` +
      `  1. Selezionare il NUOVO calendario pulito nella tendina.\n` +
      `  2. Cliccare Sincronizza → importi 8-9 eventi PULITI.\n\n` +
      `Calendario SELEZIONATO ORA nella tendina:\n` +
      `     📅 "${selectedName}"\n\n` +
      `⚠️  Assicurati che il NUOVO calendario compaia nella lista (altrimenti\n` +
      `   prima clicca "🔄 Ricarica lista calendari" nella card in alto).\n\n` +
      `Confermi di essere pronto per il reset (2/3)?`;
    const ok2 = window.confirm(msg2);
    if (!ok2) { this.resetRunning = false; return; }

    // CONFERMA 3: estrema sicurezza
    const msg3 =
      `🚨 ULTIMA CONFERMA (3/3):\n\n` +
      `Dopo aver cliccato OK non c'è più ritorno (se non tramite backup).\n\n` +
      `Cancellare TUTTI gli eventi e pagamenti LOCALI per\niniziare da capo col NUOVO calendario Google pulito?\n\n` +
      `👉 Scrivi mentalmente "SI SONO SICURO" e clicca OK.`;
    const ok3 = window.confirm(msg3);
    if (!ok3) { this.resetRunning = false; return; }

    try {
      const r = runMigration_WipeAllLocalForNewCalendar();
      if (!r.backupKey) {
        this.resetMessage = '❌ Reset ANNULLATO: BACKUP FALLITO per sicurezza. Contatta supporto.';
        this.resetMessageIsError = true;
        this.resetRunning = false;
        return;
      }
      this.resetStats.backupKey = r.backupKey;
      this.resetStats.keysWiped = r.keysWiped.length;
      this._refreshResetStats();
      this._computeWipeStats();
      this._refreshDedupStats();
      void this._refreshGDedupStats();

      const eventsAfter = r.eventsCleared - r.eventsCleared; // = 0
      this.resetMessage =
        `✅ RESET COMPLETO ESEGUITO con successo! ` +
        `❌ Eventi cancellati: ${r.eventsCleared}. ` +
        `❌ Pagamenti cancellati: ${r.paymentsCleared}. ` +
        `🗝️ Chiavi LS svuotate: ${r.keysWiped.length}. ` +
        `💾 Backup totale LS: ${r.backupKey.slice(0, 55)}... ` +
        `⚡ F5 ADESSO! Poi: seleziona NUOVO calendario → imposta cutoff → clicca Sincronizza → importi 8-9 eventi puliti ✅`;
    } catch (err) {
      console.error('[UI Reset] errore:', err);
      this.resetMessage = `❌ Errore durante reset: ${String(err)}`;
      this.resetMessageIsError = true;
    } finally {
      this.resetRunning = false;
    }
  }

  // ─── 📝 Formato Note Google Calendar (11 checkbox + anteprima) ─────────────

  /** 📝 Stato 11 checkbox del formato note. */
  noteFormat: GoogleNoteFormat = { ...DEFAULT_NOTE_FORMAT };

  /** 📝 Evento demo usato per l'ANTEPRIMA LIVE nella sezione note (non viene
   *  mai salvato da nessuna parte, è solo un esempio per visualizzare il
   *  formato prima che l'utente decida le preferenze). */
  readonly previewSampleEvent: EventDetail = {
    id: 'preview-sample-abc123',
    title: 'Concerto al Verdi con i JazzFunk',
    date: new Date().toISOString().slice(0, 10),
    timeStart: '21:00',
    timeEnd: '23:30',
    venue: 'Teatro Verdi',
    address: 'Via Giuseppe Verdi 12, 20121 Milano MI',
    type: 'concert',
    band: [
      { name: 'Claudio Zampa', instrument: 'Chitarra' },
      { name: 'Luca Bianchi', instrument: 'Batteria' },
    ],
    grossFee: 600,
    netFee: 480,
    compensoType: 'fuori_fattura',
    notes: 'Ricordati le provette nuove e le ultime 3 canzoni aggiunte nel set. Fare soundcheck alle 18:30 con il fonico Roberto.',
    status: 'confirmed',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  /** 📝 Helper array per renderizzare 11 checkbox in HTML senza duplicare
   *  template. Ogni entry mappa chiave GoogleNoteFormat → label umana. */
  readonly noteFormatFields: {
    key: keyof GoogleNoteFormat;
    label: string;
    desc?: string;
    sensitive?: boolean;
  }[] = [
    { key: 'includeVenue',       label: '🎭 Teatro / Locale' },
    { key: 'includeAddress',     label: '📍 Indirizzo (via + CAP)' },
    { key: 'includeTimes',       label: '⌚ Orari inizio · fine' },
    { key: 'includeType',        label: '🎶 Tipo evento (Concerto/Lezione/DJ)' },
    { key: 'includeStatus',      label: '✅ Stato evento (Confermato/Attesa)' },
    { key: 'includeBand',        label: '👥 Musicisti (Componenti Band)' },
    { key: 'includeGrossFee',    label: '💵 Compenso Lordo €',
      sensitive: true, desc: '⚠️ Disattivalo se condividi il calendario con persone non del team.' },
    { key: 'includeNetFee',      label: '💰 Compenso Netto €',
      sensitive: true, desc: '⚠️ Dato privato. Disattivalo se il calendario è condiviso.' },
    { key: 'includeCompensoType',label: '🍀 Tipo compenso (In/Fuori fattura)' },
    { key: 'includeNotes',       label: '📝 Note libere (campo note evento)' },
    { key: 'includeAppFooter',   label: '🎵 Footer "Musicista Manager"' },
  ];

  /** 📝 Inizializza noteFormat dalle preference salvate in LS GcalSettings. */
  private _loadNoteFormatFromStorage(): void {
    try {
      const svc = new LocalStorageService();
      const stored = svc.getGcalSettings().noteFormat;
      if (stored && typeof stored === 'object') {
        this.noteFormat = { ...DEFAULT_NOTE_FORMAT, ...(stored as GoogleNoteFormat) };
      }
    } catch { /* ignora e usa default */ }
  }

  /** 📝 Toggle singolo checkbox e salvataggio immediato in LS. */
  public onNoteCheckboxToggle(key: keyof GoogleNoteFormat): void {
    this.noteFormat = { ...this.noteFormat, [key]: !this.noteFormat[key] };
    this._saveNoteFormat();
  }

  /** 📝 Ripristina formato note al DEFAULT del piano (tutti true tranne footer). */
  public onNoteFormatResetDefaults(): void {
    this.noteFormat = { ...DEFAULT_NOTE_FORMAT };
    this._saveNoteFormat();
  }

  /** 📝 Disattiva TUTTE le checkbox (nessuna nota su Google). Utile per
   *  utenti che vogliono il sync solo di title/date/orari e niente altro. */
  public onNoteFormatClearAll(): void {
    this.noteFormat = {
      includeVenue: false, includeAddress: false, includeBand: false,
      includeType: false,  includeStatus: false, includeGrossFee: false,
      includeNetFee: false, includeCompensoType: false, includeTimes: false,
      includeNotes: false, includeAppFooter: false,
    };
    this._saveNoteFormat();
  }

  /** 📝 Salva GoogleNoteFormat in LS GcalSettings.noteFormat (patch). */
  private _saveNoteFormat(): void {
    try {
      const svc = new LocalStorageService();
      svc.patchGcalSettings({ noteFormat: { ...this.noteFormat } });
    } catch (err) {
      console.error('[UI NoteFormat] patchGcalSettings fallito:', err);
    }
  }

  /** 📝 Getter per anteprima HTML: stringa formattata come la vedremo su
   *  Google Calendar (stessa funzione usata in produzione da GCal service). */
  public get notePreviewText(): string {
    try {
      const text = this.gcal.buildGoogleDescriptionFromFormat(this.previewSampleEvent, this.noteFormat);
      return text && text.trim().length ? text.trim() : '(nessuna nota — descrizione Google sarà vuota)';
    } catch {
      return '(errore generazione anteprima)';
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
