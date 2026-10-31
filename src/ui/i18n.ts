import { AppLanguage, SignalTier } from '../shared/contracts.js';

export const UI_TEXT = {
  fa: {
    appTitle: 'BIT24 AI TRADER PRO',
    appSubtitle: 'ربات هوشمند معامله‌گر ارز دیجیتال و طلای دیجیتال — انحصاری صرافی Bit24',
    liveLockedBadge: 'حالت واقعی قفل است (فقط دمو فعال تا تأیید نهایی شما)',
    liveActiveBadge: 'حالت واقعی فعال (با تأیید کاربر)',
    installAndroidBtn: 'نصب مستقیم روی اندروید (PWA)',
    langSwitchBtn: 'English (EN)',

    // 10 Main Android Metrics
    demoBalance: 'موجودی آزمایشی (تومان)',
    dailyPnl: 'سود و زیان روزانه',
    totalPnl: 'سود و زیان کل',
    winningTrades: 'معاملات برنده',
    losingTrades: 'معاملات بازنده',
    winRate: 'درصد برد (Win Rate)',
    openTrades: 'معاملات باز رمزارز',
    bit24Status: 'وضعیت اتصال Bit24',
    capitalSecurity: 'وضعیت امنیت سرمایه',
    activeMode: 'وضعیت موتور معامله',

    // 9 Mandatory Buttons (kept bilingual/exact per spec)
    btnStartScanner: 'START SCANNER | شروع اسکنر',
    btnStopScanner: 'STOP SCANNER | توقف اسکنر',
    btnStartDemo: 'START DEMO TRADING | شروع معامله آزمایشی',
    btnStopTrading: 'STOP TRADING | توقف معاملات',
    btnEmergencyStop: 'EMERGENCY STOP | توقف اضطراری فوری',
    btnGoldTrading: 'GOLD TRADING | طلای دیجیتال',
    btnRiskManagement: 'RISK MANAGEMENT | مدیریت سرمایه و حد سود',
    btnTradeHistory: 'TRADE HISTORY | تاریخچه و گزارش‌ها',
    btnApiSettings: 'API SETTINGS | تنظیمات Bit24 و تلگرام',
    btnProTest: 'PRO 100+ TEST | تست حرفه‌ای ۱۰۰+ معامله',
    btnDashboard: 'MAIN PANEL | پنل اصلی و شکارچی پامپ',

    // Scanner & Pump Hunter
    topOpportunitiesTitle: 'بهترین فرصت‌های شکارچی پامپ در صرافی Bit24',
    disclaimerBanner:
      'شفافیت و سلب مسئولیت: هیچ سیگنال یا امتیازی سود قطعی را تضمین نمی‌کند. ربات منحصراً به صرافی Bit24 محدود است و دسترسی برداشت وجه برای همیشه مسدود است.',
    scoreLabel: 'امتیاز فرصت',
    demoBuyNow: 'خرید آزمایشی (Demo)',
    openPositionsTitle: 'پوزیشن‌های باز فعلی (مدیریت خودکار حد ضرر و فروش پله‌ای)',
    noOpenPositions: 'در حال حاضر پوزیشن بازی وجود ندارد.',
    securityRejectionsTitle: 'لاگ امنیتی SMART SECURITY (دلایل رد هوشمند معاملات پرریسک)',
    noRejectionsYet: 'هنوز معامله مشکوک یا پرریسکی رد نشده است.',
  },
  en: {
    appTitle: 'BIT24 AI TRADER PRO',
    appSubtitle: 'Intelligent Crypto & Digital Gold Trading Bot — Exclusively for Bit24',
    liveLockedBadge: 'LIVE LOCKED (Safe Demo Mode until your final approval)',
    liveActiveBadge: 'LIVE MODE ACTIVE (User Confirmed)',
    installAndroidBtn: 'Install on Android (PWA)',
    langSwitchBtn: 'فارسی (FA)',

    demoBalance: 'Demo Balance (IRT)',
    dailyPnl: 'Daily PnL',
    totalPnl: 'Total PnL',
    winningTrades: 'Winning Trades',
    losingTrades: 'Losing Trades',
    winRate: 'Win Rate %',
    openTrades: 'Open Crypto Trades',
    bit24Status: 'Bit24 Connection Status',
    capitalSecurity: 'Capital Security Status',
    activeMode: 'Trading Engine Mode',

    btnStartScanner: 'START SCANNER',
    btnStopScanner: 'STOP SCANNER',
    btnStartDemo: 'START DEMO TRADING',
    btnStopTrading: 'STOP TRADING',
    btnEmergencyStop: 'EMERGENCY STOP',
    btnGoldTrading: 'GOLD TRADING',
    btnRiskManagement: 'RISK MANAGEMENT',
    btnTradeHistory: 'TRADE HISTORY',
    btnApiSettings: 'API SETTINGS',
    btnProTest: 'PRO 100+ TEST',
    btnDashboard: 'MAIN PANEL',

    topOpportunitiesTitle: 'Top Bit24 Pump Hunter Opportunities',
    disclaimerBanner:
      'Honest Disclosure: No signal or score guarantees profit. Exclusively built for Bit24 exchange; withdrawal permissions are permanently blocked.',
    scoreLabel: 'Score',
    demoBuyNow: 'Demo Buy',
    openPositionsTitle: 'Active Open Positions (Auto SL, Trailing & Stepped TP)',
    noOpenPositions: 'No active open positions right now.',
    securityRejectionsTitle: 'SMART SECURITY Log (Rejected Risky/Duplicate Orders)',
    noRejectionsYet: 'No orders rejected yet.',
  },
} as const;

export function formatTierBadge(tier: SignalTier, lang: AppLanguage): {
  label: string;
  colorClass: string;
} {
  if (tier === 'STRONG_TEST_SIGNAL') {
    return {
      label: lang === 'fa' ? '۸۵–۱۰۰: سیگنال قوی برای آزمایش' : '85–100: Strong Test Signal',
      colorClass: 'tier-strong',
    };
  }
  if (tier === 'REVIEW_OPPORTUNITY') {
    return {
      label: lang === 'fa' ? '۷۵–۸۴: فرصت قابل بررسی' : '75–84: Review Opportunity',
      colorClass: 'tier-review',
    };
  }
  if (tier === 'ALERT_ONLY') {
    return {
      label: lang === 'fa' ? '۶۰–۷۴: فقط هشدار' : '60–74: Alert Only',
      colorClass: 'tier-alert',
    };
  }
  return {
    label: lang === 'fa' ? 'زیر ۶۰: رد سیگنال' : '<60: Signal Rejected',
    colorClass: 'tier-rejected',
  };
}

export function formatIrt(amount: number, lang: AppLanguage): string {
  const formatted = Number(amount || 0).toLocaleString(
    lang === 'fa' ? 'fa-IR' : 'en-US',
    { maximumFractionDigits: 4 }
  );
  return lang === 'fa' ? `${formatted} تومان` : `${formatted} IRT`;
}
