import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { RouterModule, Routes } from '@angular/router';
import { HttpClientModule } from '@angular/common/http';

import { AppComponent }             from './app.component';
import { MusicianFormComponent }    from './features/musician-form/musician-form.component';
import { AgendaComponent }          from './features/agenda/agenda.component';
import { SidebarComponent }         from './shared/sidebar/sidebar.component';
import { DashboardComponent }       from './features/dashboard/dashboard.component';
import { EventsComponent }          from './features/events/events.component';
import { ExpensesComponent }        from './features/expenses/expenses.component';
import { CommunicationComponent }   from './features/communication/communication.component';
import { HistoryComponent }         from './features/history/history.component';
import { AccountingComponent }      from './features/accounting/accounting.component';

const routes: Routes = [
  { path: '',              redirectTo: 'dashboard', pathMatch: 'full' },
  { path: 'dashboard',    component: DashboardComponent },
  { path: 'profile',      component: MusicianFormComponent },
  { path: 'agenda',       component: AgendaComponent },
  { path: 'events',       component: EventsComponent },
  { path: 'expenses',     component: ExpensesComponent },
  { path: 'communication',component: CommunicationComponent },
  { path: 'history',      component: HistoryComponent },
  { path: 'accounting',   component: AccountingComponent },
  { path: '**',           redirectTo: 'dashboard' },
];

@NgModule({
  declarations: [
    AppComponent,
    MusicianFormComponent,
    AgendaComponent,
    SidebarComponent,
    DashboardComponent,
    EventsComponent,
    ExpensesComponent,
    CommunicationComponent,
    HistoryComponent,
    AccountingComponent,
  ],
  imports: [
    BrowserModule,
    FormsModule,
    ReactiveFormsModule,
    RouterModule.forRoot(routes),
    HttpClientModule,
  ],
  providers: [],
  bootstrap: [AppComponent]
})
export class AppModule {}
