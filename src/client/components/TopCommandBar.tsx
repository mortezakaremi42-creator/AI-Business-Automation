import React from 'react';
import {
  AlertOctagon,
  Download,
  KeyRound,
  ShieldCheck,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { PlatformSnapshot } from '../../shared/types';

interface Props {
  snapshot: PlatformSnapshot;
  canInstallPwa: boolean;
  isStandalonePwa: boolean;
  onOpenConnectModal: () => void;
  onOpenEmergencyModal: () => void;
  onOpenApiHealthTab: () => void;
  onOpenAntiRugTab?: () => void;
  onOpenInstallModal: () => void;
}

export const TopCommandBar: React.FC<Props> = ({
  snapshot,
  isStandalonePwa,
  onOpenConnectModal,
  onOpenEmergencyModal,
  onOpenApiHealthTab,
  onOpenAntiRugTab,
  onOpenInstallModal,
}) => {
  const { health, settings, emergencyStopped } = snapshot;

  const modeBadge =
    emergencyStopped
      ? { text: 'توقف اضطراری فعال', cls: 'bg-red-600/30 text-red-200 border-red-500/60' }
      : settings.environmentMode === 'LIVE' && settings.liveTradingConfirmedThisSession
        ? { text: 'معاملات واقعی (LIVE)', cls: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50' }
        : settings.environmentMode === 'PAPER'
          ? { text: 'حالت آزمایشی (Paper)', cls: 'bg-cyan-500/20 text-cyan-200 border-cyan-500/40' }
          : { text: 'فقط تحلیل و سیگنال', cls: 'bg-amber-500/20 text-amber-200 border-amber-500/40' };

  return (
    <header className="sticky top-0 z-40 border-b border-slate-800/90 bg-[#090D16]/95 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-3 py-2.5 sm:px-5">
        {/* Brand */}
        <div className="flex items-center gap-2.5">
          <img
            src="./icons/icon-192.png"
            alt="Bit24 AI + Gold"
            className="h-10 w-10 rounded-xl border border-amber-500/40 shadow-lg shadow-amber-500/10"
          />
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-sm font-black tracking-tight text-white sm:text-base">
                Phantom Dip Hunter Pro{' '}
                <span className="text-amber-400">• Bit24 AI + Gold</span>
              </h1>
              <span
                className={`rounded-full border px-2 py-0.5 text-[11px] font-bold ${modeBadge.cls}`}
              >
                {modeBadge.text}
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              مجهز به ANTI-RUG &amp; SMART SECURITY • شکار پامپ/کف + فروش پله‌ای • معامله واقعی قفل
            </p>
          </div>
        </div>

        {/* Quick Status + Emergency Stop */}
        <div className="flex flex-wrap items-center gap-1.5">
          {onOpenAntiRugTab && (
            <button
              type="button"
              onClick={onOpenAntiRugTab}
              className="flex items-center gap-1.5 rounded-xl border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-2 text-xs font-extrabold text-emerald-300 hover:bg-emerald-500/25"
              title="صفحه ANTI-RUG SECURITY"
            >
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
              <span>ANTI-RUG ({snapshot.antiRug.blockedBuysCount})</span>
            </button>
          )}
          <button
            type="button"
            onClick={onOpenApiHealthTab}
            className="flex items-center gap-1.5 rounded-xl border border-slate-700/80 bg-slate-900/90 px-2.5 py-2 text-xs font-medium text-slate-200 hover:border-slate-500"
            title="مشاهده وضعیت API و اتصال اینترنت"
          >
            {health.internetOnline ? (
              <Wifi className="h-3.5 w-3.5 text-emerald-400" />
            ) : (
              <WifiOff className="h-3.5 w-3.5 text-rose-400" />
            )}
            <span className="hidden sm:inline">وضعیت API</span>
            <span
              className={`h-2 w-2 rounded-full ${
                health.bit24ConnectionState === 'CONNECTED_VERIFIED'
                  ? 'bg-emerald-400'
                  : health.bit24ApiConfigured
                    ? 'bg-amber-400'
                    : 'bg-slate-500'
              }`}
            />
          </button>

          {!isStandalonePwa && (
            <button
              type="button"
              onClick={onOpenInstallModal}
              className="flex items-center gap-1.5 rounded-xl border border-amber-500/40 bg-amber-500/15 px-2.5 py-2 text-xs font-bold text-amber-300 hover:bg-amber-500/25"
            >
              <Download className="h-3.5 w-3.5" />
              <span>نصب اندروید</span>
            </button>
          )}

          <button
            type="button"
            onClick={onOpenConnectModal}
            className="flex items-center gap-1.5 rounded-xl border border-cyan-500/40 bg-cyan-500/15 px-3 py-2 text-xs font-bold text-cyan-200 hover:bg-cyan-500/25"
          >
            {health.bit24ApiConfigured ? (
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
            ) : (
              <KeyRound className="h-3.5 w-3.5 text-cyan-300" />
            )}
            <span>{health.bit24KeyMasked || 'اتصال به بیت‌۲۴'}</span>
          </button>

          <button
            type="button"
            onClick={onOpenEmergencyModal}
            className="flex items-center gap-1.5 rounded-xl border border-red-500/70 bg-red-600/90 px-3 py-2 text-xs font-extrabold text-white shadow-md shadow-red-900/40 hover:bg-red-500 active:scale-95"
          >
            <AlertOctagon className="h-4 w-4" />
            <span>توقف اضطراری</span>
          </button>
        </div>
      </div>
    </header>
  );
};
