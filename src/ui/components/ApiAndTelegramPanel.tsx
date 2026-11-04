import React, { useState } from "react";
import {
  AppLanguage,
  Bit24ApiHealth,
  TelegramNotificationLog,
} from "../../shared/contracts.js";

interface Props {
  lang: AppLanguage;
  bit24Health: Bit24ApiHealth;
  telegramState: {
    configured: boolean;
    enabled: boolean;
    maskedChatId: string;
    recentLogs: TelegramNotificationLog[];
  };
  onSaveBit24: (apiKey: string, secretKey: string) => void;
  onVerifyBit24: () => void;
  onClearBit24: () => void;
  onSaveTelegram: (params: {
    botToken?: string;
    chatId?: string;
    enabled: boolean;
  }) => void;
  onSendDailyTelegram: () => void;
}

export const ApiAndTelegramPanel: React.FC<Props> = ({
  lang,
  bit24Health,
  telegramState,
  onSaveBit24,
  onVerifyBit24,
  onClearBit24,
  onSaveTelegram,
  onSendDailyTelegram,
}) => {
  return (
    <section className="section-card">
      <h2>اتصال زنده غیرفعال است</h2>
      <p>این نسخه فقط Demo است؛ کلید یا رمز صرافی وارد نکنید.</p>
    </section>
  );
};
