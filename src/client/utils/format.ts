import { BotRuntimeStatus, ModuleId, QuoteCurrency } from '../../shared/types';

export function formatNumberFa(val: number, maxDecimals = 0): string {
  if (!Number.isFinite(val)) return '۰';
  return val.toLocaleString('fa-IR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxDecimals,
  });
}

export const formatFaNum = formatNumberFa;

export function formatRelativeTimeFa(ts: number | null): string {
  if (!ts) return '—';
  const diffSec = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (diffSec < 60) return `${formatNumberFa(diffSec)} ثانیه پیش`;
  if (diffSec < 3600) return `${formatNumberFa(Math.round(diffSec / 60))} دقیقه پیش`;
  return formatTimeFa(ts);
}

export function formatMoney(amount: number, quote: QuoteCurrency = 'IRT'): string {
  if (!Number.isFinite(amount)) return '۰';
  if (quote === 'IRT') {
    const abs = Math.abs(amount);
    if (abs >= 1_000_000_000) {
      return `${(amount / 1_000_000_000).toLocaleString('fa-IR', { maximumFractionDigits: 2 })} میلیارد تومان`;
    }
    return `${Math.round(amount).toLocaleString('fa-IR')} تومان`;
  }
  return `${amount.toLocaleString('fa-IR', { maximumFractionDigits: 2 })} تتر`;
}

export function formatCompactIrt(amount: number): string {
  if (!Number.isFinite(amount)) return '۰ تومان';
  const sign = amount < 0 ? '-' : '';
  const abs = Math.abs(amount);
  if (abs >= 1_000_000) {
    return `${sign}${(abs / 1_000_000).toLocaleString('fa-IR', { maximumFractionDigits: 2 })} میلیون تومان`;
  }
  return `${Math.round(amount).toLocaleString('fa-IR')} تومان`;
}

export function formatPrice(price: number, quote: QuoteCurrency): string {
  if (!Number.isFinite(price)) return '۰';
  if (quote === 'IRT') {
    if (price < 10) {
      return `${price.toLocaleString('fa-IR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })} تومان`;
    }
    if (price < 1000) {
      return `${price.toLocaleString('fa-IR', { minimumFractionDigits: 1, maximumFractionDigits: 2 })} تومان`;
    }
    return `${Math.round(price).toLocaleString('fa-IR')} تومان`;
  }
  const decimals = price >= 100 ? 2 : price >= 1 ? 3 : price >= 0.001 ? 5 : 8;
  return `${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: decimals })} USDT`;
}

export function formatPct(pct: number): string {
  if (!Number.isFinite(pct)) return '0%';
  const prefix = pct > 0 ? '+' : '';
  return `${prefix}${pct.toFixed(2)}٪`;
}

export function formatTimeFa(ts: number | null): string {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleTimeString('fa-IR', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return '—';
  }
}

export function getModuleTitleFa(module: ModuleId): string {
  switch (module) {
    case 'DIGITAL_GOLD':
      return 'ماژول طلا (PAXG / XAUT)';
    case 'SPOT_CRYPTO':
      return 'ماژول رمزارز اسپات بیت‌۲۴';
    case 'MEME_HUNTER':
      return 'زیرماژول رمزارز: میم‌کوین اسپات';
    case 'LEVERAGE_MARGIN':
      return 'اهرم مارجین (نسخه ۱ خاموش)';
  }
}

export function getBotStatusBadge(status: BotRuntimeStatus): {
  labelFa: string;
  colorClass: string;
} {
  switch (status) {
    case 'LIVE_ACTIVE':
      return {
        labelFa: 'واقعی فعال (LIVE)',
        colorClass: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
      };
    case 'PAPER_ACTIVE':
      return {
        labelFa: 'آزمایشی فعال (Paper)',
        colorClass: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40',
      };
    case 'PAUSED_NEW_TRADES':
      return {
        labelFa: 'توقف معاملات جدید',
        colorClass: 'bg-amber-500/20 text-amber-200 border-amber-500/45',
      };
    case 'ANALYZING':
      return {
        labelFa: 'فقط تحلیل و سیگنال',
        colorClass: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
      };
    case 'SIGNAL_ONLY_FALLBACK':
      return {
        labelFa: 'فقط تحلیل (عدم اتصال API)',
        colorClass: 'bg-amber-500/20 text-amber-200 border-amber-500/40',
      };
    case 'DAILY_LOSS_HALTED':
      return {
        labelFa: 'توقف سقف زیان روزانه (۲٪)',
        colorClass: 'bg-rose-500/25 text-rose-200 border-rose-500/50',
      };
    case 'CIRCUIT_BREAKER_HALTED':
      return {
        labelFa: 'توقف خودکار خطا/ریسک',
        colorClass: 'bg-rose-600/30 text-rose-100 border-rose-500/60',
      };
    case 'EMERGENCY_STOPPED':
      return {
        labelFa: 'توقف اضطراری فعال',
        colorClass: 'bg-red-600/30 text-red-200 border-red-500/60',
      };
    case 'STOPPED':
    default:
      return {
        labelFa: 'متوقف',
        colorClass: 'bg-slate-800 text-slate-400 border-slate-700',
      };
  }
}
