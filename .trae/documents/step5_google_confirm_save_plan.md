# Piano: Step 5 Google Calendar + Pattern Modifica/Salva/Annulla Sezione Google

## 📋 Richiesta utente (VERBATIM + approvazione domande)
1. **SPOSTARE Google Calendar dentro la stepper MusicianForm come STEP 5** tra ENPALS & Fiscale (step 4) e Colori agenda (step 6). Quindi:
   - **Sequenza definitiva 6 step** = 1. Anagrafica · 2. Profilo musicale · 3. Social · 4. ENPALS & Fiscale · **5. 📅 Google Calendar** · **6. Colori agenda**
   - La card `<app-google-integration>` **attualmente FUORI dal form in fondo viene RIMOSSA** (non duplicata).
   
2. **PATTERN MODIFICA / SALVA / ANNULLA su TUTTA la sezione Google Calendar**:
   - Di **DEFAULT** tutti i campi Google sono **NON modificabili** (sola lettura / disabled).
   - Compare un pulsante **🔓 MODIFICA** verde.
   - Quando Claudio clicca MODIFICA → (A) facciamo SNAPSHOT di tutti i valori correnti (backup locale), (B) sblocchiamo campi, (C) compaiono i pulsanti **✅ SALVA** verde e **↩️ ANNULLA** grigio.
   - ✅ SALVA → scriviamo TUTTO in LS in UN COLPO SOLO + messaggio verde conferma + torniamo in modalità sola lettura.
   - ↩️ ANNULLA → **TUTTI i campi tornano ESATTAMENTE ai valori dello snapshot (nessuna modifica salvata)** + torniamo in sola lettura.
   
3. **Campi Google che rientrano nel pattern** (risposta Claudio):
   - Client ID OAuth
   - Tendina "Calendario da usare" (oggi salva istantaneo al cambio)
   - 🎚️ Cutoff "Sincronizza da:" input data + pulsanti
   - 11 Checkbox formato Note Google (oggi salva istantaneo ad ogni spunta)
   - Quick action note "Disattiva tutto / Ripristina consigliati"
   - Quick action cutoff "📍 Oggi"
   - Quick action tendina "🔄 Ricarica lista calendari"

## ❗ Conferma su altre sezioni (Anagrafica, ENPALS, Colori):
L'utente ha specificato *"Un po' su tutte le sezioni dove c'è un salva"*. La form MusicianForm (step 1-4 + step 6 colori) HA già un pulsante **"Salva profilo" GLOBALE** + validazione: per non invasare troppo il flusso, in questo piano **applichiamo il pattern Modifica/Salva/Annulla ESCLUSIVAMENTE alla sezione Google Calendar** (che è una card embedded e storicamente aveva salvataggi istantanei diversi). Se in futuro Claudio vuole lo stesso pattern anche su ENPALS o Colori, lo facciamo separatamente.

---

## 📂 Files da modificare

| File | Cosa modifico |
|------|--------------|
| `src/app/features/musician-form/musician-form.component.ts` | **`steps` array**: da 5 a 6 elementi (aggiungi `'Google Calendar'` come posizione 4 zero-based → 'Colori agenda' slitta a index 5) |
| `src/app/features/musician-form/musician-form.component.html` | **(1)** Rimuovi `<app-google-integration>` FUORI dal form in basso (riga 653). **(2)** Aggiungi `<section *ngIf="currentStep === 4">` = nuovo pannello Google Calendar con `<app-google-integration>` DENTRO. **(3)** Aggiorna il commento del pannello Colori: prima Step 4 → Step 5 (`*ngIf="currentStep === 5"`). **(4)** Testo "5. Colori agenda" → cambia in "6. Colori agenda" ovunque appaia (label). |
| `src/app/shared/google-integration/google-integration.component.ts` | **Big one**: implementa `editingMode = false`, `_googleDraftSnapshot: Record<string, any>` snapshot, 4 nuovi metodi `onStartEditGoogle()` / `onSaveAllGoogle()` / `onCancelEditGoogle()` / `_restoreFromSnapshot()`. RIMUOVI: salvataggi istantanei da toggle checkbox / cutoff / tendina calendario. Il service `gcal` rimane invariato. **Tutti i draft**: `clientIdDraft`, `syncStartDateDraft`, `selectedCalendarDraftId`, `selectedCalendarDraftSummary`, `noteFormatDraft`, ecc. Ora quando modifichi, scrivi sul DRAFT e NON su LS. |
| `src/app/shared/google-integration/google-integration.component.html` | Aggiungi header pulsante top-right: MODIFICA (se modalità sola lettura) / SALVA · ANNULLA (se editing). Aggiungi attributi `[disabled]="!editingMode"` su **TUTTI** gli input del Gruppo 1 e 3 (Client ID, tendina calendari, data cutoff, 11 checkbox note, quick actions "Oggi" "Disattiva tutto" "Ripristina consigliati"). `[ngModel]` invece di binding diretto usa `[(ngModel)]="noteFormatDraft[f.key]"` ecc. |
| `src/app/shared/google-integration/google-integration.component.scss` | (Facoltativo se serve) stile per `.gcal-editing-mode` (sfondo sfocato o bordo verde chiaro attorno alla sezione quando si sta modificando). Classe `.gcal-top-right-actions` per i 3 pulsanti header. |

---

## 🔨 Step implementazione (ordine dipendenze)

### Step 1: MusicianForm riordina step
- TS: `steps = ['Anagrafica', 'Profilo musicale', 'Social', 'ENPALS & Fiscale', 'Google Calendar', 'Colori agenda']`
- HTML: Inserisci pannello `*ngIf="currentStep === 4"` per Google (con `<app-google-integration>` dentro).
- HTML: Sposta pannello Colori da `*ngIf="currentStep === 4"` → `*ngIf="currentStep === 5"`.
- HTML: Rimuovi `<app-google-integration></app-google-integration>` in fondo al file fuori dal form.

### Step 2: Google Component → stato Editing + Draft snapshot
Variabili di stato (sostituiscono i valori diretti usati adesso per gli input):
- `editingMode = false`
- `_snapshotKey = 'draft_snapshot_google_not_used_ls'` (non salviamo niente!)
- Booleano `isDirtyDraft = false` (se true, bottone "Annulla" avvisa "Le modifiche andranno perse")
- Oggetti draft:
  ```ts
  draft: {
    clientId: string;
    syncStartDate: string;
    selectedCalendarId: string;
    selectedCalendarSummary: string;
    noteFormat: GoogleNoteFormat;
  };
  ```
- **ngOnInit**: `_resetDraftFromLive()` = popola `draft.*` dai valori LIVE salvati LS (stato iniziale)
- `onStartEditGoogle()`:
  - Backup snapshot clone deep `_googleSnapshot = structuredClone(this.draft)`
  - `editingMode = true`
  - `isDirtyDraft = false`
- `onSaveAllGoogle()`:
  - Salva TUTTO in **un unico colpo**:
    - `gcal.saveClientId(draft.clientId)`
    - `gcal.setSyncStartDate(draft.syncStartDate)`
    - patchGcalSettings selectedCalendarId / Summary (se esistono)
    - patchGcalSettings noteFormat
  - Messaggio report verde tipo ✅ "9 preferenze Google salvate. 26 modifiche applicate."
  - `editingMode = false; isDirtyDraft = false;`
  - Aggiorna valori LIVE UI (display, status, ecc.)
- `onCancelEditGoogle()`:
  - 1️⃣ Se isDirtyDraft = true → confirm popup "⚠️ Ci sono modifiche non salvate, le annullo veramente?"
  - 2️⃣ `structuredClone restore draft = _googleSnapshot` → **tutto torna come PRIMA di MODIFICA**
  - `editingMode = false; isDirtyDraft = false;`
  - Nessun salvataggio LS
- Helper: `_onDraftChangeAnyField()` = setta `isDirtyDraft = true`

### Step 3: Google Component HTML → binding su draft + disabled quando !editingMode
- In cima a `.gcal-card` (prima dell'header) → row right-left con:
  - a sinistra label stato: `Modalità sola lettura · per modificare clicca MODIFICA` (badge grigio) se !editing; `Modalità MODIFICA · clicca SALVA o ANNULLA` (badge verde) se editing
  - a destra pulsanti:
    - Se !editing: `<button type="button" class="btn-primary" (click)="onStartEditGoogle()">🔓 MODIFICA Preferenze Google</button>` 46px
    - Se editing:
      - `<button type="button" class="btn-primary" (click)="onSaveAllGoogle()" [disabled]="!isDirtyDraft">✅ SALVA Tutte le Impostazioni</button>`
      - `<button type="button" class="btn-outline" (click)="onCancelEditGoogle()">↩️ ANNULLA Modifiche</button>`
- **TUTTI** gli input, select, checkbox, bottoni quick action:
  ```html
  <!-- PRIMA (istantaneo): -->
  [(ngModel)]="clientIdInput" (change)="salvaSubito()"

  <!-- DOPO (draft): -->
  [(ngModel)]="draft.clientId" (ngModelChange)="_onDraftChangeAnyField()" [disabled]="!editingMode"
  ```
  - Client ID input, Save Client ID button (il pulsante Salva sparisce: non serve, si salva con SALVA globale!)
  - Tendina Calendario selectedCalendar (value → draft.selectedCalendarId) + "Aggiorna elenco" button (può rimanere sempre attivo per popolare la lista, ma la scelta finisce su draft)
  - Cutoff data input + "Applica filtro" + "📍 Oggi" (applica su draft!)
  - 11 checkbox note format: `[(ngModel)]="draft.noteFormat[f.key]" + disabled + change
  - Quick buttons note: "Disattiva tutto" + "Ripristina consigliati" (applica su draft!)
  - Anteprima live: `gcal.buildGoogleDescriptionFromFormat(previewSampleEvent, draft.noteFormat)` (sempre aggiornata! Si vede l'anteprima anche senza salvare, come oggi ✅)

### Step 4: (non obbligatorio ma bello) CSS editing mode
- Aggiungi classe `.gcal-card--editing` condizionale `[class.gcal-card--editing]="editingMode"` sull'outer `<section class="gcal-card">`
- SCSS: cambia colore bordo da grigio → **VERDE CHIARO** (`#86efac`) + sfondo leggermente più verde + badge top "MODIFICHE IN CORSO"

### Step 5: Build + Test + Push
- `npm run build` PASS + `GetDiagnostics` [] 0 errori
- Manual check localhost:
  ✅ Profilo → 6 step nella Modifica Rapida (5. Google Calendar, 6. Colori agenda)
  ✅ Step 5 Google → Sezione Google appare DENTRO la stepper. Sotto i colori poi step 6. Nessuna card fuori dal form.
  ✅ Di default TUTTI DISABLED (sfondo grigio input, checkbox non cliccabili). Solo pulsante MODIFICA cliccabile.
  ✅ Clic MODIFICA → campi si sbloccano + verde. Spunto 2 checkbox note, cambio cutoff, cambio Client ID → anteprima cambia ✅
  ✅ ANNULLA → tutti i 4 valori tornano indietro (ripristino snapshot)
  ✅ SALVA → messaggio verde, valori in LS, tornano disabled.
- Commit + push con messaggio "feat: step5 Google Calendar dentro stepper + Modifica/Salva/Annulla"

---

## ✅ Validazione
- localhost:4200 → `ngOnInit` carica i draft LIVE da LS
- Modifico 4 campi → `isDirtyDraft = true` → Annulla chiede conferma
- `structuredClone` del restore: nessun riferimento JS condiviso tra snapshot e draft
- `buildGoogleDescriptionFromFormat` è Puro quindi anteprima prende draft.noteFormat senza problemi
- Tema scuro + responsive <820px compila come prima (nessun breaking CSS)
- Commit: 4 file modificati (no file nuovi).

## ⚠️ Rischi e mitigazioni
1. **Rischio: snapshot = riferimento JS invece che clone → annulla non funziona** → **Mitigazione**: `structuredClone()` nativo del browser (Node 17+, tutti i browser dal 2022). Deep clone perfetto.
2. **Rischio: pulsante "Sincronizza Google" è disabilitato quando è in modalità sola lettura, ma è un azione distruttiva?** → No: Sync e Wipe sono AZIONI SUI DATI, non sulle preferenze. Queste **AZIONI OPERATIVE** (Sync da Google · Pulisci Passato · Dedup · Reset) **RESTANO SEMPRE ATTIVE**: non sono "modifiche impostazioni" ma operazioni sui dati. Solo le PREFERENZE (input Client ID, cutoff, note checkbox, tendina calendario) sono disabled.
3. **Rischio: lista calendari vuota se modalità sola lettura blocco il pulsante aggiorna lista?** → Mitigazione: il pulsante "🔄 Ricarica lista calendari" è sempre attivo perché serve a popolare la select, ma la selezione al cambiamento scrive in DRAFT e NON in LS finché non SALVI.
