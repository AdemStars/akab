import React, { useState } from 'react';
import {
  MapPin,
  PlusCircle,
  BarChart3,
  ShieldCheck,
  ShieldAlert,
  HelpCircle,
  Lock,
  Clapperboard,
} from 'lucide-react';
import { MapComponent } from './components/Map';
import { SignalForm } from './components/SignalForm';
import { AdminDashboard } from './components/AdminDashboard';
import { Feed } from './components/Feed';
import { Statistics } from './components/Statistics';
import { AppealPage } from './pages/AppealPage';
import { PrivacyPage } from './pages/PrivacyPage';
import { SignalDetailModal } from './components/SignalDetailModal';
import { Signal } from './utils/api';

type Tab = 'map' | 'feed' | 'report' | 'stats' | 'appeal' | 'admin' | 'privacy';

export const App: React.FC = () => {
  const [currentTab, setCurrentTab] = useState<Tab>('map');
  const [selectedSignal, setSelectedSignal] = useState<Signal | null>(null);
  const [focusSignal, setFocusSignal] = useState<Signal | null>(null);

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="header-inner">
          <div
            className="logo"
            onClick={() => setCurrentTab('map')}
            style={{ cursor: 'pointer' }}
          >
            <ShieldAlert size={28} className="logo-icon" />
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontSize: '1.4rem', fontWeight: 900, letterSpacing: '-0.5px' }}>AKAB</span>
                <span className="badge badge-red" style={{ fontSize: '0.65rem' }}>DÉCENTRALISÉ</span>
              </div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                Observatoire citoyen des violences policières
              </div>
            </div>
          </div>

          <nav className="nav-desktop">
            <button
              className={`nav-link ${currentTab === 'map' ? 'active' : ''}`}
              onClick={() => setCurrentTab('map')}
            >
              <MapPin size={16} /> Carte & Signalements
            </button>
            <button
              className={`nav-link ${currentTab === 'feed' ? 'active' : ''}`}
              onClick={() => setCurrentTab('feed')}
            >
              <Clapperboard size={16} /> Fil
            </button>
            <button
              className={`nav-link ${currentTab === 'report' ? 'active' : ''}`}
              onClick={() => setCurrentTab('report')}
            >
              <PlusCircle size={16} /> Signaler
            </button>
            <button
              className={`nav-link ${currentTab === 'stats' ? 'active' : ''}`}
              onClick={() => setCurrentTab('stats')}
            >
              <BarChart3 size={16} /> Statistiques
            </button>
            <button
              className={`nav-link ${currentTab === 'appeal' ? 'active' : ''}`}
              onClick={() => setCurrentTab('appeal')}
            >
              <HelpCircle size={16} /> Recours
            </button>
            <button
              className={`nav-link ${currentTab === 'admin' ? 'active' : ''}`}
              onClick={() => setCurrentTab('admin')}
            >
              <ShieldCheck size={16} /> Modération
            </button>
            <button
              className={`nav-link ${currentTab === 'privacy' ? 'active' : ''}`}
              onClick={() => setCurrentTab('privacy')}
            >
              <Lock size={16} /> RGPD
            </button>
          </nav>
        </div>
      </header>

      {/* Main Content View */}
      <main className="main-content">
        {currentTab === 'map' && (
          <MapComponent
            onSelectSignal={setSelectedSignal}
            focusSignal={focusSignal}
            onFocusHandled={() => setFocusSignal(null)}
          />
        )}
        {currentTab === 'feed' && <Feed
            onSelectSignal={setSelectedSignal}
            onShowOnMap={(sig) => {
              setFocusSignal(sig);
              setCurrentTab('map');
            }}
          />}
        {currentTab === 'report' && (
          <SignalForm onSuccess={() => setCurrentTab('map')} />
        )}
        {currentTab === 'stats' && <Statistics />}
        {currentTab === 'appeal' && <AppealPage />}
        {currentTab === 'admin' && <AdminDashboard />}
        {currentTab === 'privacy' && <PrivacyPage />}
      </main>

      {/* Mobile Bottom Navigation Bar */}
      <nav className="nav-mobile">
        <button
          className={`nav-item ${currentTab === 'map' ? 'active' : ''}`}
          onClick={() => setCurrentTab('map')}
        >
          <MapPin size={18} />
          <span>Carte</span>
        </button>
        <button
          className={`nav-item ${currentTab === 'feed' ? 'active' : ''}`}
          onClick={() => setCurrentTab('feed')}
        >
          <Clapperboard size={18} />
          <span>Fil</span>
        </button>
        <button
          className={`nav-item ${currentTab === 'report' ? 'active' : ''}`}
          onClick={() => setCurrentTab('report')}
        >
          <PlusCircle size={18} />
          <span>Signaler</span>
        </button>
        <button
          className={`nav-item ${currentTab === 'stats' ? 'active' : ''}`}
          onClick={() => setCurrentTab('stats')}
        >
          <BarChart3 size={18} />
          <span>Stats</span>
        </button>
        <button
          className={`nav-item ${currentTab === 'appeal' ? 'active' : ''}`}
          onClick={() => setCurrentTab('appeal')}
        >
          <HelpCircle size={18} />
          <span>Recours</span>
        </button>
        <button
          className={`nav-item ${currentTab === 'admin' ? 'active' : ''}`}
          onClick={() => setCurrentTab('admin')}
        >
          <ShieldCheck size={18} />
          <span>Modération</span>
        </button>
        <button
          className={`nav-item ${currentTab === 'privacy' ? 'active' : ''}`}
          onClick={() => setCurrentTab('privacy')}
        >
          <Lock size={18} />
          <span>RGPD</span>
        </button>
      </nav>

      {/* Detail Modal */}
      <SignalDetailModal
        signal={selectedSignal}
        onClose={() => setSelectedSignal(null)}
      />
    </div>
  );
};
