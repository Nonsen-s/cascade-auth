import { Layers3, LockKeyhole, Sparkles } from 'lucide-react';
import type { Application } from '../app/create-application';
import { AuthPanel } from './auth-panel';

export function App({ application }: { readonly application: Application }) {
  return (
    <div className="page-shell">
      <a className="skip-link" href="#account">
        Перейти к форме
      </a>
      <header className="site-header">
        <a className="brand" href="/" aria-label="Каскад — главная">
          <span className="brand-icon" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
          </span>
          <span>
            каскад<span className="brand-dot">.</span>
          </span>
        </a>
        <span className="header-label">
          <UserLabel />
          Аккаунт игрока
        </span>
      </header>
      <main className="main-layout" id="account">
        <section className="welcome" aria-labelledby="welcome-title">
          <div className="welcome-label">
            <span />
            Добро пожаловать в Каскад
          </div>
          <h1 id="welcome-title">
            Всё начинается
            <br />с вашего <br />
            аккаунта<span className="heading-dot">.</span>
          </h1>
          <p className="welcome-description">
            Пара простых шагов — и вы с нами. <br />
            Зарегистрируйтесь или войдите в свой аккаунт.
          </p>
          <TileComposition />
          <div className="welcome-footnote">
            <span className="footnote-icon">
              <Layers3 size={20} aria-hidden="true" />
            </span>
            <span>
              Большие истории начинаются
              <br />
              <strong>с маленьких комбинаций.</strong>
            </span>
          </div>
        </section>
        <div className="account-column">
          <AuthPanel
            auth={application.auth}
            configurationError={application.configurationError}
          />
          <div className="below-card">
            <LockKeyhole size={14} aria-hidden="true" />
            <span>Безопасный вход по почте и паролю</span>
          </div>
        </div>
      </main>
      <footer className="site-footer">
        <span>© {new Date().getFullYear()} Каскад</span>
        <span>
          Всё сложится <Sparkles size={14} aria-hidden="true" />
        </span>
      </footer>
    </div>
  );
}

function UserLabel() {
  return <span className="header-status" aria-hidden="true" />;
}

function TileComposition() {
  return (
    <div className="tile-scene" aria-hidden="true">
      <div className="tile-grid">
        <span className="tile tile-lavender">
          <span className="tile-diamond" />
        </span>
        <span className="tile tile-blue">
          <span className="tile-circle" />
        </span>
        <span className="tile tile-empty" />
        <span className="tile tile-blue">
          <span className="tile-circle" />
        </span>
        <span className="tile tile-gold">
          <span className="tile-star">✦</span>
        </span>
        <span className="tile tile-pink">
          <span className="tile-diamond" />
        </span>
        <span className="tile tile-empty" />
        <span className="tile tile-pink">
          <span className="tile-diamond" />
        </span>
        <span className="tile tile-lavender">
          <span className="tile-star">✦</span>
        </span>
      </div>
      <span className="scene-sparkle sparkle-one">✧</span>
      <span className="scene-sparkle sparkle-two">✦</span>
      <span className="scene-dot" />
    </div>
  );
}
