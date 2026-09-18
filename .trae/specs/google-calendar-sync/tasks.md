# Integrazione Google Calendar Bidirezionale — Implementation Plan (Tasks)

## Task 1: Setup infrastruttura — Config Google, typings, asset config
- **Status**: `pending`
- **Priority**: high
- **Depends On**: None
- **Description**:
  - Aggiungere devDependency `@types/google.accounts` per i typings di Google Identity Services.
  - Creare `src/assets/google.config.json` (template) e `src/assets/google.config.example.json` con campi: `{ "clientId": "YOUR_OAUTH_CLIENT_ID.apps.googleusercontent.com", "scopes": ["https://www.googleapis.com/auth/calendar.events"] }`. Aggiunta a `.gitignore` del file reale se vuole evitare di committare clientId (opzionale: lasciare template e committare solo example).
  - Estendere `ConfigService` o leggere l'asset `google.config.json` direttamente nel nuovo servizio; se manca o `clientId` è placeholder, servizio torna stato `not_configured` e UI mostra istruzioni.
  - Aggiungi a `tsconfig.app.json` o typing globali riferimento a `google.accounts` tramite typeRoots/Types.
- **Acceptance Criteria Addressed**: AC-1, AC-8
- **Test Requirements**:
  - `rule` TR-1.1: Installando il pacchetto e avviando `npm run build` non ci sono errori di typing mancanti per google.accounts.
  - `rule` TR-1.2: Se google.config.json contiene `clientId` placeholder, il servizio restituisce `state === 'not_configured'` senza throw.
- **Notes**: Non caricare lo script GSI a bootstrap; caricamento lazy su click "Connetti".

## Task 2: Estensione modello EventDetail (updatedAt, googleEventId) e migrazione sicura
- **Status**: `pending`
- **Priority**: high
- **Depends On**: Task 1
- **Description**:
  - Aggiungere a `EventDetail` ([event-detail.ts](file:///Users/claudio/Documents/trae_projects/musican_manager_26/src/app/models/event-detail.ts)) campi opzionali `googleEventId?: string` e `updatedAt: string` (reso obbligatorio con migrazione).
  - In ogni punto di lettura `safeParse<EventDetail[]>` di `mm_events`: se `createdAt` esiste ma `updatedAt` è mancante → valorizza `updatedAt = createdAt ?? new Date().toISOString()` (backfill). Nessun throw.
  - In ogni punto di scrittura `mm_events`: prima di salvare, valorizza `updatedAt = new Date().toISOString()` (se l'evento è nuovo, aggiorna anche `createdAt`).
  - Aggiorna typings `EventItem` in agenda.component.ts e qualunque altro alias Event usato nel progetto per includere `updatedAt` e `googleEventId`.
- **Acceptance Criteria Addressed**: AC-3, AC-4, AC-5, AC-6
- **Test Requirements**:
  - `rule` TR-2.1: Eventi creati prima dell'integrazione (senza updatedAt) dopo un reload dell'app hanno updatedAt valorizzato senza errori o loss di dati.
  - `rule` TR-2.2: Un evento nuovo creato in Agenda ha updatedAt popolato e time ISO valido.
- **Notes**: Non toccare `id` esistenti; backfill è locale e non richiede scrittura automatica al load (la scrittura avviene solo al prossimo salvataggio utente o al prossimo sync; tuttavia è lecito salvare subito il backfill se la dimensione del dataset è bassa — farlo se <1000 eventi per sicurezza).

## Task 3: Servizio GoogleCalendarService centralizzato
- **Status**: `pending`
- **Priority**: high
- **Depends On**: Task 2
- **Description**:
  - Creare `src/app/core/google-calendar.service.ts` `@Injectable({ providedIn: 'root' })` con:
    - Observable/stato pubblico: `connectionState$ = BehaviorSubject<'not_configured' | 'disconnected' | 'connecting' | 'connected' | 'expired' | 'error'>`
    - Proprietà pubbliche read: `connectedEmail$`, `selectedCalendarId$`, `selectedCalendarSummary$`, `lastSyncAt$`
    - Metodi pubblici:
      - `lazyLoadGsiScript(): Promise<void>` — carica `https://accounts.google.com/gsi/client` solo la prima volta.
      - `startOAuthFlow(): Promise<void>` — inizializza `google.accounts.oauth2.initCodeClient` con PKCE, client_id da config, redirect_uri=self, scope `calendar.events`. Dopo callback con `code`, scambia codice con token endpoint Google `https://oauth2.googleapis.com/token` (fetch). Attenzione: in SPA, flusso Authorization Code con PKCE; usare `code_verifier` e `code_challenge=S256`. Salvare `access_token` e `expires_in` solo **in memoria** (non in localStorage, per sicurezza).
      - `disconnect(): void` — pulisce token in memoria e stato.
      - `fetchCalendarList(): Promise<{id: string, summary: string, description?: string}[]>` — GET `calendar/v3/users/me/calendarList`.
      - `setSelectedCalendarId(calId: string): Promise<void>` — salva la scelta in `mm_gcal_settings` (via LocalStorageService).
      - `createGoogleEvent(localEvent: EventDetail): Promise<string>` — POST `/calendars/{id}/events` con mapping campi base definiti in spec; restituisce `googleEventId`. Chiama `.catch()` e propaga errore in stato.
      - `updateGoogleEvent(localEvent: EventDetail): Promise<void>` — PUT se `googleEventId` valorizzato.
      - `deleteGoogleEvent(localEvent: EventDetail): Promise<void>` — DELETE se `googleEventId` valorizzato.
      - `importGoogleEvents(options?: {since?: Date}): Promise<{imported: number, updated: number, skipped: number, conflicts: number}>` — GET `/calendars/{id}/events` con `timeMin` e opzionale `updatedMin`; per ogni evento applica LWW e scrive in `mm_events`; aggiorna `lastSyncAt`.
      - `resolveToken(): Promise<string | null>` — se token in memoria valido lo restituisce; altrimenti prova token refresh se disponibile (senza bloccare l'app); se scaduto set stato `expired`.
  - Ogni chiamata fetch a Google Calendar include header `Authorization: Bearer ${token}` e `Content-Type: application/json`. Ogni response 401 commuta stato in `expired`; altri errori 4xx/5xx loggano console.error ma non throwano.
- **Acceptance Criteria Addressed**: AC-1, AC-3, AC-4, AC-5, AC-6, AC-7
- **Test Requirements**:
  - `rule` TR-3.1: Chiamata `createGoogleEvent` con evento campi base produce un `POST` con payload coerente e ritorna un id non vuoto (con mock o test manuale).
  - `rule` TR-3.2: Token scaduto (simulato con token vuoto) → `connectionState$` emette `expired`, nessun throw.
  - `rubric` TR-3.3: Qualità servizio; scale 1-5; 1 = nudi fetch senza try/catch, 3 = try/catch base ma log troppo generici, 5 = ogni catch categorizzato per 401/403/4xx/5xx/Network con messaggi distinti e recovery; soglia >=4.
- **Notes**: Per scambiare code→token in SPA: verificare che il clientId di tipo "Applicazione Web" abbia URI di reindirizzamento e Javascript origin autorizzati. Se CORS blocca exchange per il tipo SPA, è possibile usare `google.accounts.oauth2.initTokenClient` invece (implicito → access_token diretto senza exchange). Adottare initTokenClient come fallback più semplice se initCodeClient con PKCE da CORS issues; in tal caso scrivere commento nel servizio.

## Task 4: UI Integrazioni Google — Pannello connessione / selezione calendario / pulsanti
- **Status**: `pending`
- **Priority**: high
- **Depends On**: Task 3
- **Description**:
  - Creare nuova sezione "Integrazioni" o espandere l'area Impostazioni nel Profilo o in un componente dedicato (opzione consigliata: aggiungere sezione in `register.component` / `musician-form.component` dopo i ruoli, oppure un tab/link nuovo). UI minima:
    - Card "Google Calendar" con:
      - Badge stato: colorato (rosso=non configurato/scaduto, grigio=disconnesso, verde=connesso)
      - Label stato: "Non configurato", "Disconnesso", "Connesso come mario@...", "Sessione scaduta — Riconnetti"
      - Se `not_configured` → pannello istruzioni con link a console.cloud.google.com e passaggi per creare Client ID.
      - Pulsanti: `[Connetti Google Calendar]` (verde, 46px), `[Disconnetti]` (outline-rosso se connesso)
      - Se `connected`: mostra "Calendario di destinazione: {name}" con pulsante `[Cambia calendario...]`.
      - Subito dopo la prima connessione mostra modale/dropdown lista calendari fetchata da `fetchCalendarList()` con radio-button per scelta; tasto conferma salva scelta.
      - Pulsante `[↻ Sincronizza da Google Calendar]` + label ultimo sync "Ultima sincronizzazione: {data}".
      - Dopo un'operazione di import mostra messaggio riepilogo "X nuovi · Y aggiornati · Z saltati".
  - Aggiungere anche pulsante piccolo `[Sync Google ↓]` nell'header di Agenda e Dashboard per accesso rapido (chiama lo stesso importGoogleEvents).
- **Acceptance Criteria Addressed**: AC-1, AC-2, AC-9
- **Test Requirements**:
  - `rule` TR-4.1: Stato "Non configurato" → pulsante Connetti disabilitato oppure al click mostra istruzioni; nessuna chiamata fetch a Google se ClientId non è configurato.
  - `rule` TR-4.2: Subito dopo aver scelto il calendario X, `selectedCalendarId$` emette X e prossima createGoogleEvent usa X come calendarId (verificabile da payload della chiamata).
  - `rubric` TR-4.3: UI/UX della sezione; scale 1-5; 1=sprotocollata, 3=base ma ordinata, 5=stile coerente con il resto dell'app, tooltip help dove serve, badge colorati chiari; soglia >=4.
- **Notes**: Rendere la sezione accessibile; rispettare le preferenze utente (pulsanti 46px, verde smeraldo per azione primaria tipo "Connetti/Sincronizza", icone grandi).

## Task 5: Hook scrittura eventi centralizzati — push automatico app→Google
- **Status**: `pending`
- **Priority**: high
- **Depends On**: Task 4
- **Description**:
  - Individuare TUTTI i punti che fanno `setItem('mm_events', ...)` o equivalente (elenco 12 file dal grep):
    Agenda, Dashboard, Teaching, Reports, Expenses, ContractView, Concerts, Communication, BookingRequest, Accounting, Events, History.
  - Creare un helper in SupabaseService o in un servizio dedicato (consigliato: metodo in `SupabaseService` già centralizza sync) chiamato **`persistEventsWithSync(events: EventDetail[], { source: string })`** che:
    1. Salva in localStorage `mm_events` come oggi.
    2. **Se** GoogleCalendarService è `connected` e `selectedCalendarId` valorizzato:
       - Calcola il delta (eventi creati, aggiornati, cancellati) tra l'ultimo snapshot salvato e quello nuovo.
       - Inizia una promise in background: per ogni evento creato → `createGoogleEvent` + patch locale con `googleEventId` e risave; per ogni aggiornato (con googleEventId) → `updateGoogleEvent`; per ogni cancellato (con googleEventId) → `deleteGoogleEvent`.
       - Se una qualsiasi promise fallisce: non rollback locale, ma emette notifica toast/banner "Salvato localmente ma sync Google non riuscito: [{nomi eventi}] — Riprova tra poco o clicca Riconnetti".
  - Rimpiazzare TUTTE le scritture grezze a `mm_events` con la chiamata al nuovo metodo.
  - Alternative (meno invasiva, opzione B se refactor 12 file troppo oneroso): aggiungere un listener `window.addEventListener('storage')` + hook in LocalStorageService che intercetta write su `mm_events` e triggera sync. Preferire opzione A (metodo centralizzato) perché più deterministica.
- **Acceptance Criteria Addressed**: AC-3, AC-4, AC-5, AC-10
- **Test Requirements**:
  - `rule` TR-5.1: Dopo Task 5 non esiste più alcuna `localStorage.setItem('mm_events',` grezza nel codice sorgente: verificare con `Grep 'mm_events'`.
  - `rule` TR-5.2: Connessione Google attiva; creo evento da Dashboard → compare su GCal entro 3 secondi (push immediato).
  - `rubric` TR-5.3: Qualità architettura hook; scale 1-5; 1=patch sparsi ovunque, 3=un wrapper ma con duplicazioni, 5=servizio centralizzato, delta calcolato in modo puro, fallimenti non bloccanti, log espliciti; soglia >=4.
- **Notes**: Gestire race-condition: se utente salva 2 volte in <1s lo stesso evento, delta deve prendere ultima versione.

## Task 6: Logica di import con Last-Write-Wins + report di sintesi
- **Status**: `pending`
- **Priority**: high
- **Depends On**: Task 5
- **Description**:
  - Implementare in GoogleCalendarService.importGoogleEvents:
    1. `GET /calendars/{selectedCalendarId}/events?maxResults=2500&timeMin=threeMonthsAgoISO&orderBy=updated&singleEvents=true`
    2. Per ogni `gEvent` nella risposta:
       - Cerca locale `existing = eventsByGoogleId.get(gEvent.id)` oppure se gEvent.id non bindato, cerca per match fuzzy su (title, date, timeStart). Se trovato senza bind → bindalo (`existing.googleEventId = gEvent.id`).
       - Applica LWW: converti `existing.updatedAt ?? existing.createdAt` in Date, e `gEvent.updated` in Date.
         - Se `googleDt > localDt`: update campi base locale (title, date, start/end time, venue, address, notes). **NON TOCCARE** `type, status, grossFee, netFee, band, compensoType`. Assegna `googleEventId` se non c'era. Contatore `updated++`.
         - Se `localDt > googleDt`: lascia locale invariato. Contatore `skipped++`. In background lancia `updateGoogleEvent` per allineare Google prossimamente.
         - Se non esiste locale: crea nuovo evento con campi base e default per extra (`type='other'`, `status='confirmed'`, `fee=0`, `band=[]`). Contatore `imported++`.
    3. Risave `mm_events` + aggiorna `lastSyncAt` in `mm_gcal_settings`.
    4. Ritorna oggetto report.
  - A UI mostrare il report per ~5 secondi in un toast/banner colorato.
- **Acceptance Criteria Addressed**: AC-4, AC-5, AC-6
- **Test Requirements**:
  - `rule` TR-6.1: Import di un evento Google modificato dopo l'evento locale corrispondente → sovrascrittura dei soli campi base; `type` e `fee` restano invariati.
  - `rule` TR-6.2: Import senza eventi nuovi → report 0/0/N.
  - `rubric` TR-6.3: Robustezza edge-case; scale 1-5; 1=crash se location null o timeStart manca, 3=base con default ma report impreciso, 5=gestisce eventi multi-giorno, eventi senza endTime, location vuota, note null; soglia >=4.

## Task 7: Gestione stato scaduto / errore + banner in app + test end-to-end manuali
- **Status**: `pending`
- **Priority**: medium
- **Depends On**: Task 6
- **Description**:
  - Aggiungere un banner persistente in alto (sotto header, color rosso/arancione) se `connectionState$ === 'expired'` con testo "Sessione Google Calendar scaduta — [Riconnetti]". Click su Riconnetti lancia startOAuthFlow.
  - Aggiungere toast non bloccante per push falliti, import falliti, ecc.
  - Verificare retrocompatibilità Supabase: sync Supabase locale→remoto non deve essere influenzato dai nuovi campi googleEventId/updatedAt (sono opzionali).
  - Eseguire test manuali end-to-end:
    - Caso 1: Connetti → seleziona calendario X → crea evento da app → verifica Google; modifica da app → verifica Google; cancella da app → verifica Google.
    - Caso 2: Crea evento da Google UI → importa in app → verifica lista. Modifica evento su Google → importa → verifica aggiornato. Modifica lo stesso evento su app (dopo Google) → risincronizza → app vince su Google (push).
    - Caso 3: Disconnetti → elimina manualmente access token da memoria → ricarica app → stato = disconnesso senza errori. Riconnetti → funziona.
- **Acceptance Criteria Addressed**: AC-7, AC-10
- **Test Requirements**:
  - `rule` TR-7.1: Scaduto simulato → banner visibile, click Riconnetti apre OAuth e torna stato connected.
  - `rule` TR-7.2: Sync Supabase dopo modifiche eventi non fallisce (verificare da console SupabaseService syncState$ non 'error').
  - `rubric` TR-7.3: Punteggio Q/A manuale end-to-end; scale 1-5; 1=almeno un caso fallisce, 3=tutti passano ma con UI scomoda o ritardi, 5=tutti passano, feedback chiari, nessun delay percepibile; soglia >=4.

## Task 8: Build, lint, diagnostiche finali + documentazione inline (commenti in italiano)
- **Status**: `pending`
- **Priority**: medium
- **Depends On**: Task 7
- **Description**:
  - `npm run build` deve essere PASS.
  - GetDiagnostics 0 errori gravi.
  - Tutti i nuovi file e i metodi principali hanno commenti in italiano come da user rule.
  - Aggiornare/creare file `src/assets/google.config.example.json` con README interno (commentato) su dove trovare il Client ID e quali URI autorizzare su Google Cloud Console.
- **Acceptance Criteria Addressed**: AC-8
- **Test Requirements**:
  - `rule` TR-8.1: `npm run build` exit 0 + Hash valido.
  - `rule` TR-8.2: GetDiagnostics 0 errori gravi (TypeScript/HTML/eslint severità >= Warning). Info cSpell ammesse.
- **Notes**: Non creare file README.md esterni (vincolo regola); istruzioni solo commenti nei file di config e/o testuale nella sezione Integrazioni quando `state === 'not_configured'`.

---

## Copertura Acceptance Criteria (Spec → Tasks)
| AC | Task Principale | Note |
|---|---|---|
| AC-1 (Connessione/Disconnessione) | T1, T3, T4 | Setup + Servizio + UI |
| AC-2 (Selezione calendario) | T3, T4 | fetchCalendarList + salva setting |
| AC-3 (Push C/UD app→Google) | T2, T3, T5 | updatedAt/googleEventId + servizio + hook |
| AC-4 (Import Google→app) | T2, T3, T6 | mapping + LWW |
| AC-5 (LWW Conflitti) | T6 | confronto timestamp |
| AC-6 (Solo campi base) | T3, T6 | mapping esclusivo e isolamento extra |
| AC-7 (Errori/token) | T3, T7 | catch + stato expired + banner |
| AC-8 (Build/Diag) | T8 | npm build + GetDiagnostics |
| AC-9 (Qualità UX Integrazioni) | T4 | Rubrica UI |
| AC-10 (Robustezza + retrocompatibilità) | T2, T5, T7 | Migrazione eventi storici; Supabase sync non influenzato |
