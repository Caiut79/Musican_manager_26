import { Injectable } from '@angular/core';

export type Theme = 'light' | 'dark' | 'amoled';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private _theme: Theme = 'light';

  get theme(): Theme { return this._theme; }

  init(): void {
    const saved = localStorage.getItem('mm_theme') as Theme | null;
    this.apply(saved && ['light','dark','amoled'].includes(saved) ? saved : 'light');
  }

  apply(theme: Theme): void {
    this._theme = theme;
    document.body.setAttribute('data-theme', theme);
    localStorage.setItem('mm_theme', theme);
  }
}
