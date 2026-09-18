# Integrazione Google Calendar Bidirezionale — Product Requirements Document (Spec)

## Overview
- **Summary**: Integrazione bidirezionale tra il gestore eventi di Musican Manager e Google Calendar personale dell'utente. Push automatico degli eventi creati/modificati/cancellati sull'app → Google; import manuale su richiesta degli eventi creati su Google → app.
- **Purpose**: Evitare la doppia registrazione manuale degli eventi. L'utente può creare un evento nel sistema che preferisce e ritrovarlo nell'altro.
- **Target Users**: Musicisti, insegnanti e DJ che usano Google Calendar come agenda personale/lavorativa oltre a Musican Manager.

## Goals
- Gli eventi creati/modificati/cancellati su Musican Manager vengono riflessi immediatamente sul calendario Google prescelto.
- Un pulsante "Sincronizza da Google Calendar" importa tutti gli eventi nuovi o modificati sul calendario Google dentro Musican Manager.
- L'utente sceglie su quale calendario Google sincronizzare (da un elenco dei suoi calendari).
- In caso di modifiche doppie sullo stesso evento, vince la versione più recente per timestamp (`updatedAt`) senza richiedere intervento.
- Stato della connessione sempre visibile (connesso / non connesso / scaduto) con possibilità di disconnettersi.

## Non-Goals
- ❌ Sincronizzazione real-time Google → app (Push Notifications / Webhook via Google Calendar Channels).
- ❌ Polling automatico periodico in background; l'import da Google è **sempre** su iniziativa utente.
- ❌ Sincronizzazione campi specifici Musican Manager (`type`, `grossFee`, `netFee`, `status`, `band`, `compensoType`). Questi campi **non** vengono scritti su Google né letti da Google.
- ❌ Multi-account Google: un solo account Google collegabile alla volta.
- ❌ Login Google a Musican Manager: autenticazione all'app resta quella esistente (Supabase / locale); Google Calendar è una connessione separata.

## Background & Context
- **Architettura corrente**: App Angular 17 SPA, deploy Vercel (statico), storage `localStorage` chiave `mm_events` con sync Supabase opzionale. Nessun backend Node custom.
- **Modello EventDetail** ([event-detail.ts](file:///Users/claudio/Documents/trae_projects/musican_manager_26/src/app/models/event-detail.ts)): `id, title, date, timeStart, timeEnd?, venue, address, type, band, grossFee, netFee, status, createdAt`. Mancano `updatedAt` e `googleEventId` → verranno aggiunti.
- **Pattern scrittura eventi**: 12 file nel progetto scrivono `mm_events` (agenda, dashboard, teaching, concerts, events, expenses, accounting, contract-view, booking-request, communication, reports, history). Qualsiasi creazione/modifica/cancellazione evento DEVE passare per un servizio centralizzato (o hook) che triggera anche il push su GCal.
- **SupabaseService esistente** ([supabase.service.ts](file:///Users/claudio/Documents/trae_projects/musican_manager_26/src/app/core/supabase.service.ts)) già gestisce sync locale ↔ remoto; il nuovo servizio Google Calendar si affiancherà allo stesso pattern.

## Scelte Progettuali Confermate con Utente
1. **OAuth Setup**: Io preparo il codice, i placeholders e le istruzioni; utente crea in seguito il progetto Google Cloud Console e inserisce il Client ID.
2. **Strategia Sync**: **A — Push automatico app→Google + Import manuale Google→app** (consigliata, non richiede backend con webhook).
3. **Conflitti**: **Last-Write-Wins** basato sul campo `updatedAt` (locale) / `updated` (Google).
4. **Calendario target**: **Selezione da elenco** dei calendari Google dell'utente; scelta salvata e riutilizzata.
5. **Campi sincronizzati**: **Solo campi base** (`title`, date+orari, venue+address, notes). Campi app-specifici rimangono confinati a Musican Manager.

## Mapping Campi Base (App ↔ Google)
| Musican Manager EventDetail | Google Calendar Event (`calendar/v3/events`) | Note |
|---|---|---|
| `title` | `summary` | |
| `date` + `timeStart` | `start.dateTime` (ISO 8601 with timezone) | Es. `2026-09-17T21:00:00+02:00`; timezone locale browser. |
| `date` + `timeEnd` (se presente) | `end.dateTime` | Se `timeEnd` è assente → default `start + 1 ora`. |
| `venue` + `address` | `location` | Concatenati: `"${venue}, ${address}"` se entrambi presenti. |
| `notes` | `description` | |
| **nuovo** `googleEventId` | `id` | ID univoco restituito da Google dopo insert; usato per update/delete. |
| **nuovo** `updatedAt` | `updated` | Timestamp ISO di ultima modifica; usato per LWW. |

Quando un evento Google viene importato per la prima volta e non ha corrispettivo locale:
- `type` → default `'other'`
- `status` → default `'confirmed'`
- `grossFee`, `netFee` → `0`
- `band` → `[]`
- `venue` e `address` → separati dalla `location` di Google se contiene una virgola, altrimenti tutto in `venue`.

## Functional Requirements
- **FR-1**: Un servizio `GoogleCalendarService` centralizzato gestisce OAuth, stato connessione, CRUD su Google Calendar e import.
- **FR-2**: Schermata/matching sezione (es. sidebar "Integrazioni" o pagina Impostazioni) con pulsante "Connetti Google Calendar", "Disconnetti", stato visuale, errore/scadenza token.
- **FR-3**: Subito dopo la prima connessione OAuth, l'utente vede una lista dei suoi calendari Google con nome e descrizione e seleziona quello di destinazione. La scelta viene salvata.
- **FR-4**: Dopo la selezione, l'utente può in ogni momento cambiare calendario target.
- **FR-5**: Ogni qualvolta un evento viene creato su Musican Manager (in qualsiasi sezione: agenda, dashboard, teaching, concerts, events...), **dopo** il salvataggio su `localStorage`, viene anche inserito su Google Calendar in background.
- **FR-6**: Ogni qualvolta un evento viene modificato su Musican Manager, **se** ha un `googleEventId`, viene anche aggiornato su Google Calendar.
- **FR-7**: Ogni qualvolta un evento viene cancellato su Musican Manager, **se** ha un `googleEventId`, viene anche rimosso da Google Calendar.
- **FR-8**: Pulsante visibile "Sincronizza da Google Calendar" (es. nell'header dell'Agenda e/o in Impostazioni Integrazioni). Al click:
  1. Scarica gli eventi del calendario prescelto a partire da `syncMinDate` (es. oggi - 3 mesi, oppure data ultima sync salvata).
  2. Per ogni evento Google:
     - Se non esiste binding locale con `googleEventId`: crea nuovo evento locale con campi base e default per extra.
     - Se esiste binding: confronta `updated` Google vs `updatedAt` locale. Se Google è più recente → sovrascrivi campi base locali (MAI i campi extra).
     - Se locale è più recente → non sovrascrivere, ma fai push della versione locale a Google prossimo ciclo (o subito se l'utente ha appena modificato).
  3. Al termine mostra un report: `X nuovi eventi importati · Y aggiornati · Z saltati`.
- **FR-9**: Risoluzione conflitti Last-Write-Wins come definito sopra; nessuna comparazione di campi extra.
- **FR-10**: Pulsante "Disconnetti Google Calendar" revoca lo stato locale (access token, calendario scelto) e opzionalmente lascia un flag `googleEventId` vuoto ma non tocca i record già salvati (l'utente può ricollegarsi in futuro e ri-bindare).
- **FR-11**: Se una chiamata Google Calendar restituisce 401 Unauthorized → il servizio marca lo stato come `expired` e mostra un banner "Riconnetti Google Calendar" per rieseguire l'OAuth.
- **FR-12**: Prima che l'utente abbia collegato GCal e selezionato un calendario, le operazioni di push non vengono tentate (nessun errore in console).

## Non-Functional Requirements
- **NFR-1**: Il push verso Google Calendar è asincrono e non-blocking per l'utente; se fallisce, l'azione locale non viene rollbackata e l'utente vede un avviso non bloccante ("Salvato localmente; sync Google fallita, ritenta").
- **NFR-2**: Nessun segreto (client secret, refresh token) è memorizzato nel client SPA; flusso OAuth 2.0 Authorization Code + PKCE esclusivamente.
- **NFR-3**: Le chiamate Google Calendar API usano `fetch` nativo con header `Authorization: Bearer <access_token>`; nessuna dipendenza aggiuntiva (@googleapis/calendar non è compatibile con SPA browser).
- **NFR-4**: Load dello script Google Identity Services (`https://accounts.google.com/gsi/client`) solo dopo click utente (lazy). Non viene caricato a bootstrap per evitare rallentamenti.
- **NFR-5**: Il nuovo servizio `GoogleCalendarService` è fornito tramite DI Angular e wrapper per tutti i catch con messaggi espliciti.
- **NFR-6**: Build Angular `npm run build` resta PASS; nessun warning gravo; GetDiagnostics 0 errori gravi.

## Constraints
- **Technical**:
  - SPA Angular 17; non possiamo memorizzare `client_secret` o `refresh_token` in modo sicuro lato client. Il token di accesso (`access_token`) ha durata ~1h; se l'utente esce dalla pagina e torna dopo >1h deve rieseguire l'OAuth.
  - Google Calendar API richiede scope `https://www.googleapis.com/auth/calendar.events` (read/write sugli eventi del calendario scelto).
  - Client ID OAuth 2.0 deve essere creato su console.cloud.google.com con tipo "Applicazione Web" e URI di reindirizzamento autorizzati: `http://localhost:4200` per sviluppo + dominio di produzione Vercel.
- **Business**:
  - Campi app-specifici (tariffe, tipo evento, componenti band, stato contratto) **non** devono mai fuoriuscire su Google per scelta utente.
- **Dependencies**:
  - Nuova dipendenza npm: `@types/google.accounts` (solo types, non runtime) per typings di Google Identity Services. Aggiunta a `devDependencies`.

## Assumptions
- L'utente ha già un account Google personale o workspace.
- L'utente riuscirà, seguendo le istruzioni, a creare il progetto Google Cloud e inserire il Client ID in `assets/google.config.json` (o file environment).
- L'utente accetta che senza webhook l'import di eventi creati su Google non è automatico e richiede click sul pulsante Sincronizza.

## Acceptance Criteria

### AC-1: Connessione e disconnessione Google Calendar funzionanti
- **Type**: `rule`
- **Given**: L'utente ha un Client ID OAuth valido configurato
- **When**: Clicca "Connetti Google Calendar", completa il flusso OAuth 2.0, dà i permessi
- **Then**:
  1. Lo stato passa a "Connesso" e viene mostrato l'email dell'account Google
  2. `isConnected === true` e `accessToken` con scadenza salvati nello stato
  3. Prossima azione crea evento → push effettivamente su GCal (verifica via test manuale o mock API)
- **Pass Condition**: Dopo il login, un `GET https://www.googleapis.com/calendar/v3/users/me/calendarList` con il token restituisce 200 e una lista non vuota
- **Evidence**: Screenshot UI stato connesso + log Network tab 200 per calendarList

### AC-2: Selezione e cambio calendario Google
- **Type**: `rule`
- **Given**: Utente autenticato Google
- **When**: Viene mostrata la lista calendarList e seleziona un calendario diverso da primary
- **Then**:
  1. Il nome del calendario selezionato viene mostrato in UI come "Calendario di destinazione: X"
  2. Il prossimo evento creato viene inserito sul calendario selezionato (non primary)
- **Pass Condition**: Verificare l'evento creato su Google Calendar UI; compare nel calendario scelto
- **Evidence**: Screenshot Google Calendar con l'evento nel calendario corretto

### AC-3: Push automatico app→Google (crea, aggiorna, cancella)
- **Type**: `rule`
- **Given**: Utente connesso e calendario selezionato
- **When**:
  1. Crea evento "Concerto al Blue Note" in Agenda o Dashboard
  2. Modifica titolo in "Concerto al Blue Note — Sold Out"
  3. Cancella evento
- **Then**:
  - Dopo (1): evento compare su Google con i dati corretti; `googleEventId` salvato sull'evento locale
  - Dopo (2): evento su Google ha il nuovo titolo
  - Dopo (3): evento scompare da Google
- **Pass Condition**: Tre azioni → tre corrispondenze esatte visibili in Google Calendar UI
- **Evidence**: Network tab: POST (200), PUT (200), DELETE (204); screenshot prima/dopo UI Google

### AC-4: Import manuale Google→app con pulsante Sincronizza
- **Type**: `rule`
- **Given**: Utente connesso e calendario selezionato
- **When**:
  1. Crea manualmente un evento "Prova Google" sul calendario Google dal browser
  2. Torna sull'app Agenda e clicca "Sincronizza da Google Calendar"
- **Then**:
  1. "Prova Google" compare nella lista eventi dell'app con `type = 'other'`, `status = 'confirmed'`, `fee=0`
  2. `googleEventId` è popolato e `updatedAt` corrisponde al `updated` di Google
- **Pass Condition**: L'evento importato è visibile nell'elenco Agenda con dati coerenti
- **Evidence**: Screenshot Agenda lista dopo sync

### AC-5: Risoluzione conflitto Last-Write-Wins
- **Type**: `rule`
- **Given**: Un evento esiste sia in locale (L) che su Google (G), stesso `googleEventId`
- **When**:
  Caso A: Modifico localmente il titolo (L.updatedAt > G.updated) → clicco Sincronizza
  Caso B: Modifico titolo su Google (G.updated > L.updatedAt) → clicco Sincronizza
- **Then**:
  - Caso A: versione locale vincente → Google viene aggiornato (o resta uguale perché la app non pusha in import; la modifica locale va in push al momento del save). Import da Google NON sovrascrive locale se è più vecchio.
  - Caso B: versione Google vincente → locale vede il titolo aggiornato dopo Sincronizza
- **Pass Condition**: Entrambi i casi producono il risultato atteso
- **Evidence**: Tabella di log con timestamp L.updatedAt, G.updated, risultato finale per entrambi i casi

### AC-6: Solo campi base vengono sincronizzati (campi extra invariati sull'app)
- **Type**: `rule`
- **Given**: Evento locale con `type='concert'`, `grossFee=500`, `status='pending'`, `band=[{name:'Piero', instrument:'Batteria'}]`
- **When**: Eseguo un import sincronizzazione che aggiorna quel evento perché la versione Google è più recente
- **Then**: `type`, `grossFee`, `status`, `band` dell'evento locale **non sono cambiati**; solo `title`, date/ore, location, notes sono stati eventualmente aggiornati.
- **Pass Condition**: Confronto oggetto evento prima/dopo import: campi extra identici, campi base aggiornati
- **Evidence**: Snapshot console.dir(JSON.stringify(eventBefore)) vs JSON.stringify(eventAfter))

### AC-7: Gestione errori di rete e token scaduto (nessun crash, UI chiara)
- **Type**: `rule`
- **Given**: App connessa a GCal; si simula token scaduto (o si cancella `accessToken` manualmente in memoria)
- **When**: Provo a creare un evento o a sincronizzare
- **Then**:
  - Nessun crash, nessun errore in console bloccante
  - Messaggio non bloccante a UI: "Sessione Google scaduta. Clicca qui per riconnetterti"
- **Pass Condition**: Nessun errore TypeScript runtime; banner visibile con CTA per riconnettersi
- **Evidence**: Console browser vuota di errori; screenshot UI banner

### AC-8: Build e diagnostiche pulite
- **Type**: `rule`
- **Given**: Codice implementato
- **When**: Eseguo `npm run build` e GetDiagnostics
- **Then**:
  1. `npm run build` → exit code 0, Hash valido, bundle main.js < 1.8 MB
  2. GetDiagnostics → 0 errori gravi (severità >= warning di TS/HTML; info cSpell per parole italiane accettate)
- **Pass Condition**: Entrambe le condizioni vere
- **Evidence**: Output terminale build PASS + screenshot GetDiagnostics 0 errori gravi

### AC-9: Qualità UX del flusso OAuth e stato connessione
- **Type**: `rubric`
- **Dimension**: Chiarezza e accessibilità della sezione Integrazioni Google Calendar
- **Scale**: 1-5
- **Anchors**:
  1 = Flusso confuso, stati non visibili, nessun feedback
  3 = Base funzionante, pulsanti presenti ma mancano indicazioni email account / data scadenza token
  5 = UI chiara: badge colore + label stato (Non connesso / Connesso come mario@... / Scaduto), pulsanti azione ben distinti, istruzioni per Client ID se non configurato
- **Pass Threshold**: ≥ 4
- **Evidence**: Screenshot sezione Integrazioni con tooltip / help testuali

### AC-10: Robustezza errori e retrocompatibilità
- **Type**: `rubric`
- **Dimension**: Robustezza del servizio e non-regressione sulle sezioni esistenti
- **Scale**: 1-5
- **Anchors**:
  1 = Errori non gestiti, crash, eventi vecchi migrati male
  3 = Gestione base catch; eventi creati prima dell'integrazione non hanno `updatedAt`, default a `createdAt` è accettabile ma non documentato
  5 = Tutte le chiamate a Google Calendar hanno try/catch con log dettagliato; migrazione automatica eventi pre-esistenti (imposta `updatedAt = createdAt ?? new Date().toISOString()` se mancante); codice non entra in conflitto con Supabase sync esistente
- **Pass Threshold**: ≥ 4
- **Evidence**: Analisi statica catch/try + ispezione codice hook scrittura eventi nelle 12 sezioni esistenti

## Open Questions
- [x] OAuth Client ID: fornito successivamente da utente dopo setup Google Cloud Console
- [x] Strategia sync: push automatico + import manuale
- [x] Conflitti: LWW
- [x] Calendario target: selezionale da elenco
- [x] Campi: solo base
- [ ] (bassa) Messaggio push-sync-failed: toast o banner? Default: toast non bloccante.
