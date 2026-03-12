import { Component, OnInit } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { SupabaseService } from '../../core/supabase.service';

@Component({
  selector: 'app-register',
  templateUrl: './register.component.html',
  styleUrls: ['./register.component.scss']
})
export class RegisterComponent implements OnInit {
  mode: 'login' | 'register' = 'register';
  loading = false;
  error: string | null = null;
  licenseRef = '';
  appKey = 'musician_manager';

  form = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(6)]]
  });

  constructor(
    private fb: FormBuilder,
    private route: ActivatedRoute,
    private router: Router,
    private supabase: SupabaseService
  ) {}

  ngOnInit(): void {
    const ref = this.route.snapshot.queryParamMap.get('ref');
    const app = this.route.snapshot.queryParamMap.get('app');
    this.licenseRef = ref || '';
    this.appKey = app || 'musician_manager';
    if (this.licenseRef) localStorage.setItem('mm_license_ref', this.licenseRef);
    if (this.appKey) localStorage.setItem('mm_license_app', this.appKey);
  }

  async submit(): Promise<void> {
    this.error = null;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.loading = true;
    try {
      const email = this.form.value.email!;
      const password = this.form.value.password!;

      if (this.mode === 'register') {
        await this.supabase.signUpWithEmail(email, password, {
          app: this.appKey,
          license_ref: this.licenseRef || null
        });
      }

      await this.supabase.signInWithPassword(email, password);
      await this.supabase.activateLicenseFromRef(this.licenseRef, this.appKey, email);
      await this.supabase.syncAffiliationCodeFromLicense();
      localStorage.setItem('mm_user_email', email);
      this.router.navigateByUrl('/profile');
    } catch (e: any) {
      this.error = e?.message || 'Errore durante accesso';
    } finally {
      this.loading = false;
    }
  }

  toggleMode(): void {
    this.mode = this.mode === 'register' ? 'login' : 'register';
    this.error = null;
  }
}
