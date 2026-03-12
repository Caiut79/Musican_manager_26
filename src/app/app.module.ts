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
import { RegisterComponent }        from './features/register/register.component';
import { BookingRequestComponent }  from './features/booking-request/booking-request.component';
import { ArchiveComponent }         from './features/archive/archive.component';
import { ConcertsComponent }        from './features/concerts/concerts.component';
import { ConcertConfirmationComponent } from './features/concert-confirmation/concert-confirmation.component';
import { TeachingComponent }        from './features/teaching/teaching.component';
import { SchoolPortalComponent }    from './features/school-portal/school-portal.component';
import { ReportsComponent }         from './features/reports/reports.component';

const routes: Routes = [
  { path: '',              redirectTo: 'register', pathMatch: 'full' },
  { path: 'register',     component: RegisterComponent },
  { path: 'book/:slug',   component: BookingRequestComponent },
  { path: 'confirm/:id',  component: ConcertConfirmationComponent },
  { path: 'school/:code', component: SchoolPortalComponent },
  { path: 'dashboard',    component: DashboardComponent },
  { path: 'profile',      component: MusicianFormComponent },
  { path: 'agenda',       component: AgendaComponent },
  { path: 'concerts',     component: ConcertsComponent },
  { path: 'teaching',     component: TeachingComponent },
  { path: 'reports',      component: ReportsComponent },
  { path: 'events',       component: EventsComponent },
  { path: 'expenses',     component: ExpensesComponent },
  { path: 'communication',component: CommunicationComponent },
  { path: 'archive',      component: ArchiveComponent },
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
    ArchiveComponent,
    ConcertsComponent,
    ConcertConfirmationComponent,
    TeachingComponent,
    SchoolPortalComponent,
    ReportsComponent,
    HistoryComponent,
    AccountingComponent,
    RegisterComponent,
    BookingRequestComponent,
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
