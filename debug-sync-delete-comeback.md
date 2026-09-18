# [OPEN] Debug: cancellazione evento → Sync Import Google RI-TORNA + DUPLICATI
**sessionId:** `sync-delete-comeback`  
**Data:** 18/09/2026  
**Impatto:** ❌ GRAVE (dati utente instabili / duplicati infiniti)

---

## Sintomi (utente)
1. **Cancello un evento dall'app** (Lista Concerti o Dashboard) → OK, scompare localmente.
2. **Clic pulsante "Sync Importa da Google" nella card Profilo** → **TORNA INDIETRO l'evento cancellato** come nuovo/riesumato.
3. **Dopo 2-3 sync si accumulano DUPLICATI** (stesso titolo, stessa data) che devono essere rimossi manualmente con i pulsanti Deduplica Locale e Deduplica Google Remoto (sezione manutenzione profilo).

## 🎯 Atteso (Expected)
- Cancellazione evento in App = CANCELLAZIONE IMMEDIATA ANCHE SU GOOGLE CALENDAR REMOTO (se evento era collegato, googleEventId presente).
- Sync Import successivo **non RI-CREA** eventi cancellati (anche se per qualche motivo ci sono ancora su Google).
- Zero duplicati dopo cancellazione + sync.

## 🧪 Passi riproduzione esatti (da eseguire per test)
1. Assicurati di essere connesso a Google (badge verde).
2. Crea **1 concerto nuovo** dal + Nuovo (es. *"Debug Cancel"* con data oggi).
3. Verifica che venga creato su Google → ID Google presente in `googleEventId` su mm_events.
4. **CANCELLA l'evento** dal menu a 3 pallini o icona cestino.
5. Torna a Profilo → sezione Google → clic **🔄 Sync Importa da Google**.
6. **Bug**: evento *Debug Cancel* RI-COMPARE in Lista Concerti/Dashboard.
7. Ripeti step 5 altre 2 volte → **3 duplicati** visibili.

---

## 5 Ipotesi Falsificabili (H1 → H5)

| # | Ipotesi | Probabilità | Punto osservazione |  
|---|---------|-------------|--------------------|  
| **H1** | ❗ **CANCELLAZIONE LOCALE NON INVOCA LA GOOGLE DELETE API** — Quando l'utente cancella l'evento, il codice usa `writeEventsWithTimestamp(events)` ma **NON passa per `persistEventsWithSync(events)`**, quindi il sync-outgoing `syncOutgoingDelta.delete` non viene mai popolato con l'ID e la DELETE non parte. Google quindi mantiene l'evento. | 🔴 95% | Punto in cui si elimina: `updateEvent`, `deleteEvent`, `removeEventById` + confronto `writeEventsWithTimestamp` vs `persistEventsWithSync`. |
| **H2** | **NESSUN MECCANISMO DI TOMBSTONE** (flag cancellato). Quando Sync Import vede su Google un evento che UN TEMPO avevamo (stesso `googleEventId`) ma oggi non lo troviamo in locale perché è stato CANCELLATO → l'algoritmo lo considera un "nuovo evento Google" e lo **ricrea con nuovo ID locale**. Dovremmo ricordare quali `googleEventId` abbiamo CANCELLATO e SKIPPARLI. | 🔴 85% | `_findFuzzyMatch` / import loop nel service sync: `gcal.syncIncomingEvents()`. |
| **H3** | **LWW Last-Write-Wins sbagliato per eventi cancellati**. L'algoritmo confronta solo `updatedAt` ma `updatedAt = cancellazione locale` è oggi, ma `Google.updated` dell'evento è oggi-1min. Google vince per 1 secondo → importa invece di skippare. | 🟠 55% | `syncIncomingEvents` nella parte di patch LWW. |
| **H4** | **Il vecchio evento cancellato locale aveva `googleEventId = undefined`** → Sync Outgoing delete non viene schedulato (manca l'ID Google). L'evento Google rimane. Poi Sync Import lo vede come nuovo (stesso titolo+data fuzzy). | 🟠 60% | Punto schedulazione DELETE: `syncOutgoingDelta.delete` nel service. |
| **H5** | **Duplicati multipli dopo N sync**: `consumedLocalIds` nel metodo import non viene mantenuto tra una sync e l'altra. Oppure il reset del `consumedLocalIds` avviene troppo presto. | 🟡 35% | `syncIncomingEvents` var `consumedLocalIds` Set. |

---

## File Chiave da Analizzare / Strumentare

1. `src/app/core/local-storage.service.ts`
   - `writeEventsWithTimestamp(events)`
   - `persistEventsWithSync(events)` (wrapper con hook)
   - tutti i metodi chiamano **`setItem('mm_events', ...)`** direttamente?
2. `src/app/core/google-calendar.service.ts`
   - `syncOutgoingDelta` Map/Object — chi setta `.delete[id]?`
   - `_findFuzzyMatch` (esclude consumedLocalIds?)
   - `syncIncomingEvents()` — loop eventi Google.
3. Tutte le chiamate a metodi tipo **`deleteEvent()` / `removeEventById()` / `updateEvent(undefined)`** in Dashboard, Concerti, Eventi lista, Agenda, ecc.
   → **TROVARE la funzione che rimuove un evento e vedere: salva con `writeEventsWithTimestamp()` oppure con `persistEventsWithSync()`?**

---

## Stato delle evidenze
| Evidenza | Trovata? | Riferimento |
|---|---|---|
| Metodo cancellazione standard | 🔍 | — |
| `persistEventsWithSync` vs `writeEventsWithTimestamp` | 🔍 | — |
| Tombstone cancellati in LS | 🔍 | — |
| DELETE chiamata al cancella | 🔍 | — |
