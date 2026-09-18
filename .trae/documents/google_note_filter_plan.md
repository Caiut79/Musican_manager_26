# Piano: Riorganizza sezione Google + Filtri Note Google con Anteprima Live

## 🎯 Richiesta utente (VERBATIM)
1. **Aggiungere checkbox filtri per campo Note evento Google**: decidere cosa includere nel description (Compenso, Acconto, Band, Teatro, Indirizzo, Note libere, ecc.) **+ anteprima LIVE** di come viene scritto su Google.
2. **Riorganizzare TUTTA la sezione Google in blocchi ordinati** per non avere un casino: sezione dedicata Connessione/Credenziali, sezione Sincronizzazione, sezione Note.

## 📚 Ricerca repository (stato attuale)

### A) Architettura Note Google corrente (google-calendar.service.ts)
```
L1395 → _toGoogleEvent(local)  :  AL MOMENTO mette SOLO local.notes in description (L1406)
                                  location = venue + address (L1402, SEMPRE, nessun filtro)
```
=> **Nessun controllo utente**: in description finiscono **solo** le note libere (eventuali). Compenso, netFee, band, status, ecc. NON CI SONO MAI su Google.

### B) Formato evento (event-detail.ts)
Campi disponibili: `title,date,timeStart,timeEnd,venue,address,type,band[],grossFee,netFee,compensoType?,notes?,status`  
= 10 campi informativi totali da poter includere/escludere.

### C) GcalSettings type (local-storage.service.ts L15)
11 campi attuali (calendarId, report, clientId, token, email, syncStartDate).  
=> **MANCA `noteFormat`** (flag 10 checkbox booleani).

### D) UI attuale (google-integration.component html 681 righe / ts 691 righe / scss 1513 righe)
Blocchi accatastati VERTICALMENTE in quest'ordine (senza logica):
```
Stato Connessione → Tendina calendari → Impostazioni Generiche (ClientID) →
 → Filtro cutoff → Strumenti (Sincronizza button) → Wipe → Deduplica Locale →
 → Deduplica Remoto → Reset
```
=> **Nessuna separazione visiva a gruppi**.

---

## 📂 Files da modificare (3 files)

| File | Cosa modifico |
|------|--------------|
| `src/app/core/local-storage.service.ts` | **Estendo type GcalSettings** con `noteFormat?: GoogleNoteFormat` (11 checkbox) |
| `src/app/core/google-calendar.service.ts` | Aggiungo metodo **`public buildGoogleDescriptionFromFormat(event, format)`** + aggiorno `_toGoogleEvent` per usarlo invece di `local.notes` singolo |
| `src/app/shared/google-integration/google-integration.component.ts` | (a) aggiungo reactive form noteFormat 11 checkbox + anteprima sampleEvent | (b) helper saveNoteFormatToLs | (c) riorganizzo le variabili di stato in gruppi |
| `src/app/shared/google-integration/google-integration.component.html` | **Sostituisco tutti i blocchi separati in 3 SEZIONI VISIVE con intestazioni e divisori**: <br>1️⃣ 📡 Connessione & Calendario <br>2️⃣ 🔄 Sincronizzazione & Manutenzione <br>3️⃣ 📝 Formato Note Google (11 checkbox + anteprima live card) |
| `src/app/shared/google-integration/google-integration.component.scss` | Classi: `.gcal-section-group` (intestazione colore) / `.gcal-section-title` / `.gcal-note-grid` (2 colonne checkbox) / `.gcal-note-preview` (card bianca stile nota Google) / `.gcal-note-preview-title`, `.gcal-note-preview-body` / tema scuro / responsive mobile < 820 |

---

## 🔨 Step implementazione (ordine dipendenze)

### Step 1 → DATA MODEL
- [**local-storage.service.ts** L15] Estendo `GcalSettings`:
  ```ts
  noteFormat?: GoogleNoteFormat;
  ```
- [**google-calendar.service.ts** top] Creo interface pubblica:
  ```ts
  export interface GoogleNoteFormat {
    includeVenue: boolean;       // Teatro/Locale
    includeAddress: boolean;     // Indirizzo
    includeBand: boolean;        // Musicisti (band)
    includeType: boolean;        // Tipo (Concerto/Lezione/DJ)
    includeStatus: boolean;      // Stato (Confermato/In attesa/Cancellato)
    includeGrossFee: boolean;    // Compenso Lordo (€)
    includeNetFee: boolean;      // Compenso Netto (€)
    includeCompensoType: boolean;// Fuori fattura / In fattura
    includeTimes: boolean;       // Orari (Ora inizio/fine)
    includeNotes: boolean;       // Note libere (appendi in fondo)
    includeAppFooter: boolean;   // 🎵 Musicista Manager · ID evento (footer)
  }
  // Default = oggetto con TUTTI TRUE (tranne AppFooter=default false)
  export const DEFAULT_NOTE_FORMAT: GoogleNoteFormat = {...};
  ```

### Step 2 → LOGICA SERVICE buildGoogleDescription
- [**google-calendar.service.ts**] Metodo **pubblico** `resolveNoteFormatOrDefault(settings?)` che legge patchGcalSettings se salvato, altrimenti default.
- [**google-calendar.service.ts**] Metodo **pubblico** `buildGoogleDescriptionFromFormat(event: EventDetail, fmt: GoogleNoteFormat): string` → ritorna stringa formattata con sezioni e emoji tipo:
  ```
  📅 Venerdì 18 Settembre 2026 · 21:00 → 23:30
  🎭 Teatro Reggio Emilia
  📍 Via Roma 12, 42121 RE
  🎶 Tipo: Concerto · Stato: ✅ Confermato
  👥 Band: Claudio (Chitarra), Luca (Batteria)
  💰 Compenso Lordo: 500 € · Netto: 420 €
     Tipo compenso: 🍀 Fuori fattura
  📝 Note libere dell'evento...

  🎵 Musicista Manager · evento #abc123
  ```
- Modifico `_toGoogleEvent(local)` L1406:
  ```ts
  payload['description'] = this.buildGoogleDescriptionFromFormat(local, this.resolveNoteFormatOrDefault());
  // (se description risultante è vuota, non metto description proprio)
  ```

### Step 3 → UI TS (checkbox + anteprima)
- Aggiungo `defaultNoteFormat = DEFAULT_NOTE_FORMAT` (dall'import del service)
- Campi: `noteFormat!: GoogleNoteFormat`, `previewSampleEvent: EventDetail` (hardcoded con dati verosimili per l'anteprima tipo Concerto 200€ netto 21:00)
- `ngOnInit`: carico `noteFormat = getGcalSettings().noteFormat ?? defaultNoteFormat`
- Metodo `onNoteCheckboxToggle(key: keyof GoogleNoteFormat)` = flippa booleano + chiama `saveNoteFormat()` 
- Metodo `saveNoteFormat()` → `patchGcalSettings({ noteFormat: this.noteFormat })` + trigger anteprima aggiornata
- Getter `notePreviewHtml`: calcola `googleCalendarService.buildGoogleDescriptionFromFormat(previewSampleEvent, noteFormat)` (converto `\n` in `<br>` per visualizzare HTML)

### Step 4 → UI HTML: RIORGANIZZAZIONE A 3 GRUPPI + NUOVA SEZIONE NOTE
Avvolgo tutti i blocchi esistenti in 3 sezioni `.gcal-section-group` ordinate logicamente:

```
┌─ 1️⃣ 📡 SEZIONE: Connessione & Credenziali ──────────────────────┐
│  - Badge Stato (Connesso / Non connesso + email)
│  - Pulsante Connetti / Disconnetti Google
│  - Client ID OAuth + salva
│  - Tendina Calendario da usare + Ricarica lista
└──────────────────────────────────────────────────────────────────┘

┌─ 2️⃣ 🔄 SEZIONE: Sincronizzazione & Manutenzione ────────────────┐
│  - 🎚️ Filtro "Sincronizza da" + Applica / 📍 Oggi
│  - Pulsanti Azione: 🔄 Sincronizza Google Calendar
│  - Blocco 🧹 Pulisci Passato
│  - Blocco 🔵 Deduplica Locale
│  - Blocco 🔴 Deduplica Google Remoto
│  - Blocco 🚨 Reset Completo
└──────────────────────────────────────────────────────────────────┘

┌─ 3️⃣ 📝 SEZIONE: Formato Note Google Calendar (ANTECONPRIMA LIVE)┐
│  Titolo sezione + microcopy "Seleziona cosa includere nelle note
│  di Google. Ogni evento creato/modificato userà questo formato."
│  
│  GRIGLIA 2 COLONNE (checkbox 46px):
│  ☑️ Teatro / Locale       ☑️ Indirizzo
│  ☑️ Orari inizio/fine     ☑️ Tipo evento
│  ☑️ Stato evento          ☑️ Musicisti (Band)
│  ☑️ Compenso Lordo        ☑️ Compenso Netto
│  ☑️ Tipo compenso         ☑️ Note libere evento
│  ☑️ Footer "Musicista Manager"
│  
│  CARD ANTEPRIMA LIVE (stile nota Google grigio chiaro):
│  ┌──────────────────────────────────────┐
│  │ 📝 Anteprima Nota Google (esempio)   │
│  ├──────────────────────────────────────┤
│  │ 📅 Venerdì 18 Set 2026 · 21:00-23:30 │
│  │ 🎭 Teatro Verdi                      │
│  │ 📍 Via Roma 12, Milano               │
│  │ 🎶 Concerto · ✅ Confermato           │
│  │ 👥 Band: Claudio (Chitarra)          │
│  │ 💰 Netto: 200 € 🍀 Fuori fattura     │
│  │ 📝 Note: Ricordati le provette       │
│  │                                      │
│  │ 🎵 Musicista Manager                 │
│  └──────────────────────────────────────┘
└──────────────────────────────────────────────────────────────────┘
```

### Step 5 → UI SCSS
- `.gcal-section-group` padding top 4px, margin bottom 28px, separator top border gradient
- `.gcal-section-title` 17px bold + icona emoji o SVG (colore primario verde)
- `.gcal-note-grid` 2 colonne responsive, ogni riga checkbox + label (label 13px clickable)
- `.gcal-note-preview` card stile Google: bg #f6f7f9, border radius 12px, font-family monospace/roboto, padding 14px, whitespace-pre-line
- `.gcal-note-preview-title` grigio 12px label
- `.gcal-note-preview-body` 13.5px line-height 1.65
- `@media (prefers-color-scheme: dark)` varianti
- `@media (max-width: 820px)` griglia note 1 colonna (stack), gruppi meno padding

### Step 6 → Build + Diagnostica + Push
- `npm run build` → exit 0, hash + ~358 KB
- `GetDiagnostics` → 0 errori
- `git add/commit/push origin main`

---

## 🧩 Dipendenze & Considerazioni
1. **Backward compat**: Se `GcalSettings.noteFormat` è undefined → usiamo `DEFAULT_NOTE_FORMAT` (tutti true tranne footer). Nessun breaking per utenti esistenti pre-aggiornamento.
2. **Il campo `location` Google rimane SEMPRE venue + address** (è un campo separato in Google Calendar, utile per mappe GMaps integrate). I checkbox controllano **solo il campo description/note**, non il campo `location`. Se in futuro vuole nascondere anche location, si aggiunge un checkbox separato (per adesso escluso).
3. **Anteprima evento**: hardcoded con dati tipo "Concerto al Verdi Milano Claudio Chitarra". Non legge i dati del musicista, serve solo per mostrare il formato.
4. **Sync uscenti già esistenti**: il prossimo `syncOutgoingDelta` che aggiorna un evento, rigenera la description (quindi le note di Google verranno aggiornate al nuovo formato ✅).

---

## ✅ Validazione
- localhost:4200/F5 → Profilo → sezione Google:
  - ✅ 3 gruppi visibili separati da bordi e titoli colorati (nessun "mucchio")
  - ✅ 11 checkbox cliccabili (cambio istantaneo dell'anteprima a destra/sotto)
  - ✅ Svuota tutti i checkbox → scompaiono le righe in anteprima, ritorna stringa vuota (nessuna description su Google)
  - ✅ Modifico i checkbox → F5 ricarica → stato checkbox ricorda (salvato in LS GcalSettings.noteFormat)
  - ✅ Creo nuovo evento da App → `_toGoogleEvent` genera la description esatta come l'anteprima
  - ✅ Tema scuro: tutti i colori dei gruppi e della preview si invertono
  - ✅ Mobile 375px: gruppi 1 colonna, checkbox 1 colonna, preview larghezza

---

## ⚠️ Rischi & gestione
- **Rischio: campi zeri/undefined in Compenso**: → `buildGoogleDescriptionFromFormat` salta le righe se `grossFee/netFee === 0` (non mettere "0 €")
- **Rischio: array band vuoto**: → salta riga "👥 Nessun musicista" (solo se band.length>0)
- **Rischio: note vuote**: → salta riga 📝 se `!local.notes?.trim()`
- **Rischio: Google limita description a ~100KB**: → formato già leggero testo, 300 byte max mediamente per evento, impossibile superare limiti
- **Rischio: Dati privati (Compenso) finiscono per sbaglio in un calendario condiviso**: → la checkbox default **includeNetFee=true** ma microcopy avvisa "⚠️ Se condividi il calendario con altri, disattiva Compenso Netto per privacy"
