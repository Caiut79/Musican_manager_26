import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, Subject } from 'rxjs';
import { filter, distinctUntilChanged, tap } from 'rxjs/operators';
import { EventDetail } from '../models/event-detail';
import {
  LocalStorageService,
  GcalSettings,
  GoogleNoteFormat,
  DEFAULT_NOTE_FORMAT,
  readEventsWithBackfill,
  writeEventsWithTimestamp,
  registerGlobalOutgoingSyncHandler,
  tombstoneAddDeletedGoogleEventId,
  tombstoneHasDeletedGoogleEventId,
  tombstoneHasDeletedTitleDate,
  normalizeTitleForDedup,
  eventDateTitleDedupKey,
  eventFullDedupKey,
} from './local-storage.service';

// ─── Tipi interni ────────────────────────────────────────────────────────────

export type ConnectionState =
  | 'not_configured'   // ClientId mancante o placeholder
  | 'disconnected'     // Config ok ma utente non loggato
  | 'connecting'       // OAuth flow in corso
  | 'connected'        // Token valido in memoria
  | 'expired'          // Token presente ma scaduto / 401 ricevuto
  | 'error';           // Errore irreversibile

type GoogleCalendarEntry = {
  id: string;
  summary: string;
  description?: string;
  primary?: boolean;
  timeZone?: string;
};

type GoogleEvent = {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  status?: string;
  updated?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?:   { dateTime?: string; date?: string; timeZone?: string };
};

type SyncReport = {
  imported: number;
  updated: number;
  skipped: number;
  conflicts: number;
};

type GsiTokenResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
  error?: string;
  error_description?: string;
};

// ─── Servizio ─────────────────────────────────────────────────────────────────

@Injectable({ providedIn: 'root' })
export class GoogleCalendarService {
  // ─── Stato pubblico osservabile ────────────────────────────────────────────
  private readonly _connectionState$ = new BehaviorSubject<ConnectionState>('disconnected');
  public readonly connectionState$: Observable<ConnectionState> = this._connectionState$.asObservable();

  private readonly _connectedEmail$ = new BehaviorSubject<string>('');
  public readonly connectedEmail$: Observable<string> = this._connectedEmail$.asObservable();

  private readonly _selectedCalendarId$ = new BehaviorSubject<string>('');
  public readonly selectedCalendarId$: Observable<string> = this._selectedCalendarId$.asObservable();

  private readonly _selectedCalendarSummary$ = new BehaviorSubject<string>('');
  public readonly selectedCalendarSummary$: Observable<string> = this._selectedCalendarSummary$.asObservable();

  private readonly _lastSyncAt$ = new BehaviorSubject<string>('');
  public readonly lastSyncAt$: Observable<string> = this._lastSyncAt$.asObservable();

  private readonly _lastSyncReport$ = new BehaviorSubject<SyncReport>(
    { imported: 0, updated: 0, skipped: 0, conflicts: 0 }
  );
  public readonly lastSyncReport$: Observable<SyncReport> = this._lastSyncReport$.asObservable();

  /** ⭐ DATA DI INIZIO SINCRO (cutoff):
   *  - Eventi Google con data < di questa data → NON vengono IMPORTATI
   *  - Eventi app con data < di questa data → NON vengono INVIATI/MODIFICATI/CANCELLATI su Google
   *  Default: oggi - 1 giorno (se non salvato in LS); Formato: YYYY-MM-DD */
  private readonly _syncStartDate$ = new BehaviorSubject<string>('');
  public readonly syncStartDate$: Observable<string> = this._syncStartDate$.asObservable();

  /**
   * Evento emesso DOPO che una scrittura REMOTA ha cambiato gli eventi in
   * localStorage (es. importGoogleEvents, o patch googleEventId post-create
   * in syncOutgoingDelta). Le viste (Dashboard/Agenda) lo ascoltano per
   * ricaricare i propri array in memoria (altrimenti servirebbe F5).
   */
  private readonly _eventsChanged$ = new Subject<void>();
  public readonly eventsChanged$: Observable<void> = this._eventsChanged$.asObservable();
  /** 🔄 Forza il reload degli eventi in TUTTE le viste (Dashboard, Agenda,
   *  Lista Concerti, ecc.). Chiamato da componenti dopo operazioni manuali
   *  che scrivono direttamente LS bypassando il service (es. pulsante Dedup
   *  locale, Wipe Past, Reset Completo). Senza questo servirebbe F5 manuale. */
  public triggerEventsRefresh(): void {
    try { this._eventsChanged$.next(); } catch { /* ignora */ }
  }

  // ─── Stato privato interno ─────────────────────────────────────────────────
  private _config: { clientId: string; scopes: string[] } | null = null;
  private _gsiLoaded = false;
  private _token: string | null = null;
  private _tokenExpiresAt: number = 0; // ms epoca
  private _tokenClient: any = null;
  /** ID del timeout setTimeout per auto-refresh 10 min prima della scadenza */
  private _autoRefreshTimer: number | null = null;
  /** Preventivi per refresh loop infiniti: contatore refresh falliti consecutivi */
  private _consecutiveRefreshFails = 0;

  private readonly TOMBSTONE_KEY = 'mm_gcal_tombstones_deleted_ids';
  /** @deprecated Use i wrapper condivisi {tombstoneAddDeletedGoogleEventId, tombstoneHasDeletedGoogleEventId} da LS service. */
  private readonly _deletedGoogleEventIds = new Set<string>();
  /** true = almeno un ID aggiunto durante questa sessione e non salvato */
  private _tombstoneDirty = false;

  /** @deprecated Ora carica il set persistito tramite wrapper condiviso (stessa chiave LS). */
  private _tombstoneLoad(): void {
    // (mantenuto vuoto per retrocompatibilità — non viene più usato)
  }
  /** @deprecated Usa tombstoneAddDeletedGoogleEventId (pubblico, LS service). */
  private _tombstonePersist(): void { /* non usato più */ }
  /** Wrapper verso helper condiviso (entry point SEMPRE garantito persistEventsWithSync + defense-in-depth qui). */
  private _tombstoneAdd(googleEventId: string | null | undefined): boolean {
    return tombstoneAddDeletedGoogleEventId(googleEventId);
  }
  /** Wrapper verso helper condiviso (skip tassativo import loop). */
  private _tombstoneHas(googleEventId: string | null | undefined): boolean {
    return tombstoneHasDeletedGoogleEventId(googleEventId);
  }

  private readonly GOOGLE_API_BASE = 'https://www.googleapis.com';
  private readonly GSI_SCRIPT_URL = 'https://accounts.google.com/gsi/client';

  // ═══════════════════════════════════════════════════════════════════════
  //  🔁  RETRY AUTOMATICO + THROTTLE + CIRCUIT BREAKER rateLimit 403
  // ═══════════════════════════════════════════════════════════════════════
  //
  // Problema Claudio: HTTP 403 "Rate Limit Exceeded" in cascata durante
  // le modifiche/cancellazioni. Soluzione:
  //
  // 1) fetchWithRetry(): wrapper fetch con backoff esponenziale 2s → 4s → 8s
  //    (max 3 tentativi) per TUTTE le chiamate API CRUD
  // 2) throttle 180ms: aspetta 180ms TRA OGNI CHIAMATA, cosi' non saturiamo
  //    il bucket di Google Calendar (~100 richieste / 100s utente)
  // 3) Circuit breaker: ogni volta che tocchiamo rateLimit 403,
  //    aspettiamo 30 secondi PRIMA di fare qualsiasi altra chiamata
  //    (break tutte le code pending)
  // 4) Tombstone GUARIGIONE: deleteGoogleEvent ANCHE SE FALLISCE aggiorna
  //    il Set tombstone (lo aggiungiamo comunque ai marcati cancellati)
  //
  private _throttleLastCall = 0;
  private readonly THROTTLE_MS = 180;
  private _circuitBreakUntil = 0;
  private readonly CIRCUIT_BREAK_MS_403 = 30_000; // 30 sec pausa se 403 rateLimit

  /** Attesa sincrona (delay). */
  private _sleep(ms: number): Promise<void> {
    return new Promise<void>((res) => setTimeout(res, ms));
  }

  /** Controlla circuit breaker e throttle PRIMA di ogni fetch. */
  private async _throttleAndCircuitCheck(label: string): Promise<void> {
    // 1) Circuit breaker: se siamo in pausa per rate limit, aspettiamo!
    const now = Date.now();
    if (this._circuitBreakUntil > now) {
      const waitMs = this._circuitBreakUntil - now + 100;
      console.warn(`[GCal] 🔌 CIRCUIT BREAKER: rateLimitExceeded prima, pausa ${Math.round(waitMs / 1000)}s prima di "${label}"...`);
      await this._sleep(waitMs);
    }
    // 2) Throttle: attendi quanto basta tra le chiamate
    const throttleDiff = this._throttleLastCall + this.THROTTLE_MS - Date.now();
    if (throttleDiff > 0) await this._sleep(throttleDiff);
    this._throttleLastCall = Date.now();
  }

  /** Wrapper fetch universale:
   *  - max 3 tentativi con backoff 2s, 4s, 8s su 429/500/502/503/504
   *  - su 403 rateLimit → attiva circuit breaker 30s (ritenta comunque un ultimo tentativo)
   *  - su 401 chiama _onUnauthorized
   *  - applica throttle 180ms tra chiamate
   *  Ritorna Response (chiamante decide come parsare). */
  private async _fetchWithRetry(url: string, opts: RequestInit, label: string): Promise<Response> {
    let lastErr: unknown = null;
    let lastResp: Response | null = null;
    const maxTries = 3;
    for (let attempt = 0; attempt < maxTries; attempt++) {
      // Throttle + circuit breaker prima di OGNI tentativo
      await this._throttleAndCircuitCheck(`${label} [${attempt + 1}/${maxTries}]`);
      try {
        lastResp = await fetch(url, opts);
        // Gestisci 401 Unauthorized (token scaduto / invalido)
        if (lastResp.status === 401) {
          this._onUnauthorized();
          return lastResp;
        }
        // 403 Forbidden → controlla se è rateLimit
        if (lastResp.status === 403) {
          const body = await lastResp.clone().text().catch(() => '');
          const isRateLimit =
            /rateLimitExceeded/i.test(body) ||
            /quotaExceeded/i.test(body) ||
            /usageLimits/i.test(body) ||
            /User Rate Limit Exceeded/i.test(body);
          if (isRateLimit) {
            // ATTIVA CIRCUIT BREAKER
            this._circuitBreakUntil = Date.now() + this.CIRCUIT_BREAK_MS_403;
            console.warn(`[GCal] ⚠️ rateLimitExceeded "${label}" [${attempt + 1}/${maxTries}] → circuit breaker: pausa ${Math.round(this.CIRCUIT_BREAK_MS_403 / 1000)}s`);
          }
          // Se è ultimo tentativo → ritorna errore 403 al chiamante
          if (attempt === maxTries - 1) return lastResp;
          // Altrimenti: fallback nel catch del delay per backoff
          const delay = 2000 * Math.pow(2, attempt);
          console.info(`[GCal] Retry ${attempt + 2}/${maxTries} "${label}" tra ${delay / 1000}s per 403 rateLimit...`);
          await this._sleep(delay);
          continue;
        }
        // 429 Too Many Requests: ritenta con delay + backoff
        if (lastResp.status === 429) {
          if (attempt === maxTries - 1) return lastResp;
          const delay = 2000 * Math.pow(2, attempt);
          console.info(`[GCal] 429 TooMany "${label}" [${attempt + 1}/${maxTries}] → retry tra ${delay / 1000}s...`);
          await this._sleep(delay);
          continue;
        }
        // 5xx server error: ritenta
        if (lastResp.status >= 500 && lastResp.status < 600) {
          if (attempt === maxTries - 1) return lastResp;
          const delay = 2000 * Math.pow(2, attempt);
          console.info(`[GCal] 5xx Server "${label}" [${attempt + 1}/${maxTries}] → retry tra ${delay / 1000}s...`);
          await this._sleep(delay);
          continue;
        }
        // OK (200-299), 304, 404 Not Found, 400 validation → ritorna
        return lastResp;
      } catch (err) {
        // Errore rete fetch (offline / DNS / CORS). Retry con backoff.
        lastErr = err;
        if (attempt === maxTries - 1) {
          throw err;
        }
        const delay = 2000 * Math.pow(2, attempt);
        console.warn(`[GCal] Fetch errore rete "${label}" [${attempt + 1}/${maxTries}]: ${String(err)} → retry tra ${delay / 1000}s...`);
        await this._sleep(delay);
      }
    }
    // Fine tentativi: se abbiamo una response la ritorniamo al chiamante, altrimenti throw
    if (lastResp) return lastResp;
    throw lastErr || new Error(`_fetchWithRetry fallito senza risposta per "${label}"`);
  }
  /** Scope OAuth: `calendar` (ampio) permette sia:
   *  - leggere la lista calendari /users/me/calendarList
   *  - CRUD eventi calendar/v3/events
   *  Non usare calendar.events perché ESCLUDE la lettura della lista calendari (causa 403 Forbidden). */
  private readonly REQUIRED_SCOPE = 'https://www.googleapis.com/auth/calendar';

  constructor(private readonly ls: LocalStorageService) {
    // 1) Carica subito il TOMBSTONE in memoria (PRIMA di qualsiasi sync!)
    this._tombstoneLoad();
    // All'avvio carico la configurazione e lo stato salvato
    void this._initFromStorage();
    // Registro hook globale per push automatico app -> Google dopo scritture
    registerGlobalOutgoingSyncHandler((prev, next) => { this.syncOutgoingDelta(prev, next); });

    // Catch-up push automatico quando la connessione diventa 'connected'
    // (es. dopo login OAuth). Aspetta 300ms per dare tempo al token di essere
    // salvato e al selectedCalendarId di essere caricato da LS.
    this._connectionState$
      .pipe(
        filter((st) => st === 'connected'),
        distinctUntilChanged(),
        tap(() => setTimeout(() => this.catchUpPushLocalEvents(), 400))
      )
      .subscribe();

    // Catch-up push anche quando l'utente cambia/seleziona il calendario di destinazione:
    // se ci sono eventi locali senza googleEventId, li creiamo subito nel nuovo calendario.
    this._selectedCalendarId$
      .pipe(
        filter((id) => !!id && this._connectionState$.value === 'connected'),
        distinctUntilChanged(),
        tap(() => setTimeout(() => this.catchUpPushLocalEvents(), 200))
      )
      .subscribe();
  }

  // ─── Accessori pubblici di convenienza ─────────────────────────────────────

  public get connectionStateSnapshot(): ConnectionState {
    return this._connectionState$.value;
  }

  public get selectedCalendarIdSnapshot(): string {
    return this._selectedCalendarId$.value;
  }

  public get connectedEmailSnapshot(): string {
    return this._connectedEmail$.value;
  }

  /** Valore corrente DATA DI INIZIO SINCRO (cutoff YYYY-MM-DD).
   *  Se non salvato in localStorage → default: OGGI - 1 giorno
   *  (da 17 settembre se oggi è 18 settembre). */
  public get syncStartDateSnapshot(): string {
    if (this._syncStartDate$.value) return this._syncStartDate$.value;
    return this._defaultSyncStartDate();
  }

  /** Aggiorna la DATA DI INIZIO SINCRO (cutoff YYYY-MM-DD):
   *  - La salva in localStorage (patch GcalSettings)
   *  - Notifica BehaviorSubject (UI si aggiorna in tempo reale)
   *  - Effettua validazione formato YYYY-MM-DD */
  public async setSyncStartDate(dateIso: string): Promise<{ ok: boolean; message: string }> {
    const raw = `${dateIso || ''}`.trim();
    // Validazione formato YYYY-MM-DD
    const regex = /^\d{4}-\d{2}-\d{2}$/;
    if (!regex.test(raw)) {
      return { ok: false, message: 'Formato data non valido. Usa YYYY-MM-DD (es. 2026-09-17).' };
    }
    // Verifica che la data sia valida (non 2026-13-45)
    const d = new Date(raw + 'T00:00:00');
    if (Number.isNaN(d.getTime())) {
      return { ok: false, message: 'Data non valida (controlla giorno/mese/anno).' };
    }
    try {
      await this.ls.patchGcalSettings({ syncStartDate: raw });
      this._syncStartDate$.next(raw);
      return { ok: true, message: `✅ Data inizio sincronizzazione impostata a ${raw}.\nEventi precedenti a questa data saranno ignorati (import e push).` };
    } catch (err) {
      console.error('[GCal] setSyncStartDate fallito:', err);
      return { ok: false, message: 'Errore salvataggio in localStorage.' };
    }
  }

  /** Helper interno: calcola OGGI - 1 giorno (formato YYYY-MM-DD). */
  private _defaultSyncStartDate(): string {
    const d = new Date();
    d.setDate(d.getDate() - 1); // ieri
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const g = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${g}`;
  }

  /** ⚡ Helper CONDIZIONE CHIAVE per TUTTE le sincronizzazioni bidirezionali:
   *  restituisce TRUE se una data evento E' DENTRO la finestra di sincronizzazione
   *  (data >= syncStartDate). Se FALSE → l'evento viene ignorato COMPLETAMENTE. */
  public isEventWithinSyncWindow(dateIso: string | null | undefined): boolean {
    if (!dateIso) return false;
    const cutoff = this.syncStartDateSnapshot; // usa getter → default se vuoto
    return `${dateIso}` >= cutoff;
  }

  // ─── Setup & Config ────────────────────────────────────────────────────────

  /**
   * Normalizza scope OAuth: assicura che lo scope 'calendar' (completo) sia presente.
   * Se l'utente ha 'calendar.events' legacy (non basta per calendarList), lo sostituiamo.
   * Restituisce array di scopes validi.
   */
  private _normalizeScopes(input: string[] | string | null | undefined): string[] {
    const arr = Array.isArray(input) ? input.map(String).filter(Boolean) : input ? [`${input}`] : [];
    const joined = arr.join(' ');
    if (joined.includes('/auth/calendar') && !joined.includes('/auth/calendar.events') && !joined.includes('/auth/calendar.calendarlist')) {
      // Scope 'calendar' generico già presente: ok (include tutto)
      return arr.filter((s) => s.includes('/auth/calendar'));
    }
    // Fallback: forza sempre lo scope completo (include lista calendari + CRUD eventi)
    return [this.REQUIRED_SCOPE];
  }

  /**
   * Carica configurazione in ordine di priorità:
   *  1. localStorage (GcalSettings.clientId, salvato dalla UI scheda Integrazioni)
   *  2. assets/google.config.json (fallback statico)
   * Se entrambi mancano o clientId è placeholder → stato not_configured.
   */
  public async loadConfig(): Promise<void> {
    // --- Step 1: prova localStorage (vince se presente) ---
    const lsSettings = this.ls.getGcalSettings();
    let clientId = `${lsSettings.clientId || ''}`.trim();
    let scopes: string[] = this._normalizeScopes(lsSettings.scopes);
    // Se in LS c'era lo scope obsoleto calendar.events, aggiorniamo senza chiedere:
    if (Array.isArray(lsSettings.scopes) && lsSettings.scopes.some((s) => s.includes('calendar.events'))) {
      try {
        this.ls.patchGcalSettings({ scopes: [this.REQUIRED_SCOPE] });
      } catch {}
    }

    // --- Step 2: se in LS non c'è, prova file assets statico ---
    if (!clientId || clientId.includes('YOUR_OAUTH_CLIENT_ID') || clientId.includes('PLACEHOLDER')) {
      try {
        const response = await fetch('/assets/google.config.json', { cache: 'no-cache' });
        if (response.ok) {
          const cfg = await response.json();
          const fileClientId = `${cfg?.clientId || ''}`.trim();
          if (fileClientId && !fileClientId.includes('YOUR_OAUTH_CLIENT_ID') && !fileClientId.includes('PLACEHOLDER')) {
            clientId = fileClientId;
          }
          const fileScopes = this._normalizeScopes(cfg?.scopes);
          if (fileScopes.length) scopes = fileScopes;
        }
      } catch (err) {
        // File assets non caricabile: non bloccare, è facoltativo se l'utente
        // ha già configurato il Client ID dalla UI (in LS).
      }
    }

    if (!clientId || clientId.includes('YOUR_OAUTH_CLIENT_ID') || clientId.includes('PLACEHOLDER')) {
      this._config = null;
      this._connectionState$.next('not_configured');
      return;
    }

    this._config = { clientId, scopes };
    if (this._connectionState$.value === 'not_configured') {
      this._connectionState$.next('disconnected');
    }
  }

  /**
   * Salva il Client ID OAuth 2.0 direttamente in localStorage (senza editare file).
   * Dopo il salvataggio ricarica la configurazione (ri-passaggio per OAuth).
   * Restituisce true se il formato sembra valido (xxx.apps.googleusercontent.com).
   */
  public async saveClientId(clientId: string): Promise<{ ok: boolean; message: string }> {
    const id = `${clientId || ''}`.trim();
    if (!id) {
      return { ok: false, message: 'Inserisci un valore valido' };
    }
    if (!id.includes('.apps.googleusercontent.com') && !id.includes('-')) {
      return {
        ok: false,
        message: 'Formato non valido. Deve essere simile a: 123456-abc123.apps.googleusercontent.com'
      };
    }
    // Salva SEMPRE lo scope completo calendar, non il vecchio calendar.events (obsoleto)
    this.ls.patchGcalSettings({
      clientId: id,
      scopes: [this.REQUIRED_SCOPE]
    });
    await this.loadConfig();
    return { ok: true, message: 'Client ID salvato! Ora puoi connettere Google Calendar.' };
  }

  /** Restituisce l'ultimo Client ID noto (da LS). Per UI precompilazione input. */
  public get savedClientId(): string {
    return this.ls.getGcalSettings().clientId || '';
  }

  /**
   * Carica lazy lo script Google Identity Services.
   * Risolve già al primo caricamento.
   */
  public async lazyLoadGsiScript(): Promise<void> {
    if (this._gsiLoaded) return;
    if (typeof window === 'undefined') return;
    if ((window as any).google?.accounts) {
      this._gsiLoaded = true;
      return;
    }
    return new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = this.GSI_SCRIPT_URL;
      script.async = true;
      script.defer = true;
      script.onload = () => {
        this._gsiLoaded = true;
        resolve();
      };
      script.onerror = () => {
        reject(new Error('Impossibile caricare Google Identity Services (GSI). Verifica la connessione.'));
      };
      document.head.appendChild(script);
    });
  }

  // ─── OAuth / Connessione ───────────────────────────────────────────────────

  /**
   * Avvia il flusso OAuth 2.0 usando Google Identity Services.
   *
   * NOTA: In SPA pura senza backend NON usiamo Authorization Code + PKCE
   * perché l'exchange `code → access_token` su oauth2.googleapis.com/token
   * richiede client_secret (non distribuibile nel browser) o il tipo client
   * "Desktop/Web" con CORS non sempre abilitato. Usiamo invece
   * initTokenClient (implicit flow): l'access token arriva direttamente via
   * redirect_uri / callback popup. Durata ~1h, salvato solo in memoria.
   * Se un domani c'è un backend, migrare a Code + PKCE è banale.
   */
  public async startOAuthFlow(): Promise<void> {
    if (!this._config) {
      try { await this.loadConfig(); } catch {}
      if (!this._config) {
        this._connectionState$.next('not_configured');
        return;
      }
    }

    try {
      await this.lazyLoadGsiScript();
    } catch (err) {
      console.error('[GCal] GSI non disponibile:', err);
      this._connectionState$.next('error');
      return;
    }

    const google = (window as any).google;
    if (!google?.accounts?.oauth2) {
      this._connectionState$.next('error');
      return;
    }

    this._connectionState$.next('connecting');

    // ⚠️ RICREIAMO SEMPRE il tokenClient quando l'utente clicca "Connetti".
    // Non usiamo l'eventuale istanza creata da _silentRefreshIfAble (che
    // imposta prompt='' per evitare popup): il popup del consenso DEVE
    // apparire quando l'utente preme il pulsante!
    this._tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: this._config!.clientId,
      scope: Array.isArray(this._config!.scopes) ? this._config!.scopes.join(' ') : this.REQUIRED_SCOPE,
      callback: (resp: GsiTokenResponse) => this._onTokenResponse(resp, /* fromSilentRefresh */ false),
      error_callback: (err: any) => {
        console.error('[GCal] OAuth errore callback:', err);
        this._token = null;
        this._tokenExpiresAt = 0;
        this._connectionState$.next('error');
      },
      // popup=true evita redirect completo e recupera token via finestra popup
      ux_mode: 'popup',
      prompt: 'consent',
      include_granted_scopes: true,
    });

    try {
      // initTokenClient.requestAccessToken() apre il popup OAuth
      this._tokenClient.requestAccessToken();
    } catch (err) {
      console.error('[GCal] requestAccessToken fallito:', err);
      this._connectionState$.next('disconnected');
    }
  }

  /**
   * Disconnette: revoca token Google + cancella da memoria + cancella
   * da localStorage (token, email, expiresAt) + cancella auto-refresh timer.
   */
  public disconnect(): void {
    // 1. Revoca token a Google (best practice: invalida sul server)
    if (this._token && (window as any).google?.accounts?.oauth2?.revoke) {
      try {
        (window as any).google.accounts.oauth2.revoke(this._token, () => {});
      } catch {}
    }
    // 2. Cancella timer auto-refresh (non verrà più eseguito dopo logout!)
    if (this._autoRefreshTimer !== null) {
      window.clearTimeout(this._autoRefreshTimer);
      this._autoRefreshTimer = null;
    }
    // 3. Pulisci memoria
    this._token = null;
    this._tokenExpiresAt = 0;
    this._consecutiveRefreshFails = 0;
    this._connectedEmail$.next('');
    // Resetta anche tokenClient (forza la ri-creazione al prossimo click "Connetti")
    this._tokenClient = null;
    // 4. Pulisci localStorage (token + email + scadenza)
    this._clearSessionInLs();
    // 5. Stato disconnected
    this._connectionState$.next('disconnected');
  }

  // ─── Gestione Calendari (CalendarList) ──────────────────────────────────────

  public async fetchCalendarList(): Promise<GoogleCalendarEntry[]> {
    const token = await this.resolveToken();
    if (!token) return [];
    try {
      const resp = await fetch(
        `${this.GOOGLE_API_BASE}/calendar/v3/users/me/calendarList?minAccessRole=writer&maxResults=100`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (resp.status === 401) { this._onUnauthorized(); return []; }
      if (!resp.ok) {
        console.error('[GCal] fetchCalendarList HTTP:', resp.status);
        return [];
      }
      const json = await resp.json();
      const items: any[] = Array.isArray(json?.items) ? json.items : [];
      return items
        .map((x) => ({
          id: `${x?.id || ''}`,
          summary: `${x?.summary || 'Calendario'}`,
          description: x?.description ? `${x.description}` : undefined,
          primary: !!x?.primary,
          timeZone: x?.timeZone ? `${x.timeZone}` : undefined,
        }))
        .filter((c) => !!c.id)
        .sort((a, b) => {
          if (!!b.primary !== !!a.primary) return (a.primary ? -1 : 1);
          return a.summary.localeCompare(b.summary);
        });
    } catch (err) {
      console.error('[GCal] fetchCalendarList eccezione:', err);
      return [];
    }
  }

  public async setSelectedCalendarId(calId: string, summary?: string): Promise<void> {
    const safeId = `${calId || ''}`.trim();
    const settings = this.ls.getGcalSettings();
    const patch: Partial<GcalSettings> = { selectedCalendarId: safeId };
    if (summary !== undefined) patch.selectedCalendarSummary = `${summary || ''}`;
    this.ls.patchGcalSettings(patch);
    this._selectedCalendarId$.next(safeId);
    this._selectedCalendarSummary$.next(patch.selectedCalendarSummary ?? settings.selectedCalendarSummary ?? '');
  }

  // ─── CRUD eventi Google ↔ App ───────────────────────────────────────────────

  /**
   * Crea un evento su Google Calendar a partire da un EventDetail locale.
   * Restituisce il googleEventId da salvare sull'evento locale.
   */
  public async createGoogleEvent(local: EventDetail): Promise<string> {
    const { token, calendarId } = await this._ensureContext();
    if (!token || !calendarId) return '';

    // ⭐ FIX ANTI-DUPLICATI #1: PRIMA di creare un evento NUOVO su Google,
    // facciamo una ricerca sul calendario di quel giorno per lo STESSO TITOLO.
    // Se troviamo un evento già esistente → usiamo QUELL'ID invece di crearne
    // uno nuovo. Questo impedisce il ciclo 1→2→4→8 di duplicati esponenziali.
    try {
      const preExistingGoogleId = await this._findExistingOnGoogleByTitleDate(
        token, calendarId, local.title || '', local.date || '', local.timeStart
      );
      if (preExistingGoogleId) {
        console.info(
          `%c[GCal create] 🔎 Trovato evento già ESISTENTE su Google per "${local.title}" (${local.date}) → ` +
          `riuso googleId=${preExistingGoogleId.slice(0, 12)}... invece di POST duplicato.`,
          'background:#047857;color:#fff;padding:2px 8px;border-radius:4px;'
        );
        return preExistingGoogleId;
      }
    } catch (lookupErr) {
      console.warn('[GCal create] lookup preventivo fallito (procedo con POST):', lookupErr);
    }

    const payload = this._toGoogleEvent(local);
    try {
      const resp = await this._fetchWithRetry(
        `${this.GOOGLE_API_BASE}/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        },
        `createEvent "${local.title || '(senza titolo)'}"`
      );
      if (resp.status === 401) { return ''; }
      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        console.error(`[GCal] createEvent HTTP ${resp.status}:`, text);
        return '';
      }
      const json = await resp.json();
      return `${json?.id || ''}`;
    } catch (err) {
      console.error('[GCal] createEvent fallito (dopo retry):', err);
      return '';
    }
  }

  /** ⭐ Lookup preventivo (anti-duplicati) — CERCA su Google il giorno specificato
   *  e restituisce l'ID del primo evento con titolo fuzzy-match corrispondente.
   *  Ritorna '' se non trovato. */
  private async _findExistingOnGoogleByTitleDate(
    token: string,
    calendarId: string,
    title: string,
    dateStr: string,
    timeStart?: string | null
  ): Promise<string> {
    if (!dateStr || !title) return '';
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Rome';
      // timeMin = inizio giornata (00:00 locale)
      const isoMin = this._toIsoWithTimezone(dateStr, '00:00', tz);
      // timeMax = fine giornata (23:59 locale -> d+1 00:00)
      const dNext = new Date(`${dateStr}T00:00:00`);
      dNext.setDate(dNext.getDate() + 1);
      const nextStr = dNext.toISOString().slice(0, 10);
      const isoMax = this._toIsoWithTimezone(nextStr, '00:00', tz);

      const params = new URLSearchParams({
        timeMin: isoMin,
        timeMax: isoMax,
        maxResults: '50',
        singleEvents: 'true',
        orderBy: 'startTime',
        showDeleted: 'false',
      });
      const url = `${this.GOOGLE_API_BASE}/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`;
      const resp = await this._fetchWithRetry(
        url,
        { headers: { Authorization: `Bearer ${token}` } },
        `findExisting title="${title.slice(0, 40)}" date=${dateStr}`
      );
      if (resp.status === 401) { return ''; }
      if (!resp.ok) return '';
      const json = await resp.json();
      const items: any[] = Array.isArray(json?.items) ? json.items : [];
      if (!items.length) return '';

      // Normalizzazione titolo (stessa logica _findFuzzyMatch locale!)
      const norm = (s: string) => `${s || ''}`
        .trim().toLowerCase()
        .replace(/[\s\-_.,;:'"!?()\[\]{}]/g, '')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const needle = norm(title);
      if (needle.length < 3) return '';

      // Passo 1 — Match ESATTO titolo (senza contare timeStart)
      for (const gEv of items) {
        const hay = norm(gEv.summary || '');
        if (hay && hay === needle) return `${gEv.id}`;
      }
      // Passo 2 — Match fuzzy incluso >= 75% (come _findFuzzyMatch)
      if (needle.length >= 10) {
        for (const gEv of items) {
          const hay = norm(gEv.summary || '');
          if (hay.length >= 10) {
            const minLen = Math.min(hay.length, needle.length);
            const maxLen = Math.max(hay.length, needle.length);
            if ((hay.includes(needle) || needle.includes(hay)) && minLen / maxLen >= 0.75) {
              return `${gEv.id}`;
            }
          }
        }
      }
      return '';
    } catch (err) {
      console.warn('[GCal] _findExistingOnGoogle errore non bloccante:', err);
      return '';
    }
  }

  public async updateGoogleEvent(local: EventDetail): Promise<void> {
    const gId = local.googleEventId;
    if (!gId) return;
    const { token, calendarId } = await this._ensureContext();
    if (!token || !calendarId) return;

    const payload = this._toGoogleEvent(local);
    try {
      const resp = await this._fetchWithRetry(
        `${this.GOOGLE_API_BASE}/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(gId)}`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        },
        `updateEvent "${local.title || '(no title)'}" (${gId.slice(0, 12)}...)`
      );
      if (resp.status === 401) { return; }
      if (resp.status === 404 || resp.status === 410) {
        console.warn('[GCal] updateEvent evento non trovato (404/410) — verrà ricreato al prossimo push:', gId);
        return;
      }
      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        console.error(`[GCal] updateEvent HTTP ${resp.status} DOPO 3 RETRY:`, text);
      }
    } catch (err) {
      console.error('[GCal] updateEvent fallito (dopo retry):', err);
    }
  }

  public async deleteGoogleEvent(local: EventDetail): Promise<void> {
    const gId = local.googleEventId;
    if (!gId) return;
    // ══════════════════════════════════════════════════════════════════════
    // 🧟  AGGIUNGI SEMPRE AL TOMBSTONE — PRIMA ANCORA DI FARE LA DELETE!
    // Anche se:
    //  (a) DELETE fallirà per 403 rateLimit / offline / rete
    //  (b) DELETE è skippata per il cutoff syncOutgoingDelta
    //  (c) DELETE restituisce qualsiasi errore
    // L'utente ha CANCELLATO VOLUTAMENTE in locale: NON DEVE RIAPPARIRE MAI.
    // ══════════════════════════════════════════════════════════════════════
    this._tombstoneAdd(gId);

    const { token, calendarId } = await this._ensureContext();
    if (!token || !calendarId) return;
    try {
      const resp = await this._fetchWithRetry(
        `${this.GOOGLE_API_BASE}/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(gId)}`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        },
        `deleteEvent "${local.title || '(no title)'}" (${gId.slice(0, 12)}...)`
      );
      if (resp.status === 401) { return; }
      if (resp.status === 404 || resp.status === 410) {
        return; // già cancellato su Google: OK
      }
      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        console.error(`[GCal] deleteEvent HTTP ${resp.status} DOPO 3 RETRY:`, text,
          '→ Ma è già marcato tombstone, non tornerà in app. ✅');
        // Non throware: è sufficiente che il tombstone ci sia!
      }
    } catch (err) {
      // Offline, DNS error... l'evento rimarrà su Google ma il TOMBSTONE già settato
      // impedirà la ri-importazione la prossima volta che torniamo online.
      console.warn(`[GCal] deleteEvent fallito rete/dopo retry:`, String(err),
        '→ ID già marcato come 🧟tombstone, non ritornerà in app. ✅');
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════
   *  🔴 DEDUPLICAZIONE GOOGLE REMOTA
   *  Analizza eventi sul TUO Google Calendar (non locale!) e cancella
   *  le N copie SUPERFLUE mantenendo 1 solo per gruppo (stessa data + titolo norm).
   *  Backup automatico in localStorage PRIMA di DELETE.
   * ═══════════════════════════════════════════════════════════════════════ */

  /** Normalizzazione titolo per chiave raggruppamento duplicati remoti */
  private _normTitleDedup(s: string): string {
    return `${s || ''}`
      .trim().toLowerCase()
      .replace(/[\s\-_.,;:'"!?()\[\]{}]/g, '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  /** 📊 Analizza eventi SUL GOOGLE REMOTO e restituisce gruppi duplicati.
   *  (NON tocca il locale, non tocca Google — solo READ). */
  public async analyzeGoogleDuplicatesRemote(): Promise<{
    totalEvents: number; groups: number; superflui: number;
    samples: Array<{ date: string; title: string; count: number; keptId: string; deleteIds: string[] }>;
  }> {
    const empty = { totalEvents: 0, groups: 0, superflui: 0, samples: [] };
    try {
      const { token, calendarId } = await this._ensureContext();
      if (!token || !calendarId) return empty;

      const syncCutoff = this.syncStartDateSnapshot;
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Rome';
      const timeMinIso = this._toIsoWithTimezone(syncCutoff, '00:00', tz);

      const params = new URLSearchParams({
        maxResults: '2500',
        singleEvents: 'true',
        orderBy: 'startTime',
        showDeleted: 'false',
        timeMin: timeMinIso,
      });
      const url = `${this.GOOGLE_API_BASE}/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`;
      const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (resp.status === 401) { this._onUnauthorized(); return empty; }
      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        console.error(`[GCal Dedup Google] list HTTP ${resp.status}:`, text);
        return empty;
      }
      const json = await resp.json();
      const items: any[] = Array.isArray(json?.items) ? json.items : [];

      // Raggruppamento per chiave = data ISO (YYYY-MM-DD) | titolo_norm
      type GrpItem = { id: string; title: string; updatedAtNum: number; raw: any };
      const groupsMap = new Map<string, GrpItem[]>();

      for (const gEv of items) {
        const parsed = this._parseGoogleDateTime(gEv.start, gEv.end);
        if (!parsed.date) continue;
        const key = `${parsed.date}|${this._normTitleDedup(gEv.summary || '(senza titolo)')}`;
        const el: GrpItem = {
          id: `${gEv.id}`,
          title: gEv.summary || '(senza titolo)',
          updatedAtNum: gEv.updated ? new Date(gEv.updated).getTime() : 0,
          raw: gEv,
        };
        if (!groupsMap.has(key)) groupsMap.set(key, []);
        groupsMap.get(key)!.push(el);
      }

      let totalGroups = 0;
      let superflui = 0;
      const samples: any[] = [];

      for (const [key, arr] of groupsMap.entries()) {
        if (arr.length <= 1) continue;
        totalGroups++;
        const extra = arr.length - 1;
        superflui += extra;

        // Ordiniamo: updatedAt DESC (primo = più recente = teniamo)
        arr.sort((a, b) => b.updatedAtNum - a.updatedAtNum);
        const kept = arr[0];
        const toDelete = arr.slice(1).map((x) => x.id);

        const [datePart] = key.split('|');
        samples.push({
          date: datePart,
          title: kept.title,
          count: arr.length,
          keptId: kept.id,
          deleteIds: toDelete,
        });
      }
      samples.sort((a, b) => b.count - a.count);

      return {
        totalEvents: items.length,
        groups: totalGroups,
        superflui,
        samples: samples.slice(0, 10),
      };
    } catch (err) {
      console.error('[GCal Dedup Google] analyze fallito:', err);
      return { totalEvents: 0, groups: 0, superflui: 0, samples: [] };
    }
  }

  /** 🗑️ Esegue DELETE REMOTO su Google Calendar delle copie superflue.
   *  MANTIENE 1 evento per gruppo (il più recente). Prima salva backup. */
  public async deduplicateGoogleEventsRemote(): Promise<{ deleted: number; kept: number; backupKey: string; error?: string }> {
    try {
      const analysis = await this.analyzeGoogleDuplicatesRemote();
      if (analysis.superflui <= 0) {
        return { deleted: 0, kept: analysis.groups, backupKey: '' };
      }
      const { token, calendarId } = await this._ensureContext();
      if (!token || !calendarId) return { deleted: 0, kept: 0, backupKey: '', error: 'Google non connesso' };

      // 1️⃣ BACKUP preventivo in LS di TUTTI i gruppi analizzati (per rollback)
      const stamp = `${new Date().toISOString().slice(0, 10).replace(/-/g, '')}_${Date.now()}`;
      const backupKey = `mm_backup_pre_gcal_dedup_${stamp}`;
      try {
        localStorage.setItem(backupKey, JSON.stringify({
          createdAt: new Date().toISOString(),
          groups: analysis.samples.map((s) => ({
            date: s.date, title: s.title, count: s.count,
            keptGoogleId: s.keptId, deletedGoogleIds: s.deleteIds,
          })),
          note: 'Backup pre-deduplicazione Google — chiavi event da eliminare',
        }));
      } catch (e) { console.warn('[GCal Dedup] backup LS non salvato:', e); }

      let deleted = 0;
      let kept = 0;

      for (const group of analysis.samples) {
        kept++;
        for (const gId of group.deleteIds) {
          try {
            const delUrl = `${this.GOOGLE_API_BASE}/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(gId)}`;
            const resp = await fetch(delUrl, {
              method: 'DELETE',
              headers: { Authorization: `Bearer ${token}` },
            });
            if (resp.status === 401) { this._onUnauthorized(); throw new Error('Unauthorized'); }
            if (resp.status === 404 || resp.status === 410) { deleted++; continue; }
            if (!resp.ok) {
              const txt = await resp.text().catch(() => '');
              console.warn(`[GCal Dedup] DELETE fallito id=${gId} HTTP ${resp.status}:`, txt);
              continue;
            }
            deleted++;
          } catch (err) {
            console.error(`[GCal Dedup] DELETE errore id=${gId}:`, err);
          }
        }
      }

      return { deleted, kept, backupKey };
    } catch (err) {
      console.error('[GCal Dedup] deduplicazione fallita:', err);
      return { deleted: 0, kept: 0, backupKey: '', error: String(err) };
    }
  }

  /**
   * Importa eventi da Google Calendar → locale applicando Last-Write-Wins.
   * Vince la modifica più recente (local.updatedAt vs google.updated).
   * Campi extra (type, status, fee, band, compensoType) NON vengono MAI
   * sovrascritti dall'import per gli eventi già presenti.
   */
  public async importGoogleEvents(opts?: { since?: Date }): Promise<SyncReport> {
    const report: SyncReport = { imported: 0, updated: 0, skipped: 0, conflicts: 0 };
    const { token, calendarId } = await this._ensureContext();
    if (!token || !calendarId) return report;

    try {
      const params = new URLSearchParams({
        maxResults: '2500',
        singleEvents: 'true',
        orderBy: 'updated',
        showDeleted: 'false',
      });
      if (opts?.since) {
        params.set('updatedMin', opts.since.toISOString());
      } else {
        // Di default importa a partire da 2 anni fa per non sovraccaricare
        const d = new Date();
        d.setFullYear(d.getFullYear() - 2);
        params.set('timeMin', d.toISOString());
      }

      const url = `${this.GOOGLE_API_BASE}/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`;
      const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (resp.status === 401) { this._onUnauthorized(); return report; }
      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        console.error(`[GCal] import HTTP ${resp.status}:`, text);
        return report;
      }
      const json = await resp.json();
      const items: GoogleEvent[] = Array.isArray(json?.items) ? json.items : [];

      // --- Debug sampling: primi 5 eventi Google (console DevTools) per capire parsing date ---
      if (items.length) {
        console.groupCollapsed('[GCal] Sample primi 5 eventi Google → parsing date verification');
        items.slice(0, 5).forEach((gEv, i) => {
          const parsed = this._parseGoogleDateTime(gEv.start, gEv.end);
          console.info(`   #${i + 1}`,
            'title:', gEv.summary || '(senza titolo)',
            '| g.start:', gEv.start,
            '| g.end:', gEv.end,
            '| PARSED → date:', parsed.date, 'timeStart:', parsed.timeStart || '(all day)', 'timeEnd:', parsed.timeEnd);
        });
        console.groupEnd();
      }

      const local = readEventsWithBackfill();
      const byGoogleId = new Map<string, EventDetail>();
      local.forEach((ev) => {
        if (ev.googleEventId) byGoogleId.set(ev.googleEventId, ev);
      });
      const localIdx = new Map<string, EventDetail>();
      local.forEach((ev) => localIdx.set(ev.id, ev));

      // ⭐ DATA DI INIZIO SINCRO: la stampiamo in console come info
      const syncCutoff = this.syncStartDateSnapshot;
      let nSkippedCutoff = 0;
      console.info(
        `%c[GCal] ⭐ DATA INIZIO SINCRO (cutoff): ${syncCutoff} — ` +
        `Eventi Google con data < ${syncCutoff} verranno SKIPPATI.`,
        'background:#1e40af;color:#fff;padding:3px 10px;border-radius:4px;font-weight:bold;'
      );

      // Contatori diagnostici distribuzione match (console DevTools)
      const diag = { nMatchGoogleId: 0, nFuzzy: 0, nNewEvent: 0, nCancelled: 0, nNoId: 0,
        nTombstonedId: 0, nTombstonedTD: 0, nIntraLoopDedup: 0 };

      // ⭐ FIX ANTI-DUPLICATI #3: Set degli eventi locali GIA' "consumati" (linkati
      // a un evento Google nel ciclo attuale) — evitiamo che 8 eventi Google identici
      // vengano fuzzy-match-ati TUTTI sullo STESSO evento locale #1 (causa del
      // ciclo 1→2→4→8 duplicati).
      const consumedLocalIds = new Set<string>();
      local.forEach(ev => { if (ev.googleEventId) consumedLocalIds.add(ev.id); });
      // 🆕 Chiavi dedup COMPLETE (data|norm_title|type) GIA' processate in QUESTO loop.
      //     ✅ STESSA chiave usata in analyzeDuplicateStats / runMigration_DeduplicateEvents.
      const seenDedupKeys = new Set<string>();
      local.forEach(ev => {
        const k = eventFullDedupKey(ev.date, ev.title, ev.type);
        if (k) seenDedupKeys.add(k);
      });

      const now = new Date().toISOString();
      for (const gEv of items) {
        if (!gEv.id) { diag.nNoId++; report.skipped++; continue; }
        if (gEv.status === 'cancelled') { diag.nCancelled++; report.skipped++; continue; }

        if (tombstoneHasDeletedGoogleEventId(gEv.id)) {
          diag.nTombstonedId++;
          report.skipped++;
          continue;
        }

        const parsedDate = this._parseGoogleDateTime(gEv.start, gEv.end);
        if (!this.isEventWithinSyncWindow(parsedDate.date)) {
          nSkippedCutoff++;
          continue;
        }

        // 🧮 Calcola TYPE subito (STESSA regola _fromGoogleEvent!)
        const gTitle = gEv.summary ?? '';
        const gTypeGuess = this._guessEventType(gTitle);
        const gKeyTD = eventDateTitleDedupKey(parsedDate.date, gTitle);
        const gKeyFull = eventFullDedupKey(parsedDate.date, gTitle, gTypeGuess);

        // 🧟 TOMBSTONE composito cross-match: SIA chiave semplice SIA con type
        if (tombstoneHasDeletedTitleDate(parsedDate.date, gTitle, gTypeGuess)) {
          diag.nTombstonedTD++;
          report.skipped++;
          continue;
        }
        // 💣 BARRIERA INTRA-LOOP 3 parti COMPLETA CON TYPE:
        if ((gKeyFull && seenDedupKeys.has(gKeyFull)) ||
            (gKeyTD && seenDedupKeys.has(gKeyTD))) {
          diag.nIntraLoopDedup++;
          report.skipped++;
          continue;
        }
        if (gKeyFull) seenDedupKeys.add(gKeyFull);
        if (gKeyTD) seenDedupKeys.add(gKeyTD);

        const googleTs = gEv.updated ?? now;
        const existing = byGoogleId.get(gEv.id);

        if (existing) {
          diag.nMatchGoogleId++;
          const localTs = existing.updatedAt || existing.createdAt || now;
          if (googleTs > localTs) {
            const merged = this._mergeBaseFields(existing, gEv);
            merged.updatedAt = now;
            localIdx.set(merged.id, merged);
            byGoogleId.set(gEv.id, merged);
            consumedLocalIds.add(merged.id); // Segna come preso
            report.updated++;
          } else {
            consumedLocalIds.add(existing.id);
            report.skipped++;
          }
        } else {
          const nuovo = this._fromGoogleEvent(gEv, now);
          // 🟡 IMPORTANTE FIX DEDUP ORIZZONTALE: workingLocal include ANCHE
          //    tutti gli eventi creati in precedenza nello STESSO ciclo import
          //    (altrimenti local[] = array iniziale, non vede i nuovi creati
          //    → lo stesso fuzzy-match non trova "cugini" creati 3 righe prima!)
          const workingLocal = Array.from(localIdx.values());
          const dup = this._findFuzzyMatch(workingLocal, nuovo, consumedLocalIds);
          if (dup) {
            diag.nFuzzy++;
            consumedLocalIds.add(dup.id); // IMPORTANTE: marca come PRESO adesso!
            const localTs = dup.updatedAt || dup.createdAt || now;
            if (googleTs > localTs) {
              const merged = this._mergeBaseFields(dup, gEv);
              merged.googleEventId = gEv.id;
              merged.updatedAt = now;
              localIdx.set(merged.id, merged);
              byGoogleId.set(gEv.id, merged);
              report.updated++;
            } else {
                // locale vince — ma dobbiamo salvare il googleEventId cmq!
                const toSave = localIdx.get(dup.id) || dup;
                toSave.googleEventId = gEv.id;
                localIdx.set(dup.id, toSave);
                byGoogleId.set(gEv.id, toSave);
                report.updated++;
            }
          } else {
            diag.nNewEvent++;
            localIdx.set(nuovo.id, nuovo);
            byGoogleId.set(gEv.id, nuovo);
            consumedLocalIds.add(nuovo.id); // Anche gli importati nuovi sono presi
            report.imported++;
          }
        }
      }

      // ══════════════════════════════════════════════════════════════════════
      // 🛡️  DEDUP FINALE DI FINE CICLO (double safety net)
      //     Elimina copie duplicate per:
      //     (A) STESSO googleEventId (importazione ripetuta)
      //     (B) STESSA chiave COMPLETA eventFullDedupKey = data|title_norm|type
      //         ✅ STESSA di analyze/run dedup locale.
      // ══════════════════════════════════════════════════════════════════════
      const finalSeenGIds = new Map<string, string>();
      const finalSeenFullKeys = new Map<string, string>();
      const survivors: EventDetail[] = [];
      let dedupFinalGId = 0;
      let dedupFinalFullTD = 0;
      for (const ev of Array.from(localIdx.values())) {
        if (ev.googleEventId) {
          if (finalSeenGIds.has(ev.googleEventId)) { dedupFinalGId++; continue; }
          finalSeenGIds.set(ev.googleEventId, ev.id);
        }
        const fullK = eventFullDedupKey(ev.date, ev.title, ev.type);
        if (fullK) {
          if (finalSeenFullKeys.has(fullK)) { dedupFinalFullTD++; continue; }
          finalSeenFullKeys.set(fullK, ev.id);
        }
        survivors.push(ev);
      }
      localIdx.clear();
      survivors.forEach(e => localIdx.set(e.id, e));

      // Persisto e aggiorno stato + notifico viste
      const tutti = Array.from(localIdx.values());
      writeEventsWithTimestamp(tutti);

      // Stampa diagnostica: quanti eventi matchano in modo esatto / fuzzy / nuovi
      console.info('[GCal] Diagnostica distribuzione match:',
        `match-per-google-id=${diag.nMatchGoogleId} (già linkati 1:1)`,
        `| fuzzy-match-associazione=${diag.nFuzzy}`,
        `| eventi-nuovi-da-google=${diag.nNewEvent}`,
        `| cancellati-google=${diag.nCancelled}`,
        `| senza-id=${diag.nNoId}`,
        `| 🧟SKIP-tomb-gId=${diag.nTombstonedId}`,
        `🧟SKIP-tomb-date/title+type=${diag.nTombstonedTD}`,
        `| 💣anti-dup-intra-loop=${diag.nIntraLoopDedup}`,
        `| dedup-finale-gId=${dedupFinalGId} fullTD=${dedupFinalFullTD}`,
        `| in-locale-con-googleEventId=${byGoogleId.size}/${tutti.length}`);

      const nowStamp = new Date().toISOString();
      this.ls.patchGcalSettings({ lastSyncAt: nowStamp, lastSyncReport: report });
      this._lastSyncAt$.next(nowStamp);
      this._lastSyncReport$.next(report);
      this._eventsChanged$.next(); // ★ trigger reload Dashboard/Agenda

      // ★ SYNC BIDIREZIONALE COMPLETO in 1 click: dopo aver importato da Google
      // (Google→App), creiamo in Google tutti gli eventi locali ancora senza googleEventId
      // (App→Google): così l'utente non deve fare 2 operazioni separate!
      setTimeout(() => this.catchUpPushLocalEvents(), 600);

      // Log debug dettagliato per aiutare a diagnosticare (console DevTools)
      console.info('[GCal] importGoogleEvents completato →',
        `importati=${report.imported}`,
        `aggiornati=${report.updated}`,
        `saltati=${report.skipped}`,
        `conflitti=${report.conflicts}`,
        `googleTotali=${items.length}`,
        `SKIP_cutoff_<${syncCutoff}=${nSkippedCutoff}  🚫(non importati per data inizio sincro)`,
        `localeTotali=${tutti.length}`);

      return report;
    } catch (err) {
      console.error('[GCal] importGoogleEvents fallito:', err);
      return report;
    }
  }

  // ─── Token lifecycle ───────────────────────────────────────────────────────

  /**
   * Restituisce token valido o null. Se scaduto PROVA REFRESH SILENZIOSO
   * (Google GSI prompt='' → nessun popup, se sessione Chrome è ancora attiva
   *  ritorna un token NUOVO in <1 secondo!).
   * Solo se il refresh fallisce restituisce null e passa a stato 'expired'.
   */
  public async resolveToken(): Promise<string | null> {
    if (this._token && this._tokenExpiresAt > Date.now() + 30_000) {
      return this._token;
    }
    // Token scaduto/invalido: tentiamo refresh SILENZIOSO prima di arrenderci
    try {
      const ok = await this._silentRefreshIfAble();
      if (ok && this._token) return this._token;
    } catch (err) {
      console.warn('[GCal] resolveToken silent refresh fallito:', err);
    }
    // Se arrivo qui, non c'è verso di avere un token: scaduto definitivamente
    this._token = null;
    this._tokenExpiresAt = 0;
    if (this._connectionState$.value === 'connected') {
      this._connectionState$.next('expired');
    }
    return null;
  }

  // ─── Metodi interni ─────────────────────────────────────────────────────────

  /**
   * Avvio: carica configurazione + ripristina sessione token da localStorage
   * se il token salvato è ANCORA valido (scadenza > ora + 30s).
   * Effetto: dopo F5 o riapertura browser, rimani "Connesso" senza fare login!
   */
  private async _initFromStorage(): Promise<void> {
    await this.loadConfig();
    const settings = this.ls.getGcalSettings();
    this._selectedCalendarId$.next(settings.selectedCalendarId ?? '');
    this._selectedCalendarSummary$.next(settings.selectedCalendarSummary ?? '');
    this._lastSyncAt$.next(settings.lastSyncAt ?? '');
    this._lastSyncReport$.next(settings.lastSyncReport ?? { imported: 0, updated: 0, skipped: 0, conflicts: 0 });
    // ⭐ Sync start date cutoff: se salvata in LS la carico, altrimenti resta il getter
    // syncStartDateSnapshot che usa default oggi-1
    if (settings.syncStartDate && /^\d{4}-\d{2}-\d{2}$/.test(settings.syncStartDate)) {
      this._syncStartDate$.next(settings.syncStartDate);
    }

    // Restore sessione token (se ancora valida!)
    const savedToken = `${settings.accessToken || ''}`.trim();
    const savedExpiresAt = Number(settings.tokenExpiresAt || 0);
    if (savedToken && savedExpiresAt > Date.now() + 60_000) {
      // Token ancora buono per più di 1 minuto: restore immediato!
      this._token = savedToken;
      this._tokenExpiresAt = savedExpiresAt;
      this._connectedEmail$.next(settings.connectedEmail ?? '');
      this._consecutiveRefreshFails = 0;
      // Stato connected! (triggera anche catch-up push automatico dal subscribe constructor)
      this._connectionState$.next('connected');
      this._scheduleAutoRefresh(this._tokenExpiresAt);
      console.info('[GCal] sessione Google ripristinata da localStorage! ' +
        `scade tra ${Math.round((savedExpiresAt - Date.now()) / 60_000)} min · ${settings.connectedEmail || ''}`);
    } else if (savedToken) {
      // Token salvato ma scaduto da meno di 7 giorni → tentiamo REFRESH
      // silenzioso (non serve riaprire popup se la sessione Google in Chrome c'è!)
      console.info('[GCal] token localStorage scaduto → tento refresh silenzioso...');
      void this._silentRefreshIfAble().then((ok) => {
        // ✅ FIX: se silent refresh FALLISCE (popup blocker / sessione Chrome scaduta)
        // NON cancelliamo email/token dal localStorage.
        // Motivo: l'email salvata resta utile come label nella UI,
        // e l'utente potrà cliccare manualmente il pulsante "Riconnetti"
        // (popup non viene bloccato se inizia da un click diretto!).
        // Solo se passano più di 7 giorni senza refresh → LS scade per timeout naturale.
        if (!ok) {
          console.info('[GCal] refresh silenzioso non riuscito. Clicca manualmente "Riconnetti" quando vuoi.');
          // Non mettiamo stato 'error' rosso! Stato 'disconnected' grigio,
          // pulsante Riconnetti disponibile per click utente.
          if (this._connectionState$.value === 'connecting' || this._connectionState$.value === 'connected') {
            this._connectionState$.next('expired');
          }
        }
      }).catch(() => {});
    }
  }

  /** Salva token + email + scadenza in localStorage (persistenza tra F5) */
  private _persistSessionToLs(): void {
    try {
      const email = this._connectedEmail$.value || undefined;
      this.ls.patchGcalSettings({
        accessToken: this._token || undefined,
        tokenExpiresAt: this._tokenExpiresAt || undefined,
        connectedEmail: email,
      });
    } catch (err) {
      console.warn('[GCal] persist session LS fallita:', err);
    }
  }

  /** Pulisce token persistito (logout / disconnect) */
  private _clearSessionInLs(): void {
    try {
      this.ls.patchGcalSettings({
        accessToken: undefined,
        tokenExpiresAt: undefined,
        connectedEmail: undefined,
      });
    } catch {}
  }

  /**
   * Pianifica AUTO-REFRESH SILENZIOSO 10 minuti PRIMA della scadenza del token.
   * Durata default token Google = 3600s (1h) → refresh a 50 minuti,
   * così l'utente non si accorge di NULLA e la connessione "dura per sempre".
   */
  private _scheduleAutoRefresh(expiresAtMs: number): void {
    // Cancello eventuale timeout precedente
    if (this._autoRefreshTimer !== null) {
      window.clearTimeout(this._autoRefreshTimer);
      this._autoRefreshTimer = null;
    }
    const msFromNow = expiresAtMs - Date.now();
    // Refresh 10 minuti PRIMA della scadenza (mai meno di 30s da adesso)
    const delay = Math.max(30_000, msFromNow - 10 * 60_000);
    this._autoRefreshTimer = window.setTimeout(() => {
      this._autoRefreshTimer = null;
      if (this._consecutiveRefreshFails > 3) {
        // Troppi fallimenti consecutivi: smettiamo di provare per non loopare
        console.warn('[GCal] auto-refresh bloccato: 4 tentativi falliti consecutivi');
        return;
      }
      console.info('[GCal] auto-refresh pianificato in esecuzione...');
      void this._silentRefreshIfAble();
    }, delay);
    console.info(`[GCal] auto-refresh programmato tra ${Math.round(delay / 60_000)} minuti`);
  }

  /**
   * Richiede un token NUOVO SENZA APRIRE POPUP (prompt='' su GSI).
   * Funziona se l'utente ha ancora la sessione Google valida nel browser.
   * Restituisce TRUE se il refresh è andato bene (token nuovo in memoria + LS).
   */
  private async _silentRefreshIfAble(): Promise<boolean> {
    if (!this._config) {
      try { await this.loadConfig(); } catch {}
      if (!this._config) return false;
    }
    try {
      await this.lazyLoadGsiScript();
    } catch { return false; }

    // Assicuriamoci che il tokenClient esista come in startOAuthFlow, ma con
    // prompt di default vuoto (popup non appare se la sessione è già valida)
    const g = (window as any).google;
    if (!g?.accounts?.oauth2) return false;
    if (!this._tokenClient) {
      this._tokenClient = g.accounts.oauth2.initTokenClient({
        client_id: this._config.clientId,
        scope: Array.isArray(this._config.scopes) ? this._config.scopes.join(' ') : this.REQUIRED_SCOPE,
        callback: (resp: GsiTokenResponse) => this._onTokenResponse(resp, /* fromSilentRefresh */ true),
        error_callback: (_err: any) => { /* gestito dal codice chiamante */ },
        ux_mode: 'popup',
        prompt: '',
        include_granted_scopes: true,
      });
    }

    // Promise wrapper: requestAccessToken è callback-driven, non è async
    return new Promise<boolean>((resolve) => {
      let resolved = false;
      const timer = window.setTimeout(() => {
        if (!resolved) { resolved = true; resolve(false); }
      }, 8000);

      const done = (result: boolean) => {
        if (resolved) return;
        resolved = true;
        window.clearTimeout(timer);
        resolve(result);
      };

      try {
        // Sovrascriviamo temporaneamente SIA callback (successo)
        // SIA error_callback (popup bloccato, access_denied, ecc.)
        // per risolvere SUBITO la promise (invece di aspettare 8s timeout!)
        const origCallback = this._tokenClient.callback;
        const origErrCallback = this._tokenClient.error_callback;
        this._tokenClient.callback = (resp: GsiTokenResponse) => {
          this._tokenClient.callback = origCallback;
          this._tokenClient.error_callback = origErrCallback;
          this._onTokenResponse(resp, true);
          done(Boolean(resp?.access_token) && !resp?.error);
        };
        this._tokenClient.error_callback = (err: any) => {
          this._tokenClient.callback = origCallback;
          this._tokenClient.error_callback = origErrCallback;
          // Popup bloccato / immediate failed NON sono errori applicativi.
          // Logghiamo info-level, poi l'utente potrà cliccare "Riconnetti".
          const errType = `${err?.type || err?.error || 'unknown'}`;
          console.info(`[GCal] silent refresh non possibile (${errType}) — richiesta click manuale.`);
          done(false);
        };
        // prompt='' per dire: NON APRIRE POPUP se puoi darmi un token in silenzio!
        this._tokenClient.requestAccessToken({ prompt: '' });
      } catch (err) {
        console.debug('[GCal] silentRefresh eccezione (non bloccante):', err);
        done(false);
      }
    });
  }

  /**
   * @param fromSilentRefresh se true → arriviamo da refresh silenzioso (nessun popup)
   */
  private _onTokenResponse(resp: GsiTokenResponse, fromSilentRefresh = false): void {
    if (resp?.error) {
      // ─── Classifica errori: soft (popup bloccato) vs hard (server errori) ──
      const errCode = `${resp.error || ''}`;
      const softErrors = new Set([
        'popup_closed_by_user','popup_blocked_by_browser','immediate_failed',
        'access_denied','cancel','opt_out_or_no_session','interaction_required'
      ]);
      const isSoft = softErrors.has(errCode);

      if (isSoft && fromSilentRefresh) {
        // ✅ FIX: Popup blocker / sessione Google scaduta NON sono errori.
        // NON cancelliamo il token CORRENTE (potrebbe essere ancora valido
        // per altri 5 minuti!); NON incrementiamo i fallimenti consecutivi
        // perché non è un errore server ma un blocco UX.
        console.info(`[GCal] silent refresh saltato: ${errCode}. Fai click manuale su "Riconnetti" quando vuoi.`);
        return;
      }

      // Log a livello corretto in base a gravità
      const logMsg = `[GCal] OAuth: ${errCode}${resp.error_description ? ' — ' + resp.error_description : ''} (${fromSilentRefresh ? 'silent' : 'popup'})`;
      if (isSoft) { console.info(logMsg); } else { console.error(logMsg); }

      // Incrementa fallimenti consecutivi SOLO per errori server "duri" non popup
      if (!isSoft && fromSilentRefresh) {
        this._consecutiveRefreshFails++;
      }

      if (!fromSilentRefresh) {
        // ❌ Popup manuale chiuso / errore → pulisci + stato coerente
        this._token = null;
        this._tokenExpiresAt = 0;
        // access_denied = utente non ha accettato → disconnected (non è un errore tecnico)
        this._connectionState$.next(errCode === 'access_denied' || errCode === 'popup_closed_by_user'
          ? 'disconnected'
          : 'error');
      }
      return;
    }
    if (!resp?.access_token) {
      this._token = null;
      this._tokenExpiresAt = 0;
      if (!fromSilentRefresh) this._connectionState$.next('error');
      return;
    }
    // 🎊 SUCCESSO: abbiamo un token VALIDO!
    this._token = resp.access_token;
    const expiresInSecs = Math.max(60, Number(resp.expires_in) || 3600);
    this._tokenExpiresAt = Date.now() + expiresInSecs * 1000;
    this._consecutiveRefreshFails = 0;

    // Solo se NON eravamo già connected → cambia stato (altrimenti rimane
    // 'connected' così non si ritriggera catch-up push a vuoto ogni refresh)
    if (this._connectionState$.value !== 'connected') {
      this._connectionState$.next('connected');
    }

    // Persistenza tra F5 (token, scadenza, email)
    this._persistSessionToLs();
    // Prossimo refresh tra 50 minuti (10 minuti PRIMA della scadenza)
    this._scheduleAutoRefresh(this._tokenExpiresAt);

    // Email: se la abbiamo già non rifetchiamo (silent refresh ogni 50 minuti!)
    if (!this._connectedEmail$.value) {
      void this._fetchUserEmail();
    }

    // Auto-pick calendario principale solo se non ne è già stato selezionato uno
    if (!this._selectedCalendarId$.value) {
      void this._autoPickPrimaryCalendar();
    }
    if (!fromSilentRefresh) {
      console.info(`[GCal] 🎟️ nuovo token OAuth! scadenza ${expiresInSecs / 60} min`);
    } else {
      console.info(`[GCal] ♻️ silent refresh OK! prossimo tra ${Math.round((this._tokenExpiresAt - Date.now() - 10*60_000)/60_000)} min`);
    }
  }

  private async _fetchUserEmail(): Promise<void> {
    if (!this._token) return;
    try {
      // ✅ FIX 1: NON usare più /oauth2/v2/userinfo (richiede scope OPENID che non abbiamo!)
      //    Usiamo /oauth2/v3/tokeninfo?access_token=...  che FUNZIONA SEMPRE
      //    con QUALSIASI token OAuth valido (non richiede scope aggiuntivi!).
      const resp = await fetch(
        `https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${encodeURIComponent(this._token)}`,
      );
      // ⚠️ IMPORTANTE: se tokeninfo non va bene, MAI chiamare _onUnauthorized!
      //    Il token è VALIDO per Calendar, semplicemente non riporta l'email
      //    (es. token tipo "implicit flow" senza claims email). Non rompere la
      //    connessione per un optional come l'indirizzo email.
      if (!resp.ok) {
        // Fallback B: estrai email dal calendario principale (se è primary)
        try {
          const listResp = await fetch(`${this.GOOGLE_API_BASE}/calendar/v3/users/me/calendarList?maxResults=5&minAccessRole=owner`, {
            headers: { Authorization: `Bearer ${this._token}` },
          });
          if (listResp.ok) {
            const listJson = await listResp.json();
            const primary = (listJson?.items || []).find((c: any) => c.primary);
            if (primary?.id && /.+@.+\..+/.test(primary.id)) {
              const email = `${primary.id}`.trim();
              this._connectedEmail$.next(email);
              this._persistSessionToLs();
            }
          }
        } catch {}
        return;
      }
      const json = await resp.json();
      // tokeninfo restituisce email se il claim è presente nel token
      const email = `${json?.email || ''}`.trim();
      if (email && /.+@.+\..+/.test(email)) {
        this._connectedEmail$.next(email);
        this._persistSessionToLs();
      }
    } catch (err) {
      // Non disconnettere MAI per un errore nel recupero dell'email
      // (l'email è solo un label UI per l'utente, la connessione Calendar è OK!)
      console.debug('[GCal] fetch email non disponibile (opzionale, non bloccante):', err);
    }
  }

  private async _autoPickPrimaryCalendar(): Promise<void> {
    const list = await this.fetchCalendarList();
    if (!list.length) return;
    const primary = list.find((c) => c.primary) ?? list[0];
    await this.setSelectedCalendarId(primary.id, primary.summary);
  }

  /**
   * HTTP 401 Unauthorized ricevuto da una API Google.
   * Invece di passare SUBITO a stato 'expired' proviamo REFRESH SILENZIOSO:
   * se la sessione Chrome con Google è ancora attiva, otteniamo un token
   * NUOVO SENZA APRIRE POPUP. Solo se fallisce → expired.
   */
  private async _onUnauthorized(): Promise<void> {
    // Primo tentativo: silent refresh!
    try {
      const ok = await this._silentRefreshIfAble();
      if (ok && this._token) {
        console.info('[GCal] 401 risolto con silent refresh!');
        return;
      }
    } catch (err) {
      console.warn('[GCal] 401 silent refresh fallito:', err);
    }
    // Fallimento: settiamo token scaduto e stato expired
    this._token = null;
    this._tokenExpiresAt = 0;
    // Puliamo anche persistenza (ma non calendario selezionato, rimane utile!)
    this._clearSessionInLs();
    if (this._connectionState$.value === 'connected') {
      this._connectionState$.next('expired');
    }
  }

  /** Assicura che token e calendario siano pronti prima di una CRUD. */
  private async _ensureContext(): Promise<{ token: string | null; calendarId: string | null }> {
    if (!this._config) {
      try { await this.loadConfig(); } catch {}
      if (!this._config) return { token: null, calendarId: null };
    }
    const token = await this.resolveToken();
    const calendarId = this._selectedCalendarId$.value || null;
    return { token, calendarId };
  }

  // ─── Mapping campi App ↔ Google ────────────────────────────────────────────

  /** 📝 Legge il formato note salvato in GcalSettings LS (se esiste) oppure
   *  ritorna DEFAULT_NOTE_FORMAT. Utile per UI anteprima e per _toGoogleEvent.
   *  Garantisce backward compat anche se l'utente non ha mai salvato niente. */
  resolveNoteFormatOrDefault(overrideSettings?: GcalSettings | null): GoogleNoteFormat {
    try {
      const settings = overrideSettings ?? this.ls.getGcalSettings() ?? {};
      if (settings && settings.noteFormat && typeof settings.noteFormat === 'object') {
        return { ...DEFAULT_NOTE_FORMAT, ...(settings.noteFormat as GoogleNoteFormat) };
      }
    } catch { /* ignora, ritorna default */ }
    return { ...DEFAULT_NOTE_FORMAT };
  }

  /** 📝 Costruisce la stringa che andrà nel campo `description` Google Calendar
   *  a partire dal formato 11 checkbox scelto dall'utente.
   *  Salta automaticamente le righe con dati vuoti/zero per non appesantire.
   *  Ritorna stringa vuota se non c'è nessuna informazione da mostrare. */
  buildGoogleDescriptionFromFormat(e: EventDetail, fmt: GoogleNoteFormat): string {
    if (!e) return '';
    const lines: string[] = [];

    // 📅 Data + orari
    if (fmt.includeTimes) {
      const prettyDate = e.date
        ? new Intl.DateTimeFormat('it-IT', {
            weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
          }).format(new Date(e.date + 'T00:00:00'))
        : '';
      const orari: string[] = [];
      if (e.timeStart) orari.push(e.timeStart);
      if (e.timeEnd)   orari.push(e.timeEnd);
      const orariStr = orari.length === 2 ? `${orari[0]} → ${orari[1]}` : orari[0] ?? '';
      const parts = [prettyDate, orariStr].filter(Boolean);
      if (parts.length) lines.push(`📅 ${parts.join(' · ')}`);
    }

    // 🎭 Teatro / Locale
    if (fmt.includeVenue && e.venue?.trim()) {
      lines.push(`🎭 ${e.venue.trim()}`);
    }

    // 📍 Indirizzo
    if (fmt.includeAddress && e.address?.trim()) {
      lines.push(`📍 ${e.address.trim()}`);
    }

    // 🎶 Tipo evento + Stato
    const tp: string[] = [];
    if (fmt.includeType && e.type) {
      const tmap: Record<EventDetail['type'], string> = {
        concert: 'Concerto',
        lesson: 'Lezione',
        dj_set: 'DJ Set',
        rehearsal: 'Prova',
        other: 'Altro',
      };
      tp.push(`🎶 ${tmap[e.type] ?? e.type}`);
    }
    if (fmt.includeStatus && e.status) {
      const smap: Record<EventDetail['status'], string> = {
        confirmed: '✅ Confermato',
        pending: '⏳ In attesa',
        cancelled: '❌ Annullato',
      };
      tp.push(smap[e.status] ?? e.status);
    }
    if (tp.length) lines.push(tp.join(' · '));

    // 👥 Musicisti (Band)
    if (fmt.includeBand && Array.isArray(e.band) && e.band.length > 0) {
      const memb = e.band
        .map((m) => `${m.name || ''}${m.instrument ? ` (${m.instrument})` : ''}`)
        .filter((x) => x.length > 0);
      if (memb.length) lines.push(`👥 Musicisti: ${memb.join(', ')}`);
    }

    // 💰 Compensi
    const feeLine: string[] = [];
    if (fmt.includeGrossFee && typeof e.grossFee === 'number' && e.grossFee > 0) {
      feeLine.push(`Lordo: ${new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(e.grossFee)}`);
    }
    if (fmt.includeNetFee && typeof e.netFee === 'number' && e.netFee > 0) {
      feeLine.push(`Netto: ${new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(e.netFee)}`);
    }
    if (feeLine.length) {
      lines.push(`💰 ${feeLine.join(' · ')}`);
    }
    if (fmt.includeCompensoType && e.compensoType) {
      const cmap: Record<string, string> = {
        fuori_fattura: '🍀 Fuori fattura',
        in_fattura: '📄 In fattura',
      };
      lines.push(`   ${cmap[e.compensoType] ?? e.compensoType}`);
    }

    // 📝 Note libere evento
    if (fmt.includeNotes && e.notes?.trim()) {
      lines.push('');
      lines.push(`📝 Note: ${e.notes.trim()}`);
    }

    // 🎵 Footer Musicista Manager (default off)
    if (fmt.includeAppFooter) {
      lines.push('');
      lines.push(`🎵 Musicista Manager · Evento #${e.id?.slice(0, 8) ?? ''}`);
    }

    return lines.join('\n').trim();
  }

  /** App EventDetail → Google Calendar v3 Event (solo campi base).
   *  Ora description usa il formato check-boxabile definito in GcalSettings.noteFormat. */
  private _toGoogleEvent(local: EventDetail): Record<string, unknown> {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Rome';
    const start = this._buildGoogleDateTime(local.date, local.timeStart, tz);
    const end = this._buildGoogleDateTime(local.date, (local.timeEnd || local.timeStart), tz, local.timeStart ? true : false);

    const payload: Record<string, unknown> = {
      summary: local.title || 'Evento senza titolo',
      location: [local.venue, local.address].map((x) => `${x || ''}`.trim()).filter(Boolean).join(', '),
      start,
      end,
    };
    const description = this.buildGoogleDescriptionFromFormat(local, this.resolveNoteFormatOrDefault());
    if (description && description.length > 0) payload['description'] = description;
    if (local.status === 'cancelled') payload['status'] = 'cancelled';
    return payload;
  }

  /** Google Event → nuovo EventDetail locale con default base. */
  /**
   * Converte un evento Google (raw API) → EventDetail locale.
   *
   * Inferenza TYPE SMART (invece del vecchio 'other' che non compare nelle liste!):
   *  - 'lesson'  : titolo contiene "lezion", "ripetizion", "scuola", "solfe", "armon"
   *  - 'dj_set'  : titolo contiene "dj", "discoteca", "serata", "consolle", "club"
   *  - 'concert' : titolo contiene "concert", "live", "serata", "show", "gig",
   *                "rehearsal", "prov", "saggio", "festa"
   *  - default   : 'concert' (profili Musicista, il tipo di default più frequente)
   *
   * Inoltre se l'evento era già stato importato e in locale ha un type valido,
   * verrà preservato da _mergeBaseFields per gli aggiornamenti.
   */
  private _fromGoogleEvent(g: GoogleEvent, now: string): EventDetail {
    const { date, timeStart, timeEnd } = this._parseGoogleDateTime(g.start, g.end);
    const tit = (g.summary || '').toLowerCase();
    let type: 'concert' | 'lesson' | 'dj_set' | 'other' = 'concert';
    if (/lezz?ion|ripetizion|scuola|solfe[g5]|armon|maest[ro]/.test(tit)) type = 'lesson';
    else if (/\bdj\b|discoteca|consolle|club\b|boiler|deejay/.test(tit))       type = 'dj_set';
    else if (
      /concert|live|serat|show|\bgig\b|prov[ae]?|rehearsal|saggio|fest[ae]|matrim|cresim|comunione|event/.test(tit)
    ) type = 'concert';
    return {
      id: crypto.randomUUID(),
      googleEventId: g.id,
      title: (g.summary || '').trim() || 'Evento importato',
      date,
      timeStart,
      timeEnd: timeEnd || undefined,
      venue: this._venueFromLocation(g.location),
      address: this._addressFromLocation(g.location),
      type,
      band: [],
      grossFee: 0,
      netFee: 0,
      status: g.status === 'cancelled' ? 'cancelled' : 'confirmed',
      notes: g.description || '',
      createdAt: now,
      updatedAt: g.updated || now,
    };
  }

  /**
   * Merge dei soli campi base da Google → evento locale già esistente.
   * Campi extra (type, status, fee, band, compensoType) NON vengono toccati
   * (preserviamo dati locali non rappresentabili in Google).
   */
  private _mergeBaseFields(local: EventDetail, g: GoogleEvent): EventDetail {
    const { date, timeStart, timeEnd } = this._parseGoogleDateTime(g.start, g.end);
    return {
      ...local,
      title: (g.summary || local.title || '').trim() || local.title,
      date: date || local.date,
      timeStart: timeStart || local.timeStart,
      timeEnd: timeEnd || local.timeEnd || undefined,
      venue: this._venueFromLocation(g.location) || local.venue,
      address: this._addressFromLocation(g.location) || local.address,
      notes: g.description ?? local.notes,
      // status: non forzo cancellato→non annullato; viceversa sì per coerenza
      status: (g.status === 'cancelled') ? 'cancelled' : local.status,
      googleEventId: g.id || local.googleEventId,
    };
  }

  private _buildGoogleDateTime(
    dateStr: string,
    timeStr: string | undefined,
    tz: string,
    addDefaultDuration = false
  ): Record<string, unknown> {
    const iso = this._toIsoWithTimezone(dateStr, timeStr || '00:00', tz);
    if (!timeStr) {
      // evento tutto-il-giorno se manca timeStart
      return { date: dateStr || new Date().toISOString().slice(0, 10) };
    }
    let isoEnd = iso;
    if (addDefaultDuration && timeStr) {
      try {
        const base = new Date(iso);
        base.setTime(base.getTime() + 2 * 60 * 60 * 1000); // +2h default
        isoEnd = base.toISOString();
      } catch {}
    }
    return { dateTime: iso, timeZone: tz };
  }

  private _toIsoWithTimezone(dateStr: string, timeStr: string, tz: string): string {
    if (!dateStr) return new Date().toISOString();
    // `YYYY-MM-DDTHH:mm:ss` e poi convertiamo in ISO usando offset locale
    const local = new Date(`${dateStr}T${timeStr || '00:00:00'}`);
    if (Number.isNaN(local.getTime())) return new Date().toISOString();
    return local.toISOString();
  }

  private _parseGoogleDateTime(
    start?: { dateTime?: string; date?: string; timeZone?: string },
    end?:   { dateTime?: string; date?: string; timeZone?: string }
  ): { date: string; timeStart: string; timeEnd: string } {
    const { d: d1, t: t1 } = this._splitGoogleDate(start);
    const { d: d2, t: t2 } = this._splitGoogleDate(end);
    return {
      date: d1 || d2 || new Date().toISOString().slice(0, 10),
      timeStart: t1,
      timeEnd: (t1 && t2 && t1 !== t2) ? t2 : '',
    };
  }

  /**
   * Parsa una data Google (date per tutto-il-giorno o dateTime con timezone).
   * Restituisce SEMPRE la data in formato locale YYYY-MM-DD (non UTC!).
   *
   * Bug storici risolti:
   *  - NON usiamo new Date() + getTimezoneOffset con segno invertito (la formula
   *    date.getTime() - offset*60*1000 ha il SEGNO SBAGLIATO per UTC+!).
   *  - Per 'date' (ISO "YYYY-MM-DD", tutto-il-giorno): la restituiamo TALE E QUALE
   *    perché Google Calendar usa già la data locale nel calendario.
   *  - Per 'dateTime' (con Z timezone): usiamo toLocaleString it-IT così otteniamo
   *    giorno/mese/anno e ore/minuti COME VISUALIZZATI sul calendario dell'utente.
   */
  private _splitGoogleDate(x?: { dateTime?: string; date?: string }): { d: string; t: string } {
    if (!x) return { d: '', t: '' };
    if (x.date) {
      return { d: x.date.slice(0, 10), t: '' };
    }
    if (x.dateTime) {
      try {
        const date = new Date(x.dateTime);
        if (Number.isNaN(date.getTime())) return { d: '', t: '' };
        // Usa formatter it-IT, fallback safe se Intl non restituisce parti attese
        const parts = new Intl.DateTimeFormat('it-IT', {
          year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', hour12: false
        }).formatToParts(date).reduce<any>((acc, p) => { acc[p.type] = p.value; return acc; }, {});
        const yyyy = parts.year ?? date.getFullYear().toString();
        const mm   = parts.month ?? ((date.getMonth() + 1).toString().padStart(2, '0'));
        const dd   = parts.day ?? date.getDate().toString().padStart(2, '0');
        const hh   = parts.hour ?? date.getHours().toString().padStart(2, '0');
        const mi   = parts.minute ?? date.getMinutes().toString().padStart(2, '0');
        return { d: `${yyyy}-${mm}-${dd}`, t: `${hh}:${mi}` };
      } catch (err) {
        console.warn('[GCal] _splitGoogleDate fallito per:', x.dateTime, err);
        return { d: '', t: '' };
      }
    }
    return { d: '', t: '' };
  }

  /**
   * Scomponi la location di Google (stringa tipo "Teatro Verdi, Via Roma 1, Milano")
   * in venue = prima parte e address = resto. Euristico ma sufficiente.
   */
  private _venueFromLocation(loc: string | undefined): string {
    if (!loc) return '';
    const parts = loc.split(',').map((x) => x.trim()).filter(Boolean);
    return parts[0] || '';
  }

  private _addressFromLocation(loc: string | undefined): string {
    if (!loc) return '';
    const parts = loc.split(',').map((x) => x.trim()).filter(Boolean);
    return parts.slice(1).join(', ');
  }

  /** 🆕 Helper privato: guess event type da titolo (identica regola _fromGoogleEvent,
   *  usato per dedup chiavi e tombstone check — STESSA REGOLA, NO DRIFT! */
  private _guessEventType(summary: string | null | undefined): 'concert' | 'lesson' | 'dj_set' | 'other' {
    const tit = (summary || '').toLowerCase();
    if (/lezz?ion|ripetizion|scuola|solfe[g5]|armon|maest[ro]/.test(tit)) return 'lesson';
    if (/\bdj\b|discoteca|consolle|club\b|boiler|deejay/.test(tit))  return 'dj_set';
    if (/concert|live|serat|show|\bgig\b|prov[ae]?|rehearsal|saggio|fest[ae]|matrim|cresim|comunione|event/.test(tit)) return 'concert';
    return 'concert';
  }

  /**
   * Fuzzy match per evitare DOPPIONI SOLAMENTE se due eventi sono UGUALI:
   * - STESSA DATA (YYYY-MM-DD)
   * - STESSO TITOLO (case insensitive, ignorando spazi/punteggiatura superflua)
   *
   * Rimosso l'`includes` perché causava FALSI POSITIVI (es. locale "Concerto acustico"
   * matchava con GOOGLE "Concerto di Natale 2023" → poi finiva in fuzzy branch invece che
   * come nuovo evento importato, generando centinaia di falsi "conflitti").
   */
  private _findFuzzyMatch(local: EventDetail[], candidate: EventDetail, excludeIds?: Set<string>): EventDetail | null {
    // ✅ Helper CONDIVISO con dedup locale + tombstone: STESSA funzione normalizeTitleForDedup.
    //    Zero drift: se cambio da una parte cambiano TUTTE.
    const needle = normalizeTitleForDedup(candidate.title);
    if (!needle || needle.length < 3) return null;

    let sameDay = local.filter((e) => e.date === candidate.date);
    if (excludeIds && excludeIds.size) {
      sameDay = sameDay.filter(e => !excludeIds.has(e.id));
    }
    if (!sameDay.length) return null;

    sameDay.sort((a, b) => {
      const aHas = a.googleEventId ? 1 : 0;
      const bHas = b.googleEventId ? 1 : 0;
      if (aHas !== bHas) return aHas - bHas;
      return 0;
    });

    for (const ev of sameDay) {
      const hay = normalizeTitleForDedup(ev.title);
      if (!hay) continue;
      if (hay === needle) return ev;
      if (hay.length >= 10 && needle.length >= 10) {
        const minLen = Math.min(hay.length, needle.length);
        const maxLen = Math.max(hay.length, needle.length);
        if ((hay.includes(needle) || needle.includes(hay)) && minLen / maxLen >= 0.75) {
          return ev;
        }
      }
    }
    return null;
  }

  // ─── Delta sync push automatico app → Google ───────────────────────────────

  /**
   * Calcola differenza (prev vs next array eventi) e invia create/update/delete
   * a Google Calendar in fire-and-forget. Non throw MAI: ogni errore è loggato.
   * Non bloccante: termina subito dopo aver schedulato le Promise.
   *
   * Chiamato automaticamente dal wrapper `persistEventsWithSync()` dopo ogni
   * scrittura centralizzata eventi locale (se handler è stato registrato nel
   * constructor del servizio).
   */
  public syncOutgoingDelta(prev: EventDetail[], next: EventDetail[]): void {
    if (this._connectionState$.value !== 'connected') {
      console.info('[GCal push] SKIP (stato non connesso):', this._connectionState$.value);
      return;
    }
    const calendarId = this._selectedCalendarId$.value;
    if (!calendarId) {
      console.warn('[GCal push] SKIP: nessun calendario selezionato! Seleziona un calendario di destinazione nella scheda Profilo.');
      return;
    }

    try {
      // ⭐ DATA DI INIZIO SINCRO (cutoff) — usiamo anche questa nei filtri.
      const syncCutoff = this.syncStartDateSnapshot;
      const prevMap = new Map<string, EventDetail>();
      for (const e of prev) prevMap.set(e.id, e);
      const nextMap = new Map<string, EventDetail>();
      for (const e of next) nextMap.set(e.id, e);

      let nDel = 0, nCre = 0, nUpd = 0, nCutSkip = 0;

      // --- Eventi da CANCELLARE: in prev ma non in next, con googleEventId ---
      const toDelete: EventDetail[] = [];
      let nTomb = 0; // quanti ID aggiunti ai tombstone (debug sampling)
      for (const [id, prevEv] of prevMap) {
        if (nextMap.has(id)) continue;
        if (prevEv.googleEventId) {
          // =========================================================
          // 🧟  FIX TOMBSTONE (sempre, senza eccezioni):
          // Anche se saltiamo DELETE per CUTOFF o per altri motivi,
          // l'utente ha RIMOSSO volutamente l'evento dall'app!
          // Quindi aggiungiamo googleEventId al TOMBSTONE SET
          // PER SEMPRE: non lo ri-importerà MAI da Google.
          // =========================================================
          const added = this._tombstoneAdd(prevEv.googleEventId);
          if (added) nTomb++;
          // ⭐ CUTOFF: se l'evento cancellato è precedente a syncCutoff →
          // NON inviamo la DELETE a Google (non ci interessa sincronizzare il
          // passato). Anche se è stato rimosso in locale, lasciamolo su Google.
          if (!this.isEventWithinSyncWindow(prevEv.date)) { nCutSkip++; continue; }
          toDelete.push(prevEv);
        }
      }
      for (const ev of toDelete) {
        nDel++;
        void this.deleteGoogleEvent(ev).catch((e) => {
          console.error(`[GCal push delete fallito ${ev.id}]:`, e);
          // Nota: l'evento è GIA' nel TOMBSTONE, quindi anche se la DELETE API
          // fallisce non lo ri-importiamo al prossimo sync import. OK!
        });
      }

      // --- Eventi da CREARE: in next non in prev, SENZA googleEventId ---
      const toCreate: EventDetail[] = [];
      for (const [id, nextEv] of nextMap) {
        if (prevMap.has(id)) continue;
        if (nextEv.googleEventId) continue;
        if (nextEv.status === 'cancelled') continue;
        // ⭐ CUTOFF: se l'evento nuovo è < cutoff → NON mandarlo a Google!
        if (!this.isEventWithinSyncWindow(nextEv.date)) { nCutSkip++; continue; }
        toCreate.push(nextEv);
      }
      for (const ev of toCreate) {
        nCre++;
        void this.createGoogleEvent(ev)
          .then((gId) => {
            if (!gId) return;
            try {
              const current = readEventsWithBackfill();
              let mutated = false;
              const patched = current.map((x) => {
                if (x.id === ev.id && !x.googleEventId) {
                  // ⭐ FIX #5a: idempotenza — scriviamo googleEventId SOLO se
                  // l'evento locale è ancora SENZA (evitiamo Promise concorrenti
                  // che si sovrascrivono a vicenda).
                  mutated = true;
                  return { ...x, googleEventId: gId } as EventDetail;
                }
                return x;
              });
              if (mutated) {
                writeEventsWithTimestamp(patched);
                // Notifica Dashboard/Agenda di ricaricare gli array in memoria:
                setTimeout(() => this._eventsChanged$.next(), 50);
                console.info(`[GCal push create OK] ${ev.title} (${ev.date}) → googleId=${gId.slice(0, 12)}...`);
              } else {
                console.info(`[GCal push create] ${ev.title} (${ev.date}) gia' patchato con googleId in corso (skip doppia write).`);
              }
            } catch (err) {
              console.error('[GCal push create patch locale fallita]:', err);
            }
          })
          .catch((e) => {
            console.error(`[GCal push create fallito ${ev.id}]:`, e);
          });
      }

      // --- Eventi da AGGIORNARE: presenti in entrambi e cambiati ---
      const toUpdate: EventDetail[] = [];
      for (const [id, nextEv] of nextMap) {
        const prevEv = prevMap.get(id);
        if (!nextEv.googleEventId) continue;
        if (!prevEv) {
          // ⭐ CUTOFF: anche se non c'è in prev, controlliamo la data
          if (!this.isEventWithinSyncWindow(nextEv.date)) { nCutSkip++; continue; }
          toUpdate.push(nextEv);
          continue;
        }
        const isChanged = this._isLocalEventChanged(prevEv, nextEv);
        if (isChanged) {
          // ⭐ CUTOFF: non inviare UPDATE per eventi precedenti al cutoff!
          if (!this.isEventWithinSyncWindow(nextEv.date)) { nCutSkip++; continue; }
          toUpdate.push(nextEv);
        }
      }
      for (const ev of toUpdate) {
        nUpd++;
        void this.updateGoogleEvent(ev).catch((e) => {
          console.error(`[GCal push update fallito ${ev.id}]:`, e);
        });
      }

      if (nDel + nCre + nUpd + nCutSkip + nTomb > 0) {
        const lines = [];
        if (nCre) lines.push(`crea=${nCre}`);
        if (nUpd) lines.push(`aggiorna=${nUpd}`);
        if (nDel) lines.push(`cancella=${nDel}`);
        if (nCutSkip) lines.push(`🟡SKIP_cutoff_<${syncCutoff}=${nCutSkip} (non invio a Google: dati storici)`);
        if (nTomb) lines.push(`🧟TOMBSTONE=${nTomb} (ID Google marcati come "cancellati definitivamente")`);
        console.info(`[GCal push] delta triggerato: ${lines.join(' ')} calendario=${calendarId}`);
      }
    } catch (err) {
      console.error('[GCal syncOutgoingDelta errore generico]:', err);
    }
  }

  /**
   * Catch-up push: crea in Google tutti gli eventi locali ancora sprovvisti di googleEventId.
   * Utile quando:
   *  - l'utente ha creato eventi PRIMA di collegare Google Calendar / selezionare il calendario
   *  - eventi vecchi non ancora sincronizzati per cadute di rete
   *
   * Viene chiamato in automatico: (a) quando connection.state passa a 'connected'
   * (b) quando selectedCalendarId cambia.
   */
  public catchUpPushLocalEvents(): void {
    if (this._connectionState$.value !== 'connected') return;
    const calendarId = this._selectedCalendarId$.value;
    if (!calendarId) return;
    const tutti = readEventsWithBackfill();
    // ⭐ CUTOFF: MANDATORIO: NON mandiamo a Google SOLO gli eventi successivi
    //    * data inizio sincro. I dati storici locali (anche se hanno googleEventId
    //    non lo vogliamo più propagare!
    const syncCutoff = this.syncStartDateSnapshot;
    const mancanti = tutti.filter(e =>
      !e.googleEventId &&
      e.status !== 'cancelled' &&
      this.isEventWithinSyncWindow(e.date)
    );
    const storicoIgnorati = tutti.filter(e =>
      !e.googleEventId && e.status !== 'cancelled' && !this.isEventWithinSyncWindow(e.date)
    ).length;
    if (!mancanti.length) {
      console.info(
        `[GCal push catch-up] nessun evento post-${syncCutoff} da creare in Google (storici ignorati=${storicoIgnorati}). OK.`
      );
      return;
    }
    console.warn(
      `[GCal push catch-up] Trovati ${mancanti.length} eventi post-${syncCutoff} creati PRIMA della connessione Google. Creo in calendario=${calendarId} (storici ignorati=${storicoIgnorati}).`);
    let n = 0;
    for (const ev of mancanti) {
      n++;
      if (n === 1) console.groupCollapsed('[GCal push catch-up] dettaglio eventi creati');
      void this.createGoogleEvent(ev)
        .then((gId) => {
          if (!gId) return;
          try {
            const current = readEventsWithBackfill();
            let mutated = false;
            const patched = current.map((x) => {
              if (x.id === ev.id && !x.googleEventId) {
                // ⭐ FIX #5b: idempotenza — patch solo se ancora senza googleId
                mutated = true;
                return { ...x, googleEventId: gId } as EventDetail;
              }
              return x;
            });
            if (mutated) {
              writeEventsWithTimestamp(patched);
              console.info(`   #${n} ${ev.date} ${ev.title} → googleId=${gId.slice(0, 14)}...`);
            } else {
              console.info(`   #${n} ${ev.date} ${ev.title} (gia' patchato — skip)`);
            }
          } catch (err) {
            console.error(`   #${n} FAIL patch ${ev.title}:`, err);
          }
        })
        .catch(err => console.error(`   #${n} FAIL ${ev.title}`, err));
    }
    if (n > 0) {
      console.groupEnd();
      // Dopo 1.5s (quando le chiamate create sono finite) emetti eventsChanged
      // così gli eventi appena patchati con googleEventId si vedono in UI.
      setTimeout(() => this._eventsChanged$.next(), 1500);
    }
  }

  /** Confronta due snapshot dello stesso evento per capire se il diff vale un push. */
  private _isLocalEventChanged(a: EventDetail, b: EventDetail): boolean {
    if (a.updatedAt !== b.updatedAt) return true;
    if (a.title !== b.title) return true;
    if (a.date !== b.date) return true;
    if (a.timeStart !== b.timeStart) return true;
    if (a.timeEnd !== b.timeEnd) return true;
    if (a.venue !== b.venue) return true;
    if (a.address !== b.address) return true;
    if (a.notes !== b.notes) return true;
    if (a.status !== b.status) return true;
    return false;
  }
}
