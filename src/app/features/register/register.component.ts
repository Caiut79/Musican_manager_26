import { Component, OnInit } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { IdentityContextService } from '../../core/identity-context.service';
import { LicenseService } from '../../core/license.service';
import { LocalStorageService, LS } from '../../core/local-storage.service';
import { SupabaseService } from '../../core/supabase.service';

@Component({
  selector: 'app-register',
  templateUrl: './register.component.html',
  styleUrls: ['./register.component.scss']
})
export class RegisterComponent implements OnInit {
  loading = false;
  error: string | null = null;
  licenseRef = '';
  appKey = 'musician_manager';
  requestCopied = false;
  inviteStatus: 'idle' | 'checking' | 'valid' | 'invalid' = 'idle';
  inviteInfo = '';
  inviteEmail = '';
  inviteMode: 'signup' | 'login' = 'signup';

  form = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(6)]]
  });

  constructor(
    private fb: FormBuilder,
    private route: ActivatedRoute,
    private router: Router,
    private supabase: SupabaseService,
    private licenseService: LicenseService,
    private identityContext: IdentityContextService,
    private ls: LocalStorageService
  ) {}

  ngOnInit(): void {
    const ref = this.route.snapshot.queryParamMap.get('ref');
    const app = this.route.snapshot.queryParamMap.get('app');
    this.licenseRef = this.normalizeInviteRef(ref);
    this.appKey = this.licenseService.normalizeAppKey(app);
    if (this.licenseRef) this.ls.setString(LS.LICENSE_REF, this.licenseRef);
    if (this.appKey) this.ls.setString(LS.LICENSE_APP, this.appKey);
    if (this.isInviteFlow) {
      void this.validateInvite();
    }
  }

  async submit(): Promise<void> {
    this.error = null;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.loading = true;
    try {
      const email = `${this.form.value.email || ''}`.trim().toLowerCase();
      const password = this.form.value.password!;

      if (this.isInviteFlow) {
        if (this.inviteStatus === 'idle') {
          await this.validateInvite();
        }
        if (this.inviteStatus !== 'valid') {
          throw new Error(this.inviteInfo || 'Link licenza non valido');
        }
      }

      await this.authenticate(email, password, this.isInviteFlow ? this.inviteMode : 'login');

      let activationError: unknown = null;
      if (this.isInviteFlow) {
        try {
          const activation = await this.licenseService.activateInvite(this.licenseRef, this.appKey, {
            email,
            source: 'musician_manager_register',
            userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : ''
          });
          if (!activation.ok) {
            activationError = new Error('Attivazione licenza non completata');
          }
          await this.supabase.syncAffiliationCodeFromLicense();
        } catch (error) {
          activationError = error;
        }
      }

      this.ls.setString(LS.USER_EMAIL, email);
      const context = await this.identityContext.bootstrap(this.appKey);
      if (!context) {
        await this.supabase.signOut();
        if (activationError) {
          throw new Error(this.mapSubmitError(activationError));
        }
        throw new Error('Account non attivato o profilo non ancora provisionato');
      }
      const hasLinkedProfile = this.hasLinkedProfile(context);
      if (!this.isInviteFlow && !hasLinkedProfile) {
        await this.supabase.signOut();
        throw new Error('Questo account esiste ma non risulta collegato a un profilo musicista attivo. Va riallineato prima della messa online.');
      }
      await this.router.navigateByUrl(hasLinkedProfile ? '/dashboard' : '/profile');
    } catch (e: any) {
      this.error = this.mapSubmitError(e);
    } finally {
      this.loading = false;
    }
  }

  get isInviteFlow(): boolean {
    return !!`${this.licenseRef || ''}`.trim();
  }

  async copyActivationRequest(): Promise<void> {
    const email = `${this.form.value.email || ''}`.trim();
    const lines = [
      'Richiesta attivazione Musican Manager',
      `Email: ${email || '[inserire email]'}`,
      `App: ${this.appKey}`,
      `Ref licenza: ${this.licenseRef || 'nessuno'}`
    ];
    await navigator.clipboard.writeText(lines.join('\n'));
    this.requestCopied = true;
    this.error = null;
    setTimeout(() => this.requestCopied = false, 2200);
  }

  private async validateInvite(): Promise<void> {
    this.inviteStatus = 'checking';
    this.inviteInfo = '';
    this.inviteEmail = '';
    try {
      const result = await this.licenseService.validateInvite(this.licenseRef, this.appKey);
      this.inviteStatus = result.valid ? 'valid' : 'invalid';
      this.inviteEmail = `${result.recipientEmail || ''}`.trim().toLowerCase();
      if (this.inviteEmail) {
        this.form.patchValue({ email: this.inviteEmail }, { emitEvent: false });
      }
      if (result.reason === 'already_active') {
        this.inviteMode = 'login';
      }
      this.inviteInfo = result.valid
        ? result.reason === 'already_active'
          ? 'Licenza già attivata: accedi con il tuo account'
          : `Licenza valida${result.recipientEmail ? ` per ${result.recipientEmail}` : ''}`
        : this.mapInviteReason(result.reason);
      if (!result.valid) this.error = this.inviteInfo;
    } catch (error: any) {
      this.inviteStatus = 'invalid';
      this.inviteInfo = error?.message || 'Link licenza non valido';
      this.error = this.inviteInfo;
    }
  }

  private async authenticate(email: string, password: string, mode: 'signup' | 'login'): Promise<void> {
    if (mode === 'login') {
      await this.supabase.signInWithPassword(email, password);
      return;
    }
    try {
      await this.supabase.signUpWithEmail(email, password, {
        app: this.appKey,
        invite_ref: this.licenseRef || null,
        license_ref: this.licenseRef || null
      });
    } catch (signUpError: any) {
      if (this.looksLikeAlreadyRegistered(signUpError)) {
        this.inviteMode = 'login';
        throw new Error('Account già esistente. Accedi qui per completare l’attivazione.');
      }
      throw signUpError;
    }
    await this.supabase.signInWithPassword(email, password);
  }

  private looksLikeAlreadyRegistered(error: any): boolean {
    const text = `${error?.message || ''}`.toLowerCase();
    return text.includes('already registered') || text.includes('user already registered');
  }

  private mapInviteReason(reason: string | null): string {
    const value = `${reason || ''}`.trim().toLowerCase();
    if (value.includes('already_active')) return 'Licenza già attivata: accedi con il tuo account';
    if (value.includes('expired') || value.includes('scad')) return 'Il link licenza è scaduto';
    if (value.includes('app')) return 'Il link appartiene a un’altra app';
    if (value.includes('closed') || value.includes('used')) return 'Licenza già chiusa o utilizzata';
    return 'Il link licenza non è valido';
  }

  switchInviteMode(mode: 'signup' | 'login'): void {
    this.inviteMode = mode;
    this.error = null;
  }

  private normalizeInviteRef(value: string | null): string {
    return decodeURIComponent(`${value || ''}`).trim().toUpperCase();
  }

  private mapSubmitError(error: unknown): string {
    const message = `${(error as any)?.message || ''}`.trim();
    const details = `${(error as any)?.appCause?.message || (error as any)?.details || ''}`.trim();
    const text = `${message} ${details}`.trim().toLowerCase();
    if (text.includes('invalid login credentials') || text.includes('invalid_credentials')) {
      return 'Credenziali non valide';
    }
    if (text.includes('email not confirmed')) {
      return 'Conferma email richiesta prima dell’accesso';
    }
    if (text.includes('already active') || text.includes('already activated')) {
      return 'Licenza già attiva. Accedi con l’account già associato';
    }
    if (text.includes('another user') || text.includes('different user') || text.includes('auth_user_id')) {
      return 'Questa licenza risulta associata a un altro account';
    }
    if (text.includes('app_mismatch') || text.includes('app mismatch')) {
      return 'Licenza valida ma per un’app diversa';
    }
    if (text.includes('non risulta collegato')) {
      return 'Account autenticato ma non collegato correttamente a un profilo esistente';
    }
    if (message && message !== '[object Object]') return message;
    if (details && details !== '[object Object]') return details;
    return this.isInviteFlow ? 'Attivazione account non riuscita' : 'Accesso non riuscito';
  }

  private hasLinkedProfile(context: any): boolean {
    const profile = context?.profile || {};
    const firstName = `${profile?.firstName || ''}`.trim();
    const lastName = `${profile?.lastName || ''}`.trim();
    return !!(`${context?.musicianId || ''}`.trim() || firstName || lastName || context?.hasServerContext);
  }
}
